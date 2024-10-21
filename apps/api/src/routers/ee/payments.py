from fastapi import APIRouter, Depends, Request
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.payments.payments import PaymentsConfig, PaymentsConfigBase, PaymentsConfigCreate, PaymentsConfigRead, PaymentsConfigUpdate
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.payments.payments import (
    create_payments_config,
    get_payments_config,
    update_payments_config,
    delete_payments_config,
)
from src.db.payments.payments_products import PaymentsProduct, PaymentsProductCreate, PaymentsProductRead, PaymentsProductUpdate
from src.services.payments.payments_products import create_payments_product, delete_payments_product, get_payments_product, list_payments_products, update_payments_product


router = APIRouter()

@router.post("/{org_id}/config")
async def api_create_payments_config(
    request: Request,
    org_id: int,
    payments_config: PaymentsConfigCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> PaymentsConfig:
    return await create_payments_config(request, org_id, payments_config, current_user, db_session)

@router.get("/{org_id}/config")
async def api_get_payments_config(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> list[PaymentsConfigRead]:
    return await get_payments_config(request, org_id, current_user, db_session)

@router.put("/{org_id}/config")
async def api_update_payments_config(
    request: Request,
    org_id: int,
    payments_config: PaymentsConfigUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> PaymentsConfig:
    return await update_payments_config(request, org_id, payments_config, current_user, db_session)

@router.delete("/{org_id}/config")
async def api_delete_payments_config(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    await delete_payments_config(request, org_id, current_user, db_session)
    return {"message": "Payments config deleted successfully"}

@router.post("/{org_id}/products")
async def api_create_payments_product(
    request: Request,
    org_id: int,
    payments_product: PaymentsProductCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> PaymentsProductRead:
    return await create_payments_product(request, org_id, payments_product, current_user, db_session)

@router.get("/{org_id}/products")
async def api_get_payments_products(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> list[PaymentsProductRead]:
    return await list_payments_products(request, org_id, current_user, db_session)

@router.get("/{org_id}/products/{product_id}")
async def api_get_payments_product(
    request: Request,
    org_id: int,
    product_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> PaymentsProductRead:
    return await get_payments_product(request, org_id, product_id, current_user, db_session)

@router.put("/{org_id}/products/{product_id}")
async def api_update_payments_product(
    request: Request,
    org_id: int,
    product_id: int,
    payments_product: PaymentsProductUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> PaymentsProductRead:
    return await update_payments_product(request, org_id, product_id, payments_product, current_user, db_session)

@router.delete("/{org_id}/products/{product_id}")
async def api_delete_payments_product(
    request: Request,
    org_id: int,
    product_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    await delete_payments_product(request, org_id, product_id, current_user, db_session)
    return {"message": "Payments product deleted successfully"}
