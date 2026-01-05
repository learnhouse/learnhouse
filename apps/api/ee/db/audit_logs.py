from typing import Optional, Any, Dict
from sqlmodel import SQLModel, Field, Column, Integer, ForeignKey, JSON
from datetime import datetime

class AuditLogBase(SQLModel):
    user_id: Optional[int] = Field(
        default=None, 
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"))
    )
    action: str
    resource: str
    resource_id: Optional[str] = None
    method: str
    path: str
    status_code: int
    payload: Optional[Dict[str, Any]] = Field(
        default=None, 
        sa_column=Column(JSON)
    )
    ip_address: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

class AuditLog(AuditLogBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

class AuditLogRead(AuditLogBase):
    id: int
