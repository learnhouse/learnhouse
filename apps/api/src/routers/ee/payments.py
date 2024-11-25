from typing import Literal
from fastapi import APIRouter, Depends, Request
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.payments.payments import PaymentsConfig, PaymentsConfigRead
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.payments.payments_config import (
    init_payments_config,
    get_payments_config,
    delete_payments_config,
)
from src.db.payments.payments_products import PaymentsProductCreate, PaymentsProductRead, PaymentsProductUpdate
from src.services.payments.payments_products import create_payments_product, delete_payments_product, get_payments_product, get_products_by_course, list_payments_products, update_payments_product
from src.services.payments.payments_courses import (
    link_course_to_product,
    unlink_course_from_product,
    get_courses_by_product,
)
from src.services.payments.payments_users import get_owned_courses
from src.services.payments.payments_stripe import create_checkout_session, handle_stripe_oauth_callback, update_stripe_account_id
from src.services.payments.payments_access import check_course_paid_access
from src.services.payments.payments_customers import get_customers
from src.services.payments.payments_stripe import generate_stripe_connect_link
from src.services.payments.webhooks.payments_webhooks import handle_stripe_webhook


router = APIRouter()

@router.post("/{org_id}/config")
async def api_create_payments_config(
    request: Request,
    org_id: int,
    provider: Literal["stripe"],
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> PaymentsConfig:
    return await init_payments_config(request, org_id, provider, current_user, db_session)


@router.get("/{org_id}/config")
async def api_get_payments_config(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> list[PaymentsConfigRead]:
    return await get_payments_config(request, org_id, current_user, db_session)

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

@router.post("/{org_id}/products/{product_id}/courses/{course_id}")
async def api_link_course_to_product(
    request: Request,
    org_id: int,
    product_id: int,
    course_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    return await link_course_to_product(
        request, org_id, course_id, product_id, current_user, db_session
    )

@router.delete("/{org_id}/products/{product_id}/courses/{course_id}")
async def api_unlink_course_from_product(
    request: Request,
    org_id: int,
    product_id: int,
    course_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    return await unlink_course_from_product(
        request, org_id, course_id, current_user, db_session
    )

@router.get("/{org_id}/products/{product_id}/courses")
async def api_get_courses_by_product(
    request: Request,
    org_id: int,
    product_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    return await get_courses_by_product(
        request, org_id, product_id, current_user, db_session
    )

@router.get("/{org_id}/courses/{course_id}/products")
async def api_get_products_by_course(
    request: Request,
    org_id: int,
    course_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    return await get_products_by_course(
        request, org_id, course_id, current_user, db_session
    )

# Payments webhooks

@router.post("/stripe/webhook")
async def api_handle_connected_accounts_stripe_webhook(
    request: Request,
    db_session: Session = Depends(get_db_session),
):
    return await handle_stripe_webhook(request, "standard", db_session)

@router.post("/stripe/webhook/connect")
async def api_handle_connected_accounts_stripe_webhook_connect(
    request: Request,
    db_session: Session = Depends(get_db_session),
):
    return await handle_stripe_webhook(request, "connect", db_session)

# Payments checkout

@router.post("/{org_id}/stripe/checkout/product/{product_id}")
async def api_create_checkout_session(
    request: Request,
    org_id: int,
    product_id: int,
    redirect_uri: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    return await create_checkout_session(request, org_id, product_id, redirect_uri, current_user, db_session)

@router.get("/{org_id}/courses/{course_id}/access")
async def api_check_course_paid_access(
    request: Request,
    org_id: int,
    course_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Check if current user has paid access to a specific course
    """
    return {
        "has_access": await check_course_paid_access(
            course_id=course_id,
            user=current_user,
            db_session=db_session
        )
    }

@router.get("/{org_id}/customers")
async def api_get_customers(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Get list of customers and their subscriptions for an organization
    """
    return await get_customers(request, org_id, current_user, db_session)

@router.get("/{org_id}/courses/owned")
async def api_get_owned_courses(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    return await get_owned_courses(request, current_user, db_session)

@router.put("/{org_id}/stripe/account")
async def api_update_stripe_account_id(
    request: Request,
    org_id: int,
    stripe_account_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    return await update_stripe_account_id(
        request, org_id, stripe_account_id, current_user, db_session
    )

@router.post("/{org_id}/stripe/connect/link")
async def api_generate_stripe_connect_link(
    request: Request,
    org_id: int,
    redirect_uri: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Generate a Stripe OAuth link for connecting a Stripe account
    """
    return await generate_stripe_connect_link(
        request, org_id, redirect_uri, current_user, db_session
    )

@router.get("/stripe/oauth/callback")
async def stripe_oauth_callback(
    request: Request,
    code: str,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    return await handle_stripe_oauth_callback(request, org_id, code, current_user, db_session)