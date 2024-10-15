from fastapi import HTTPException, Request
from sqlmodel import Session, select
from src.db.payments.payments import PaymentsConfig
from src.db.payments.payments_products import (
    PaymentsProduct,
    PaymentsProductCreate,
    PaymentsProductUpdate,
    PaymentsProductRead,
)
from src.db.users import PublicUser, AnonymousUser
from src.db.organizations import Organization
from src.services.orgs.orgs import rbac_check
from datetime import datetime
from uuid import uuid4

async def create_payments_product(
    request: Request,
    org_id: int,
    payments_product: PaymentsProductCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> PaymentsProductRead:
    # Check if organization exists
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "create", db_session)

    # Check if payments config exists and has a valid id
    statement = select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
    config = db_session.exec(statement).first()
    if not config or config.id is None:
        raise HTTPException(status_code=404, detail="Valid payments config not found")

    # Create new payments product
    new_product = PaymentsProduct(**payments_product.model_dump(), org_id=org_id, payments_config_id=config.id)
    new_product.creation_date = datetime.now()
    new_product.update_date = datetime.now()

    db_session.add(new_product)
    db_session.commit()
    db_session.refresh(new_product)

    return PaymentsProductRead.model_validate(new_product)

async def get_payments_product(
    request: Request,
    org_id: int,
    product_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> PaymentsProductRead:
    # Check if organization exists
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    # Get payments product
    statement = select(PaymentsProduct).where(PaymentsProduct.id == product_id, PaymentsProduct.org_id == org_id)
    product = db_session.exec(statement).first()
    if not product:
        raise HTTPException(status_code=404, detail="Payments product not found")

    return PaymentsProductRead.model_validate(product)

async def update_payments_product(
    request: Request,
    org_id: int,
    product_id: int,
    payments_product: PaymentsProductUpdate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> PaymentsProductRead:
    # Check if organization exists
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    # Get existing payments product
    statement = select(PaymentsProduct).where(PaymentsProduct.id == product_id, PaymentsProduct.org_id == org_id)
    product = db_session.exec(statement).first()
    if not product:
        raise HTTPException(status_code=404, detail="Payments product not found")

    # Update product
    for key, value in payments_product.model_dump().items():
        setattr(product, key, value)
    
    product.update_date = datetime.now()

    db_session.add(product)
    db_session.commit()
    db_session.refresh(product)

    return PaymentsProductRead.model_validate(product)

async def delete_payments_product(
    request: Request,
    org_id: int,
    product_id: int,
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

    # Get existing payments product
    statement = select(PaymentsProduct).where(PaymentsProduct.id == product_id, PaymentsProduct.org_id == org_id)
    product = db_session.exec(statement).first()
    if not product:
        raise HTTPException(status_code=404, detail="Payments product not found")

    # Delete product
    db_session.delete(product)
    db_session.commit()

async def list_payments_products(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> list[PaymentsProductRead]:
    # Check if organization exists
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    # Get payments products ordered by id
    statement = select(PaymentsProduct).where(PaymentsProduct.org_id == org_id).order_by(PaymentsProduct.id.desc())
    products = db_session.exec(statement).all()

    return [PaymentsProductRead.model_validate(product) for product in products]
