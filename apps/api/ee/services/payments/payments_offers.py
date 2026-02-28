from fastapi import HTTPException, Request
from sqlmodel import Session, select
from datetime import datetime

from ee.db.payments.payments import PaymentsConfig
from ee.db.payments.payments_enrollments import EnrollmentStatusEnum, PaymentsEnrollment
from ee.db.payments.payments_offers import (
    PaymentsOffer,
    PaymentsOfferCreate,
    PaymentsOfferRead,
    PaymentsOfferUpdate,
)
from ee.db.payments.payments_groups import (
    PaymentsGroup,
    PaymentsOfferResource,
)
from src.db.organizations import Organization
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.services.orgs.orgs import rbac_check
from ee.services.payments.provider_registry import get_provider


async def create_payments_offer(
    request: Request,
    org_id: int,
    offer_data: PaymentsOfferCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> PaymentsOfferRead:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    await rbac_check(request, org.org_uuid, current_user, "create", db_session)

    config = db_session.exec(select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)).first()
    if not config or config.id is None:
        raise HTTPException(status_code=404, detail="Valid payments config not found")
    if not config.active:
        raise HTTPException(status_code=400, detail="Payments config is not active")

    # Validate PaymentsGroup if provided
    if offer_data.payments_group_id is not None:
        group = db_session.exec(
            select(PaymentsGroup).where(
                PaymentsGroup.id == offer_data.payments_group_id,
                PaymentsGroup.org_id == org_id,
            )
        ).first()
        if not group:
            raise HTTPException(status_code=404, detail="PaymentsGroup not found")

    offer_fields = {
        k: v for k, v in offer_data.model_dump().items()
        if k not in ("resource_uuids",)
    }

    new_offer = PaymentsOffer(
        **offer_fields,
        org_id=org_id,
        payments_config_id=config.id,
        provider_product_id="",
    )
    new_offer.creation_date = datetime.now()
    new_offer.update_date = datetime.now()

    provider = get_provider(config.provider)
    provider_product = await provider.create_product(request, org_id, new_offer, current_user, db_session)
    new_offer.provider_product_id = provider_product.id

    db_session.add(new_offer)
    db_session.flush()

    # Link direct resources if provided
    for resource_uuid in offer_data.resource_uuids:
        resource_uuid = resource_uuid.strip()
        if not resource_uuid:
            continue
        existing = db_session.exec(
            select(PaymentsOfferResource).where(
                PaymentsOfferResource.offer_id == new_offer.id,
                PaymentsOfferResource.resource_uuid == resource_uuid,
            )
        ).first()
        if not existing:
            db_session.add(PaymentsOfferResource(
                offer_id=new_offer.id,
                resource_uuid=resource_uuid,
                org_id=org_id,
                creation_date=datetime.now(),
                update_date=datetime.now(),
            ))

    db_session.commit()
    db_session.refresh(new_offer)
    return PaymentsOfferRead.model_validate(new_offer)


async def get_payments_offer(
    request: Request,
    org_id: int,
    offer_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> PaymentsOfferRead:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    offer = db_session.exec(
        select(PaymentsOffer).where(PaymentsOffer.id == offer_id, PaymentsOffer.org_id == org_id)
    ).first()
    if not offer:
        raise HTTPException(status_code=404, detail="Payments offer not found")
    return PaymentsOfferRead.model_validate(offer)


async def update_payments_offer(
    request: Request,
    org_id: int,
    offer_id: int,
    offer_update: PaymentsOfferUpdate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> PaymentsOfferRead:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    offer = db_session.exec(
        select(PaymentsOffer).where(PaymentsOffer.id == offer_id, PaymentsOffer.org_id == org_id)
    ).first()
    if not offer:
        raise HTTPException(status_code=404, detail="Payments offer not found")

    for key, value in offer_update.model_dump().items():
        setattr(offer, key, value)
    offer.update_date = datetime.now()

    db_session.add(offer)
    db_session.commit()
    db_session.refresh(offer)

    config = db_session.exec(select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)).first()
    if config:
        provider = get_provider(config.provider)
        await provider.update_product(request, org_id, offer.provider_product_id, offer, current_user, db_session)
    return PaymentsOfferRead.model_validate(offer)


async def delete_payments_offer(
    request: Request,
    org_id: int,
    offer_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> None:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "delete", db_session)

    offer = db_session.exec(
        select(PaymentsOffer).where(PaymentsOffer.id == offer_id, PaymentsOffer.org_id == org_id)
    ).first()
    if not offer:
        raise HTTPException(status_code=404, detail="Payments offer not found")

    active_enrollments = db_session.exec(
        select(PaymentsEnrollment).where(
            PaymentsEnrollment.offer_id == offer_id,
            PaymentsEnrollment.status.in_([EnrollmentStatusEnum.ACTIVE, EnrollmentStatusEnum.COMPLETED]),  # type: ignore
        )
    ).all()
    if active_enrollments:
        raise HTTPException(status_code=400, detail="Cannot delete offer with active enrollments.")

    config = db_session.exec(select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)).first()
    if config:
        provider = get_provider(config.provider)
        await provider.archive_product(request, org_id, offer.provider_product_id, current_user, db_session)
    db_session.delete(offer)
    db_session.commit()


async def list_payments_offers(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> list[PaymentsOfferRead]:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    offers = db_session.exec(
        select(PaymentsOffer)
        .where(PaymentsOffer.org_id == org_id)
        .order_by(PaymentsOffer.id.desc())  # type: ignore
    ).all()
    return [PaymentsOfferRead.model_validate(o) for o in offers]


