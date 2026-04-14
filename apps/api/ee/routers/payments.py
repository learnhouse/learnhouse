from typing import Literal, Union
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select
from src.core.events.database import get_db_session
from ee.db.payments.payments import PaymentsConfig, PaymentsConfigRead
from src.db.users import PublicUser, APITokenUser
from src.security.auth import get_current_user
from ee.services.payments.payments_config import (
    init_payments_config,
    get_payments_config,
    delete_payments_config,
)
from ee.services.payments.payments_stripe import (
    create_offer_checkout_session,
    handle_stripe_oauth_callback,
    generate_stripe_connect_link,
    create_stripe_express_account_and_link,
    refresh_stripe_express_onboarding_link,
    get_stripe_express_dashboard_link,
)
from ee.services.payments.payments_customers import get_customers
from ee.services.payments.webhooks.payments_webhooks import handle_stripe_webhook
# New offer/enrollment imports
from ee.db.payments.payments_offers import PaymentsOfferCreate, PaymentsOfferRead, PaymentsOfferUpdate
from ee.db.payments.payments_groups import (
    PaymentsGroupCreate, PaymentsGroupRead, PaymentsGroupUpdate,
    PaymentsOfferResource, PaymentsGroupResource,
)
from ee.services.payments.payments_offers import (
    create_payments_offer,
    delete_payments_offer,
    get_payments_offer,
    list_payments_offers,
    update_payments_offer,
)
from ee.services.payments.payments_enrollments import (
    get_user_enrollments,
)
from ee.services.payments.payments_groups import (
    create_payments_group,
    list_payments_groups,
    get_payments_group,
    update_payments_group,
    delete_payments_group,
    add_resource_to_group,
    remove_resource_from_group,
    list_group_resources,
    add_sync,
    remove_sync,
    list_syncs,
    add_offer_resource,
    remove_offer_resource,
    list_offer_resources,
)

router = APIRouter()

# Separate router for webhook endpoints — these must NOT be behind the
# require_plan dependency because Stripe calls them without any org_id.
webhook_router = APIRouter()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@router.post(
    "/{org_id}/config",
    response_model=PaymentsConfig,
    summary="Initialize payments config",
    description=(
        "Initialize a payments configuration for an organization with the given "
        "provider. Requires an org admin to be authenticated."
    ),
    responses={
        200: {"description": "Newly created payments config for the org.", "model": PaymentsConfig},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to manage payments for this org"},
        404: {"description": "Organization not found"},
    },
)
async def api_create_payments_config(
    request: Request,
    org_id: int,
    provider: Literal["stripe"],
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> PaymentsConfig:
    return await init_payments_config(request, org_id, provider, current_user, db_session)


@router.get(
    "/{org_id}/config",
    response_model=list[PaymentsConfigRead],
    summary="Get payments config",
    description="Return the payments configuration(s) for the organization.",
    responses={
        200: {"description": "List of payments configs for the organization."},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to view payments config for this org"},
    },
)
async def api_get_payments_config(
    request: Request,
    org_id: int,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> list[PaymentsConfigRead]:
    return await get_payments_config(request, org_id, current_user, db_session)

@router.delete(
    "/{org_id}/config",
    summary="Delete payments config",
    description="Delete the payments configuration for an organization.",
    responses={
        200: {"description": "Payments config deleted successfully."},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to manage payments for this org"},
        404: {"description": "Payments config not found"},
    },
)
async def api_delete_payments_config(
    request: Request,
    org_id: int,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    await delete_payments_config(request, org_id, current_user, db_session)
    return {"message": "Payments config deleted successfully"}

# ---------------------------------------------------------------------------
# Payment Groups
# ---------------------------------------------------------------------------

@router.post(
    "/{org_id}/groups",
    response_model=PaymentsGroupRead,
    summary="Create payment group",
    description="Create a new payment group that can bundle resources for offers.",
    responses={
        200: {"description": "Newly created payment group.", "model": PaymentsGroupRead},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to manage payments for this org"},
    },
)
async def api_create_payments_group(
    request: Request,
    org_id: int,
    data: PaymentsGroupCreate,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> PaymentsGroupRead:
    return await create_payments_group(request, org_id, data, current_user, db_session)


@router.get(
    "/{org_id}/groups",
    response_model=list[PaymentsGroupRead],
    summary="List payment groups",
    description="Return all payment groups configured for an organization.",
    responses={
        200: {"description": "List of payment groups for the org."},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to view payment groups"},
    },
)
async def api_list_payments_groups(
    request: Request,
    org_id: int,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> list[PaymentsGroupRead]:
    return await list_payments_groups(request, org_id, current_user, db_session)


@router.get(
    "/{org_id}/groups/{group_id}",
    response_model=PaymentsGroupRead,
    summary="Get payment group",
    description="Return a single payment group by id.",
    responses={
        200: {"description": "The requested payment group.", "model": PaymentsGroupRead},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to view this payment group"},
        404: {"description": "Payment group not found"},
    },
)
async def api_get_payments_group(
    request: Request,
    org_id: int,
    group_id: int,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> PaymentsGroupRead:
    return await get_payments_group(request, org_id, group_id, current_user, db_session)


@router.put(
    "/{org_id}/groups/{group_id}",
    response_model=PaymentsGroupRead,
    summary="Update payment group",
    description="Update metadata on an existing payment group.",
    responses={
        200: {"description": "Updated payment group.", "model": PaymentsGroupRead},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to manage this payment group"},
        404: {"description": "Payment group not found"},
    },
)
async def api_update_payments_group(
    request: Request,
    org_id: int,
    group_id: int,
    data: PaymentsGroupUpdate,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> PaymentsGroupRead:
    return await update_payments_group(request, org_id, group_id, data, current_user, db_session)


@router.delete(
    "/{org_id}/groups/{group_id}",
    summary="Delete payment group",
    description="Delete an existing payment group. Associated resources are detached.",
    responses={
        200: {"description": "Payment group deleted successfully."},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to manage this payment group"},
        404: {"description": "Payment group not found"},
    },
)
async def api_delete_payments_group(
    request: Request,
    org_id: int,
    group_id: int,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    await delete_payments_group(request, org_id, group_id, current_user, db_session)
    return {"message": "Group deleted"}


@router.post(
    "/{org_id}/groups/{group_id}/resources",
    summary="Add resource to payment group",
    description="Attach a resource (by UUID) to an existing payment group.",
    responses={
        200: {"description": "Resource linked to the payment group."},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to manage this payment group"},
        404: {"description": "Payment group or resource not found"},
    },
)
async def api_add_group_resource(
    request: Request,
    org_id: int,
    group_id: int,
    resource_uuid: str,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    return await add_resource_to_group(request, org_id, group_id, resource_uuid, current_user, db_session)


@router.delete(
    "/{org_id}/groups/{group_id}/resources",
    summary="Remove resource from payment group",
    description="Detach a resource from an existing payment group.",
    responses={
        200: {"description": "Resource removed from the payment group."},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to manage this payment group"},
        404: {"description": "Payment group or resource not found"},
    },
)
async def api_remove_group_resource(
    request: Request,
    org_id: int,
    group_id: int,
    resource_uuid: str,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    await remove_resource_from_group(request, org_id, group_id, resource_uuid, current_user, db_session)
    return {"message": "Resource removed"}


@router.get(
    "/{org_id}/groups/{group_id}/resources",
    response_model=list[str],
    summary="List payment group resources",
    description="Return the list of resource UUIDs attached to a payment group.",
    responses={
        200: {"description": "Resource UUIDs attached to the group."},
        404: {"description": "Payment group not found"},
    },
)
async def api_list_group_resources(
    org_id: int,
    group_id: int,
    db_session: Session = Depends(get_db_session),
) -> list[str]:
    return await list_group_resources(org_id, group_id, db_session)


@router.post(
    "/{org_id}/groups/{group_id}/sync",
    summary="Add usergroup sync to payment group",
    description=(
        "Link a usergroup to a payment group so purchasers are automatically added "
        "to that cohort after a successful payment."
    ),
    responses={
        200: {"description": "Usergroup sync added to the payment group."},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to manage this payment group"},
        404: {"description": "Payment group or usergroup not found"},
    },
)
async def api_add_group_sync(
    request: Request,
    org_id: int,
    group_id: int,
    usergroup_id: int,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    return await add_sync(request, org_id, group_id, usergroup_id, current_user, db_session)


@router.delete(
    "/{org_id}/groups/{group_id}/sync",
    summary="Remove usergroup sync",
    description="Remove a usergroup sync from a payment group.",
    responses={
        200: {"description": "Usergroup sync removed."},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to manage this payment group"},
        404: {"description": "Payment group or sync not found"},
    },
)
async def api_remove_group_sync(
    request: Request,
    org_id: int,
    group_id: int,
    usergroup_id: int,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    await remove_sync(request, org_id, group_id, usergroup_id, current_user, db_session)
    return {"message": "Sync removed"}


@router.get(
    "/{org_id}/groups/{group_id}/sync",
    response_model=list[dict],
    summary="List usergroup syncs",
    description="Return all usergroup syncs configured for a payment group.",
    responses={
        200: {"description": "Usergroup syncs configured for the payment group."},
        404: {"description": "Payment group not found"},
    },
)
async def api_list_group_syncs(
    org_id: int,
    group_id: int,
    db_session: Session = Depends(get_db_session),
) -> list[dict]:
    return await list_syncs(org_id, group_id, db_session)


# ---------------------------------------------------------------------------
# Offer resource management (direct links)
# ---------------------------------------------------------------------------

@router.post(
    "/{org_id}/offers/{offer_id}/resources",
    summary="Add resource to offer",
    description="Attach a direct resource (e.g. a course) to an offer. Grants buyers of this offer access to the linked resource.",
    responses={
        200: {"description": "Resource linked to the offer."},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to manage this offer"},
        404: {"description": "Offer, org, or resource not found"},
    },
)
async def api_add_offer_resource(
    request: Request,
    org_id: int,
    offer_id: int,
    resource_uuid: str,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    return await add_offer_resource(request, org_id, offer_id, resource_uuid, current_user, db_session)


@router.delete(
    "/{org_id}/offers/{offer_id}/resources",
    summary="Remove resource from offer",
    description="Detach a directly-linked resource from an offer. Does not affect resources granted through a payments group.",
    responses={
        200: {"description": "Resource removed from the offer."},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to manage this offer"},
        404: {"description": "Offer or link not found"},
    },
)
async def api_remove_offer_resource(
    request: Request,
    org_id: int,
    offer_id: int,
    resource_uuid: str,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    await remove_offer_resource(request, org_id, offer_id, resource_uuid, current_user, db_session)
    return {"message": "Resource removed from offer"}


@router.get(
    "/{org_id}/offers/{offer_id}/resources",
    summary="List offer resources",
    description="Public endpoint returning the resource UUIDs directly linked to an offer (excluding group-granted resources).",
    responses={
        200: {"description": "List of resource UUIDs directly linked to the offer."},
    },
)
async def api_list_offer_resources(
    org_id: int,
    offer_id: int,
    db_session: Session = Depends(get_db_session),
) -> list[str]:
    return await list_offer_resources(offer_id, db_session)


# ---------------------------------------------------------------------------
# Offers (new architecture)
# ---------------------------------------------------------------------------

@router.post(
    "/{org_id}/offers",
    response_model=PaymentsOfferRead,
    summary="Create payments offer",
    description="Create a new payments offer (one-time purchase or subscription) for an organization.",
    responses={
        200: {"description": "Offer created.", "model": PaymentsOfferRead},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to create offers in this org"},
        404: {"description": "Organization not found"},
    },
)
async def api_create_payments_offer(
    request: Request,
    org_id: int,
    offer: PaymentsOfferCreate,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> PaymentsOfferRead:
    return await create_payments_offer(request, org_id, offer, current_user, db_session)


@router.get(
    "/{org_id}/offers/public-listing",
    summary="List public offers",
    description="Public endpoint listing all publicly-listed offers for an organization, enriched with included-resource metadata (course name, description, thumbnail).",
    responses={
        200: {"description": "List of public offers with enriched resource info."},
    },
)
async def api_list_public_offers(
    org_id: int,
    db_session: Session = Depends(get_db_session),
):
    """Public endpoint — lists all publicly listed offers for an org, enriched with resource metadata."""
    from ee.db.payments.payments_offers import PaymentsOffer
    from src.db.courses.courses import Course
    from src.db.organizations import Organization

    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    org_uuid = org.org_uuid if org else ""

    offers = db_session.exec(
        select(PaymentsOffer).where(
            PaymentsOffer.org_id == org_id,
            PaymentsOffer.is_publicly_listed == True,
        ).order_by(PaymentsOffer.id.asc())  # type: ignore
    ).all()

    def _enrich_resources(offer_id: int, group_id) -> list[dict]:
        uuids: list[str] = []
        direct = db_session.exec(
            select(PaymentsOfferResource).where(PaymentsOfferResource.offer_id == offer_id)
        ).all()
        uuids.extend(r.resource_uuid for r in direct)
        if group_id:
            group_res = db_session.exec(
                select(PaymentsGroupResource).where(PaymentsGroupResource.payments_group_id == group_id)
            ).all()
            uuids.extend(r.resource_uuid for r in group_res)
        uuids = list(dict.fromkeys(uuids))  # deduplicate, preserve order

        enriched = []
        for uuid in uuids:
            if uuid.startswith("course_"):
                course = db_session.exec(
                    select(Course).where(Course.course_uuid == uuid)
                ).first()
                if course:
                    enriched.append({
                        "resource_uuid": uuid,
                        "resource_type": "course",
                        "name": course.name,
                        "description": course.description or "",
                        "thumbnail_image": course.thumbnail_image or "",
                        "org_uuid": org_uuid,
                    })
                    continue
            enriched.append({
                "resource_uuid": uuid,
                "resource_type": uuid.split("_")[0] if "_" in uuid else "resource",
                "name": uuid,
                "description": "",
                "thumbnail_image": "",
                "org_uuid": org_uuid,
            })
        return enriched

    return [
        {
            "id": o.id,
            "offer_uuid": o.offer_uuid,
            "name": o.name,
            "description": o.description,
            "offer_type": o.offer_type,
            "price_type": o.price_type,
            "amount": o.amount,
            "currency": o.currency,
            "benefits": o.benefits,
            "payments_group_id": o.payments_group_id,
            "included_resources": _enrich_resources(o.id, o.payments_group_id),
        }
        for o in offers
    ]


@router.get(
    "/{org_id}/offers/by-resource",
    summary="List offers by resource",
    description="Public endpoint returning offers that grant access to a given resource UUID, checking both direct offer resources and payments-group resources.",
    responses={
        200: {"description": "List of publicly-listed offers that grant access to the resource."},
    },
)
async def api_get_offers_by_resource(
    org_id: int,
    resource_uuid: str,
    db_session: Session = Depends(get_db_session),
):
    """
    Public endpoint — returns offers that grant access to the given resource_uuid.
    Checks both direct offer resources and group resources.
    """
    from ee.db.payments.payments_offers import PaymentsOffer

    offer_ids: set[int] = set()

    # Path 1: direct PaymentsOfferResource links
    direct_rows = db_session.exec(
        select(PaymentsOfferResource).where(
            PaymentsOfferResource.resource_uuid == resource_uuid,
            PaymentsOfferResource.org_id == org_id,
        )
    ).all()
    for row in direct_rows:
        offer_ids.add(row.offer_id)

    # Path 2: via PaymentsGroup → PaymentsGroupResource
    group_resource_rows = db_session.exec(
        select(PaymentsGroupResource).where(
            PaymentsGroupResource.resource_uuid == resource_uuid,
            PaymentsGroupResource.org_id == org_id,
        )
    ).all()
    group_ids = [r.payments_group_id for r in group_resource_rows]
    if group_ids:
        group_offers = db_session.exec(
            select(PaymentsOffer).where(
                PaymentsOffer.payments_group_id.in_(group_ids),  # type: ignore
                PaymentsOffer.org_id == org_id,
            )
        ).all()
        for o in group_offers:
            offer_ids.add(o.id)

    if not offer_ids:
        return []

    offers = db_session.exec(
        select(PaymentsOffer).where(
            PaymentsOffer.id.in_(list(offer_ids)),  # type: ignore
            PaymentsOffer.is_publicly_listed == True,
        )
    ).all()

    return [
        {
            "offer_id": o.id,
            "offer_uuid": o.offer_uuid,
            "offer_name": o.name,
            "description": o.description or "",
            "offer_type": o.offer_type,
            "price_type": o.price_type,
            "amount": o.amount,
            "currency": o.currency,
            "benefits": o.benefits or "",
        }
        for o in offers
    ]


@router.get(
    "/{org_id}/offers/{offer_uuid}/public",
    summary="Get public offer",
    description="Public endpoint returning offer metadata and its included resources enriched with course details.",
    responses={
        200: {"description": "Public offer details with enriched included-resources."},
        404: {"description": "Offer not found"},
    },
)
async def api_get_public_offer(
    org_id: int,
    offer_uuid: str,
    db_session: Session = Depends(get_db_session),
):
    """Public endpoint — offer metadata + included resources enriched with course details."""
    from fastapi import HTTPException
    from ee.db.payments.payments_offers import PaymentsOffer
    from src.db.courses.courses import Course
    from src.db.organizations import Organization

    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    org_uuid = org.org_uuid if org else ""

    offer = db_session.exec(
        select(PaymentsOffer).where(PaymentsOffer.offer_uuid == offer_uuid, PaymentsOffer.org_id == org_id)
    ).first()
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")

    uuids: list[str] = []
    direct = db_session.exec(
        select(PaymentsOfferResource).where(PaymentsOfferResource.offer_id == offer.id)
    ).all()
    uuids.extend(r.resource_uuid for r in direct)
    if offer.payments_group_id:
        group_resources = db_session.exec(
            select(PaymentsGroupResource).where(
                PaymentsGroupResource.payments_group_id == offer.payments_group_id
            )
        ).all()
        uuids.extend(r.resource_uuid for r in group_resources)
    uuids = list(dict.fromkeys(uuids))

    enriched = []
    for uuid in uuids:
        if uuid.startswith("course_"):
            course = db_session.exec(select(Course).where(Course.course_uuid == uuid)).first()
            if course:
                enriched.append({
                    "resource_uuid": uuid,
                    "resource_type": "course",
                    "name": course.name,
                    "description": course.description or "",
                    "thumbnail_image": course.thumbnail_image or "",
                    "org_uuid": org_uuid,
                })
                continue
        enriched.append({
            "resource_uuid": uuid,
            "resource_type": uuid.split("_")[0] if "_" in uuid else "resource",
            "name": uuid,
            "description": "",
            "thumbnail_image": "",
            "org_uuid": org_uuid,
        })

    return {
        "id": offer.id,
        "offer_uuid": offer.offer_uuid,
        "name": offer.name,
        "description": offer.description,
        "offer_type": offer.offer_type,
        "price_type": offer.price_type,
        "amount": offer.amount,
        "currency": offer.currency,
        "benefits": offer.benefits,
        "is_publicly_listed": offer.is_publicly_listed,
        "included_resources": enriched,
    }


@router.get(
    "/{org_id}/offers",
    response_model=list[PaymentsOfferRead],
    summary="List payments offers",
    description="List all payments offers owned by an organization, including unlisted ones. Requires authorization.",
    responses={
        200: {"description": "List of payments offers for the organization."},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to view offers for this org"},
    },
)
async def api_list_payments_offers(
    request: Request,
    org_id: int,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> list[PaymentsOfferRead]:
    return await list_payments_offers(request, org_id, current_user, db_session)


@router.get(
    "/{org_id}/offers/{offer_id}",
    response_model=PaymentsOfferRead,
    summary="Get payments offer",
    description="Get a single payments offer by its numeric id.",
    responses={
        200: {"description": "Offer details.", "model": PaymentsOfferRead},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to view this offer"},
        404: {"description": "Offer not found"},
    },
)
async def api_get_payments_offer(
    request: Request,
    org_id: int,
    offer_id: int,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> PaymentsOfferRead:
    return await get_payments_offer(request, org_id, offer_id, current_user, db_session)


@router.put(
    "/{org_id}/offers/{offer_id}",
    response_model=PaymentsOfferRead,
    summary="Update payments offer",
    description="Update an existing payments offer.",
    responses={
        200: {"description": "Offer updated.", "model": PaymentsOfferRead},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to update this offer"},
        404: {"description": "Offer not found"},
    },
)
async def api_update_payments_offer(
    request: Request,
    org_id: int,
    offer_id: int,
    offer: PaymentsOfferUpdate,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> PaymentsOfferRead:
    return await update_payments_offer(request, org_id, offer_id, offer, current_user, db_session)


@router.delete(
    "/{org_id}/offers/{offer_id}",
    summary="Delete payments offer",
    description="Delete a payments offer. The offer becomes unavailable for checkout immediately.",
    responses={
        200: {"description": "Offer deleted."},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to delete this offer"},
        404: {"description": "Offer not found"},
    },
)
async def api_delete_payments_offer(
    request: Request,
    org_id: int,
    offer_id: int,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    await delete_payments_offer(request, org_id, offer_id, current_user, db_session)
    return {"message": "Offer deleted successfully"}


@router.post(
    "/{org_id}/offers/{offer_uuid}/checkout",
    summary="Create offer checkout session",
    description="Create a provider checkout session for an offer. Returns a URL the user should be redirected to in order to complete purchase.",
    responses={
        200: {"description": "Checkout session created; returns the provider checkout URL."},
        401: {"description": "Authentication required"},
        404: {"description": "Offer not found"},
    },
)
async def api_create_offer_checkout_session(
    request: Request,
    org_id: int,
    offer_uuid: str,
    redirect_uri: str,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    from ee.db.payments.payments_offers import PaymentsOffer
    offer = db_session.exec(
        select(PaymentsOffer).where(PaymentsOffer.offer_uuid == offer_uuid, PaymentsOffer.org_id == org_id)
    ).first()
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")
    return await create_offer_checkout_session(
        request, org_id, offer.id, redirect_uri, current_user, db_session
    )


@router.get(
    "/{org_id}/enrollments/mine",
    summary="Get my paid enrollments",
    description="Return the current user's paid enrollments (offers purchased) within an organization.",
    responses={
        200: {"description": "The caller's paid enrollments for the organization."},
        401: {"description": "Authentication required"},
    },
)
async def api_get_user_enrollments(
    request: Request,
    org_id: int,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    return await get_user_enrollments(request, org_id, current_user, db_session)


@router.post(
    "/{org_id}/billing/portal",
    summary="Create billing portal session",
    description="Create a provider billing-portal session so the user can manage subscriptions, cancel, and view invoices/receipts.",
    responses={
        200: {"description": "Billing portal session created; returns the portal URL."},
        401: {"description": "Authentication required"},
        404: {"description": "No payments config found for this org"},
    },
)
async def api_create_billing_portal_session(
    request: Request,
    org_id: int,
    return_url: str,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Create a provider billing portal session so the user can manage
    subscriptions, cancel, and view invoices / receipts.
    """
    from ee.services.payments.provider_registry import get_provider

    config = db_session.exec(
        select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
    ).first()
    if not config:
        raise HTTPException(status_code=404, detail="No payments config found for this org")

    provider = get_provider(config.provider)
    return await provider.create_billing_portal_session(request, org_id, return_url, current_user, db_session)


# ---------------------------------------------------------------------------
# Webhooks
# ---------------------------------------------------------------------------

@webhook_router.post(
    "/stripe/webhook",
    summary="Stripe webhook (standard)",
    description="Receive and process Stripe webhook events for the standard (non-Connect) account. Called by Stripe.",
    responses={
        200: {"description": "Webhook event accepted."},
        400: {"description": "Invalid signature or malformed payload"},
    },
)
async def api_handle_stripe_webhook(
    request: Request,
    db_session: Session = Depends(get_db_session),
):
    return await handle_stripe_webhook(request, "standard", db_session)

@webhook_router.post(
    "/stripe/webhook/connect",
    summary="Stripe webhook (Connect)",
    description="Receive and process Stripe webhook events for Stripe Connect / Express accounts. Called by Stripe.",
    responses={
        200: {"description": "Webhook event accepted."},
        400: {"description": "Invalid signature or malformed payload"},
    },
)
async def api_handle_stripe_webhook_connect(
    request: Request,
    db_session: Session = Depends(get_db_session),
):
    return await handle_stripe_webhook(request, "connect", db_session)

# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------

@router.get(
    "/{org_id}/customers",
    summary="List payment customers",
    description="List every known payment customer (buyer) for the organization.",
    responses={
        200: {"description": "List of payment customers for the organization."},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to view customers for this org"},
    },
)
async def api_get_customers(
    request: Request,
    org_id: int,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    return await get_customers(request, org_id, current_user, db_session)


# ---------------------------------------------------------------------------
# Stripe live dashboard data (direct Stripe API)
# ---------------------------------------------------------------------------

@router.get(
    "/{org_id}/stripe/overview",
    summary="Get Stripe overview",
    description="Live dashboard overview fetched directly from the Stripe API (balance, recent activity summary).",
    responses={
        200: {"description": "Stripe overview snapshot."},
        401: {"description": "Authentication required"},
    },
)
async def api_stripe_overview(
    org_id: int,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    from ee.services.payments.payments_stripe_dashboard import get_stripe_overview
    return await get_stripe_overview(org_id, db_session)


@router.get(
    "/{org_id}/stripe/charges",
    summary="List Stripe charges",
    description="List Stripe charges for the org's connected account, paginated via `starting_after`. Data is fetched directly from Stripe.",
    responses={
        200: {"description": "Paginated list of Stripe charges."},
        401: {"description": "Authentication required"},
    },
)
async def api_stripe_charges(
    org_id: int,
    limit: int = 25,
    starting_after: str | None = None,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    from ee.services.payments.payments_stripe_dashboard import get_stripe_charges
    return await get_stripe_charges(org_id, limit, starting_after, db_session)


@router.get(
    "/{org_id}/stripe/subscriptions",
    summary="List Stripe subscriptions",
    description="List Stripe subscriptions for the org's connected account (defaults to active). Data is fetched directly from Stripe.",
    responses={
        200: {"description": "List of Stripe subscriptions with the given status."},
        401: {"description": "Authentication required"},
    },
)
async def api_stripe_subscriptions(
    org_id: int,
    status: str = "active",
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    from ee.services.payments.payments_stripe_dashboard import get_stripe_subscriptions
    return await get_stripe_subscriptions(org_id, status, db_session)

# ---------------------------------------------------------------------------
# Stripe Connect / OAuth
# ---------------------------------------------------------------------------

@router.post(
    "/{org_id}/stripe/connect/link",
    summary="Generate Stripe Connect link",
    description="Generate a Stripe Connect OAuth URL so an admin can connect their own Stripe account to the organization.",
    responses={
        200: {"description": "Stripe Connect OAuth URL for the admin to visit."},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to configure payments for this org"},
    },
)
async def api_generate_stripe_connect_link(
    request: Request,
    org_id: int,
    redirect_uri: str,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    return await generate_stripe_connect_link(request, org_id, redirect_uri, current_user, db_session)

@router.get(
    "/stripe/oauth/callback",
    summary="Stripe OAuth callback",
    description="Callback endpoint Stripe redirects to after the admin completes the Connect OAuth flow. Persists the resulting account id to the org's payments config.",
    responses={
        200: {"description": "OAuth exchange completed — connected account stored."},
        400: {"description": "Invalid or expired authorization code"},
        401: {"description": "Authentication required"},
    },
)
async def stripe_oauth_callback(
    request: Request,
    code: str,
    org_id: int,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    return await handle_stripe_oauth_callback(request, org_id, code, current_user, db_session)


# ---------------------------------------------------------------------------
# Stripe Express Connect ("Easy Mode")
# ---------------------------------------------------------------------------

@router.post(
    "/{org_id}/stripe/express/connect/link",
    summary="Create Stripe Express link",
    description="Create a Stripe Express account (if not already created) and return an onboarding link for the admin to complete account setup.",
    responses={
        200: {"description": "Stripe Express onboarding URL."},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to configure payments for this org"},
    },
)
async def api_stripe_express_connect_link(
    request: Request,
    org_id: int,
    redirect_uri: str,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Create a Stripe Express account (if not yet created) and return an onboarding link."""
    return await create_stripe_express_account_and_link(request, org_id, redirect_uri, current_user, db_session)


@router.post(
    "/{org_id}/stripe/express/connect/refresh",
    summary="Refresh Stripe Express link",
    description="Generate a fresh Stripe Express onboarding link when the previous one has expired. This endpoint is unauthenticated because Stripe redirects unauthenticated sessions here.",
    responses={
        200: {"description": "Refreshed onboarding URL."},
        404: {"description": "No payments config or Express account for this org"},
    },
)
async def api_stripe_express_connect_refresh(
    org_id: int,
    redirect_uri: str,
    db_session: Session = Depends(get_db_session),
):
    """Generate a fresh onboarding link when the previous one has expired."""
    return await refresh_stripe_express_onboarding_link(org_id, redirect_uri, db_session)


@router.get(
    "/{org_id}/stripe/express/dashboard",
    summary="Get Stripe Express dashboard URL",
    description="Return a Stripe Express hosted dashboard URL for the connected Express account so the admin can manage payouts, balances, etc.",
    responses={
        200: {"description": "Hosted Stripe Express dashboard URL."},
        401: {"description": "Authentication required"},
        403: {"description": "Caller lacks permission to view payments for this org"},
        404: {"description": "No Express account linked to this org"},
    },
)
async def api_stripe_express_dashboard(
    org_id: int,
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Return a Stripe Express hosted dashboard URL for the connected Express account."""
    return await get_stripe_express_dashboard_link(org_id, db_session)
