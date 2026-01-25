from typing import Optional
from fastapi import APIRouter, Depends, Query, Request, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select, desc, func
from src.core.events.database import get_db_session
from ee.db.audit_logs import AuditLog, AuditLogRead, AuditLogPaginated
from src.db.users import User, PublicUser
from src.db.organizations import Organization
from src.db.organization_config import OrganizationConfig, OrganizationConfigBase
from src.security.auth import get_current_user
from src.services.orgs.orgs import rbac_check
from datetime import datetime
import csv
import io

router = APIRouter()

async def verify_org_admin_and_plan(
    org_id: int,
    request: Request,
    current_user: PublicUser,
    session: Session
):
    # Get organization to get uuid
    org = session.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    # Check plan
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    org_config = session.exec(statement).first()
    
    if not org_config:
        raise HTTPException(status_code=403, detail="Organization configuration not found")
    
    config = OrganizationConfigBase(**org_config.config)
    if config.cloud.plan != "enterprise":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Audit logs are only available on the Enterprise plan"
        )
    
    # RBAC check for admin status (using 'update' as a proxy for admin actions)
    await rbac_check(request, org.org_uuid, current_user, "update", session)

@router.get("/export")
async def export_audit_logs(
    *,
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    session: Session = Depends(get_db_session),
    user_id: Optional[str] = None,
    action: Optional[str] = None,
    resource: Optional[str] = None,
    status_code: Optional[int] = None,
    ip_address: Optional[str] = None,
    username: Optional[str] = None,
    name: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
):
    """
    Export audit logs as CSV.
    """
    await verify_org_admin_and_plan(org_id, request, current_user, session)

    statement = (
        select(AuditLog, User.username)
        .outerjoin(User, AuditLog.user_id == User.id)
        .where(AuditLog.org_id == org_id)
    )
    
    # Apply same filters as get_audit_logs
    if user_id:
        from sqlalchemy import cast, String
        statement = statement.where(cast(AuditLog.user_id, String).ilike(f"%{user_id}%"))
    if username:
        statement = statement.where(User.username.ilike(f"%{username}%"))
    if name:
        statement = statement.where((User.first_name + " " + User.last_name).ilike(f"%{name}%"))
    if action:
        statement = statement.where(AuditLog.action.ilike(f"%{action}%"))
    if resource:
        statement = statement.where(AuditLog.resource.ilike(f"%{resource}%"))
    if status_code:
        statement = statement.where(AuditLog.status_code == status_code)
    if ip_address:
        statement = statement.where(AuditLog.ip_address.ilike(f"%{ip_address}%"))
    if start_date:
        statement = statement.where(AuditLog.created_at >= start_date)
    if end_date:
        statement = statement.where(AuditLog.created_at <= end_date)
        
    statement = statement.order_by(desc(AuditLog.created_at))
    results = session.exec(statement).all()

    # Create CSV in memory
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Header
    writer.writerow(["ID", "Timestamp", "User ID", "Username", "Action", "Resource", "Resource ID", "Method", "Path", "Status Code", "IP Address"])
    
    # Rows
    for log, user_name in results:
        writer.writerow([
            log.id,
            log.created_at.isoformat(),
            log.user_id or "System",
            user_name or "System",
            log.action,
            log.resource,
            log.resource_id or "",
            log.method,
            log.path,
            log.status_code,
            log.ip_address or ""
        ])
    
    output.seek(0)
    
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=audit_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"}
    )

@router.get("/", response_model=AuditLogPaginated)
async def get_audit_logs(
    *,
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    session: Session = Depends(get_db_session),
    offset: int = 0,
    limit: int = Query(default=100, lte=100),
    user_id: Optional[str] = None,
    action: Optional[str] = None,
    resource: Optional[str] = None,
    status_code: Optional[int] = None,
    ip_address: Optional[str] = None,
    username: Optional[str] = None,
    name: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
):
    """
    Get audit logs with filtering and pagination.
    """
    await verify_org_admin_and_plan(org_id, request, current_user, session)

    # Build count query
    count_statement = select(func.count()).select_from(AuditLog).outerjoin(User, AuditLog.user_id == User.id).where(AuditLog.org_id == org_id)
    
    # Build data query
    statement = (
        select(AuditLog, User.username, User.avatar_image)
        .outerjoin(User, AuditLog.user_id == User.id)
        .where(AuditLog.org_id == org_id)
    )
    
    # Apply filters
    filters = []
    if user_id:
        from sqlalchemy import cast, String
        filters.append(cast(AuditLog.user_id, String).ilike(f"%{user_id}%"))
    if username:
        filters.append(User.username.ilike(f"%{username}%"))
    if name:
        filters.append((User.first_name + " " + User.last_name).ilike(f"%{name}%"))
    if action:
        filters.append(AuditLog.action.ilike(f"%{action}%"))
    if resource:
        filters.append(AuditLog.resource.ilike(f"%{resource}%"))
    if status_code:
        filters.append(AuditLog.status_code == status_code)
    if ip_address:
        filters.append(AuditLog.ip_address.ilike(f"%{ip_address}%"))
    if start_date:
        filters.append(AuditLog.created_at >= start_date)
    if end_date:
        filters.append(AuditLog.created_at <= end_date)

    for f in filters:
        count_statement = count_statement.where(f)
        statement = statement.where(f)
        
    total = session.exec(count_statement).one()
    
    statement = statement.order_by(desc(AuditLog.created_at)).offset(offset).limit(limit)
    
    results = session.exec(statement).all()
    
    # Process results to match AuditLogRead
    audit_logs_read = []
    for log, username, avatar_image in results:
        log_dict = log.model_dump()
        log_dict["username"] = username
        log_dict["avatar_url"] = avatar_image
        audit_logs_read.append(AuditLogRead(**log_dict))
        
    return {
        "items": audit_logs_read,
        "total": total,
        "limit": limit,
        "offset": offset
    }

