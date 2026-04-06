import asyncio
import json
import logging
from fastapi import Request
from starlette.types import ASGIApp, Receive, Scope, Send
from ee.services.audit import queue_audit_log, resolve_org_id, is_enterprise_plan
from src.db.users import PublicUser
from src.core.events.database import engine
from sqlmodel import Session

logger = logging.getLogger(__name__)

# Strong references to fire-and-forget tasks so the GC does not collect them
# before they complete (Python 3.12+ only keeps weak refs in the event loop).
_background_tasks: set = set()

class EEAuditLogMiddleware:
    """
    Pure ASGI middleware for audit logging.
    Using pure ASGI (instead of BaseHTTPMiddleware) avoids the known
    RuntimeError: No response returned issue with streaming responses.
    """
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        http_method: str = scope["method"]
        path: str = scope["path"]

        # Only audit "actions" (mutations: POST, PUT, DELETE, PATCH)
        # We skip GET (reads) and OPTIONS to avoid noise
        if http_method not in ["POST", "PUT", "DELETE", "PATCH"]:
            await self.app(scope, receive, send)
            return

        # Skip health checks, documentation, and static files
        if (
            path.startswith("/api/v1/health") or
            path.startswith("/docs") or
            path.startswith("/redoc") or
            path.startswith("/content")
        ):
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive)

        # Capture request body for audit logging.
        # IMPORTANT: request.body() drains the ASGI receive stream. We only read it
        # for content types we care about logging. When we do read it, we must replay
        # it for the downstream app via a replacement receive callable.
        # For all other content types we leave receive untouched.
        payload = {}
        body_bytes = b""
        body_was_read = False

        try:
            content_type = request.headers.get("content-type", "")

            if "application/json" in content_type:
                body_bytes = await request.body()
                body_was_read = True
                if body_bytes:
                    try:
                        payload = json.loads(body_bytes)
                    except json.JSONDecodeError:
                        pass
            elif "multipart/form-data" in content_type:
                # Never read multipart bodies — they can be gigabytes of file
                # data. We only need to know the content type for the audit log.
                payload = {"_type": "multipart/form-data"}
            elif "application/x-www-form-urlencoded" in content_type:
                body_bytes = await request.body()
                body_was_read = True
                if body_bytes:
                    from urllib.parse import parse_qs
                    parsed = parse_qs(body_bytes.decode("utf-8"))
                    payload = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}

            # Scrub sensitive data from payload
            if isinstance(payload, dict):
                sensitive_keys = ["password", "token", "access_token", "secret", "new_password", "old_password"]
                payload = {k: v for k, v in payload.items() if k not in sensitive_keys}

        except Exception as e:
            logger.error(f"Audit middleware failed to capture request data: {e}")

        # If we consumed the receive stream, provide a replay so downstream sees
        # the full body. Otherwise pass the original receive through unchanged.
        if body_was_read:
            body_replayed = False

            async def replay_receive():
                nonlocal body_replayed
                if not body_replayed:
                    body_replayed = True
                    return {"type": "http.request", "body": body_bytes, "more_body": False}
                # Delegate to the original receive so Starlette blocks until
                # the real client disconnects instead of seeing a fake
                # disconnect that aborts the response mid-flight.
                return await receive()

            downstream_receive = replay_receive
        else:
            downstream_receive = receive

        # Determine resource and resource_id from path
        # Paths are usually /api/v1/{resource}/{id}/{subresource}/{subid}
        path_parts = [p for p in path.split("/") if p]
        try:
            v1_index = path_parts.index("v1")
            clean_parts = path_parts[v1_index + 1:]
        except ValueError:
            clean_parts = path_parts

        # Default resource determination
        resource = clean_parts[0] if len(clean_parts) > 0 else "root"
        resource_id = clean_parts[1] if len(clean_parts) > 1 else None

        # Prepare data for org_id resolution
        path_query_data = {
            "org_id": request.query_params.get("org_id") or request.query_params.get("orgId"),
            "org_slug": request.query_params.get("org_slug") or request.query_params.get("orgslug"),
            "course_id": request.query_params.get("course_id") or request.query_params.get("courseId"),
            "chapter_id": request.query_params.get("chapter_id") or request.query_params.get("chapterId"),
            "assignment_id": request.query_params.get("assignment_id") or request.query_params.get("assignmentId"),
            "certification_id": request.query_params.get("certification_id") or request.query_params.get("certificationId"),
        }

        # Traverse path to find the actual resource being acted on and collect IDs for org resolution
        for i in range(0, len(clean_parts), 2):
            res_name = clean_parts[i]
            res_id = clean_parts[i+1] if len(clean_parts) > i+1 else None
            
            # The last pair or single resource name we encounter is the one we log
            resource = res_name
            resource_id = res_id

            # Collect IDs for org resolution
            if res_name == "orgs" and res_id:
                path_query_data["org_id"] = res_id
            elif res_name == "courses" and res_id:
                path_query_data["course_id"] = res_id
            elif res_name == "chapters" and res_id:
                path_query_data["chapter_id"] = res_id
            elif res_name == "activities" and res_id:
                path_query_data["activity_id"] = res_id
            elif res_name == "collections" and res_id:
                path_query_data["collection_id"] = res_id
            elif res_name == "usergroups" and res_id:
                path_query_data["usergroup_id"] = res_id
            elif res_name == "roles" and res_id:
                path_query_data["role_id"] = res_id
            elif res_name == "assignments" and res_id:
                path_query_data["assignment_id"] = res_id
            elif res_name == "certifications" and res_id:
                path_query_data["certification_id"] = res_id

        # Try to resolve org_id BEFORE the action (essential for DELETE)
        org_id = None
        should_log = False
        with Session(engine) as session:
            # 1. Try from captured payload
            if isinstance(payload, dict):
                org_id = resolve_org_id(session, payload)

            # 2. Try from path/query data collected
            if org_id is None:
                org_id = resolve_org_id(session, path_query_data)

            # In EE (self-hosted) mode all orgs get audit logs;
            # in SaaS mode only enterprise-plan orgs qualify.
            if org_id:
                from src.core.deployment_mode import get_deployment_mode
                if get_deployment_mode() == "ee":
                    should_log = True
                else:
                    should_log = is_enterprise_plan(session, org_id)

        # Wrap send to capture the response status code for audit logging.
        status_code = 0

        async def wrapped_send(message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        # Run the downstream app — streaming responses work correctly here because
        # we are a pure ASGI middleware and do not buffer the response body.
        await self.app(scope, downstream_receive, wrapped_send)

        # Extract user if available (set by auth dependencies)
        user_id = None
        if hasattr(request.state, "user") and isinstance(request.state.user, PublicUser):
            user_id = request.state.user.id

        action = f"{http_method} {path}"

        # Queue the log asynchronously only if audit logging is enabled for this org
        if should_log:
            task = asyncio.create_task(queue_audit_log(
                user_id=user_id,
                org_id=org_id,
                action=action,
                resource=resource,
                method=http_method,
                path=path,
                status_code=status_code,
                payload=payload if payload else None,
                resource_id=resource_id,
                ip_address=request.client.host if request.client else None
            ))
            _background_tasks.add(task)
            task.add_done_callback(_background_tasks.discard)
