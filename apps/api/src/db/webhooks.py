from typing import Optional, List
from pydantic import BaseModel
from sqlalchemy import JSON, Column, ForeignKey, Integer, String, Boolean, Index, Text
from sqlmodel import Field, SQLModel


class WebhookEndpoint(SQLModel, table=True):
    """Webhook subscription endpoint for an organization."""

    __tablename__ = "webhook_endpoint"
    __table_args__ = (
        Index("ix_webhook_endpoint_webhook_uuid", "webhook_uuid"),
        Index("ix_webhook_endpoint_org_id", "org_id"),
        Index("ix_webhook_endpoint_org_active", "org_id", "is_active"),
        {"extend_existing": True},
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    webhook_uuid: str = Field(default="", max_length=100)
    org_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    url: str = Field(sa_column=Column(String(2048), nullable=False))
    secret_encrypted: str = Field(
        default="", sa_column=Column(Text, nullable=False)
    )
    description: Optional[str] = Field(default=None, max_length=500)
    events: List[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    is_active: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, server_default="true"))
    created_by_user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id"), nullable=False)
    )
    creation_date: str = ""
    update_date: str = ""


class WebhookDeliveryLog(SQLModel, table=True):
    """Log of each webhook delivery attempt."""

    __tablename__ = "webhook_delivery_log"
    __table_args__ = (
        Index("ix_webhook_delivery_log_webhook_id", "webhook_id"),
        Index("ix_webhook_delivery_log_created_at", "created_at"),
        {"extend_existing": True},
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    webhook_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("webhook_endpoint.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    event_name: str = Field(max_length=100)
    delivery_uuid: str = Field(default="", max_length=100)
    request_payload: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    response_status: Optional[int] = None
    response_body: Optional[str] = Field(default=None, sa_column=Column(String(500)))
    success: bool = False
    attempt: int = 1
    error_message: Optional[str] = Field(default=None, sa_column=Column(String(1000)))
    created_at: str = ""


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class WebhookEndpointCreate(BaseModel):
    url: str
    description: Optional[str] = None
    events: List[str]


class WebhookEndpointUpdate(BaseModel):
    url: Optional[str] = None
    description: Optional[str] = None
    events: Optional[List[str]] = None
    is_active: Optional[bool] = None


class WebhookEndpointRead(BaseModel):
    id: int
    webhook_uuid: str
    org_id: int
    url: str
    description: Optional[str] = None
    events: List[str]
    is_active: bool
    has_secret: bool = True
    created_by_user_id: int
    creation_date: str
    update_date: str


class WebhookEndpointCreatedResponse(BaseModel):
    """Returned only on create / regenerate -- the only time the secret is shown."""

    webhook_uuid: str
    url: str
    description: Optional[str] = None
    events: List[str]
    is_active: bool
    secret: str  # plaintext secret, shown once
    created_by_user_id: int
    creation_date: str


class WebhookDeliveryLogRead(BaseModel):
    id: int
    webhook_id: int
    event_name: str
    delivery_uuid: str
    request_payload: Optional[dict] = None
    response_status: Optional[int] = None
    response_body: Optional[str] = None
    success: bool
    attempt: int
    error_message: Optional[str] = None
    created_at: str
