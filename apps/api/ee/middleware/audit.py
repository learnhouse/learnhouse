import asyncio
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from ee.services.audit import queue_audit_log
from src.db.users import PublicUser

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

        # Proceed with the request
        response: Response = await call_next(request)

        # Extract user if available (requires request.state.user to be set in auth dependency)
        user_id = None
        if hasattr(request.state, "user") and isinstance(request.state.user, PublicUser):
            user_id = request.state.user.id

        # Determine action and resource from path
        parts = path.split("/")
        resource = parts[3] if len(parts) > 3 else "root"
        resource_id = parts[4] if len(parts) > 4 else None
        
        action = f"{request.method} {path}"

        # Queue the log asynchronously
        asyncio.create_task(queue_audit_log(
            user_id=user_id,
            action=action,
            resource=resource,
            method=request.method,
            path=path,
            status_code=response.status_code,
            resource_id=resource_id,
            ip_address=request.client.host if request.client else None
        ))

        return response
