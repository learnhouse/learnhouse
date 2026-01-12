import asyncio
import json
import logging
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from ee.services.audit import queue_audit_log, resolve_org_id, is_enterprise_plan
from src.db.users import PublicUser
from src.core.events.database import engine
from sqlmodel import Session
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

class EEAuditLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Only audit "actions" (mutations: POST, PUT, DELETE, PATCH)
        # We skip GET (reads) and OPTIONS to avoid noise
        if request.method not in ["POST", "PUT", "DELETE", "PATCH"]:
            return await call_next(request)

        # Skip health checks, documentation, and static files
        path = request.url.path
        if (
            path.startswith("/api/v1/health") or 
            path.startswith("/docs") or 
            path.startswith("/redoc") or
            path.startswith("/content")
        ):
            return await call_next(request)

        # Capture request data for payload and org_id extraction
        payload = {}
        org_id = None
        
        try:
            content_type = request.headers.get("content-type", "")
            
            if "application/json" in content_type:
                body = await request.body()
                if body:
                    try:
                        payload = json.loads(body)
                        # Reset request body so subsequent handlers can read it
                        async def receive():
                            return {"type": "http.request", "body": body, "more_body": False}
                        request._receive = receive
                    except json.JSONDecodeError:
                        pass
            elif "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
                # Read and parse the form data
                body = await request.body()
                if body:
                    # Parse form data manually to avoid consuming the stream
                    from urllib.parse import parse_qs
                    if "application/x-www-form-urlencoded" in content_type:
                        body_str = body.decode('utf-8')
                        parsed = parse_qs(body_str)
                        # Convert lists to single values for logging
                        payload = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
                    else:
                        # For multipart, just note that it was multipart data
                        payload = {"_type": "multipart/form-data"}
                    
                    # Reset request body so subsequent handlers can read it
                    async def receive():
                        return {"type": "http.request", "body": body, "more_body": False}
                    request._receive = receive
            
            # Scrub sensitive data from payload
            if isinstance(payload, dict):
                sensitive_keys = ["password", "token", "access_token", "secret", "new_password", "old_password"]
                payload = {k: v for k, v in payload.items() if k not in sensitive_keys}
                
        except Exception as e:
            logger.error(f"Audit middleware failed to capture request data: {e}")

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
        is_enterprise = False
        with Session(engine) as session:
            # 1. Try from captured payload
            if isinstance(payload, dict):
                org_id = resolve_org_id(session, payload)
            
            # 2. Try from path/query data collected
            if org_id is None:
                org_id = resolve_org_id(session, path_query_data)
            
            # Check if this organization is on the enterprise plan
            if org_id:
                is_enterprise = is_enterprise_plan(session, org_id)

        # Proceed with the request
        response: Response = await call_next(request)

        # Extract user if available (set by auth dependencies during call_next)
        user_id = None
        if hasattr(request.state, "user") and isinstance(request.state.user, PublicUser):
            user_id = request.state.user.id

        action = f"{request.method} {path}"

        # Queue the log asynchronously only if it's an enterprise org
        if is_enterprise:
            asyncio.create_task(queue_audit_log(
                user_id=user_id,
                org_id=org_id,
                action=action,
                resource=resource,
                method=request.method,
                path=path,
                status_code=response.status_code,
                payload=payload if payload else None,
                resource_id=resource_id,
                ip_address=request.client.host if request.client else None
            ))

        return response
