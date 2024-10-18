from typing import Optional
from fastapi import HTTPException, Request
from sqlmodel import Session, select
from src.db.payments.payments import (
    PaymentsConfig,
    PaymentsConfigCreate,
    PaymentsConfigUpdate,
    PaymentsConfigRead,
)
from src.db.users import PublicUser, AnonymousUser
from src.db.organizations import Organization
from src.services.orgs.orgs import rbac_check


async def create_payments_config(
    request: Request,
    org_id: int,
    payments_config: PaymentsConfigCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> PaymentsConfig:
    # Check if organization exists
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "create", db_session)

    # Check if payments config already exists for this organization
    statement = select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
    existing_config = db_session.exec(statement).first()
    if existing_config:
        raise HTTPException(
            status_code=409,
            detail="Payments config already exists for this organization",
        )

    # Create new payments config
    new_config = PaymentsConfig(**payments_config.model_dump(), org_id=org_id)
    db_session.add(new_config)
    db_session.commit()
    db_session.refresh(new_config)

    return new_config


async def get_payments_config(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> list[PaymentsConfigRead]:
    # Check if organization exists
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    # Get payments config
    statement = select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
    configs = db_session.exec(statement).all()

    return [PaymentsConfigRead.model_validate(config) for config in configs]


async def update_payments_config(
    request: Request,
    org_id: int,
    payments_config: PaymentsConfigUpdate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> PaymentsConfig:
    # Check if organization exists
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    # Get existing payments config
    statement = select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
    config = db_session.exec(statement).first()
    if not config:
        raise HTTPException(status_code=404, detail="Payments config not found")

    # Update config
    for key, value in payments_config.model_dump().items():
        setattr(config, key, value)

    db_session.add(config)
    db_session.commit()
    db_session.refresh(config)

    return config


async def delete_payments_config(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> None:
    # Check if organization exists
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "delete", db_session)

    # Get existing payments config
    statement = select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
    config = db_session.exec(statement).first()
    if not config:
        raise HTTPException(status_code=404, detail="Payments config not found")

    # Delete config
    db_session.delete(config)
    db_session.commit()
