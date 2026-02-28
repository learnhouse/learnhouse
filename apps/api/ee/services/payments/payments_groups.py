from fastapi import HTTPException, Request
from sqlmodel import Session, select
from datetime import datetime

from ee.db.payments.payments_groups import (
    PaymentsGroup,
    PaymentsGroupCreate,
    PaymentsGroupRead,
    PaymentsGroupResource,
    PaymentsGroupSync,
    PaymentsGroupUpdate,
)
from src.db.organizations import Organization
from src.db.usergroups import UserGroup
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.services.orgs.orgs import rbac_check


async def create_payments_group(
    request: Request,
    org_id: int,
    data: PaymentsGroupCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> PaymentsGroupRead:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "create", db_session)

    group = PaymentsGroup(
        org_id=org_id,
        name=data.name,
        description=data.description,
        creation_date=datetime.now(),
        update_date=datetime.now(),
    )
    db_session.add(group)
    db_session.commit()
    db_session.refresh(group)
    return PaymentsGroupRead.model_validate(group)


async def list_payments_groups(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> list[PaymentsGroupRead]:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    groups = db_session.exec(
        select(PaymentsGroup).where(PaymentsGroup.org_id == org_id).order_by(PaymentsGroup.id.desc())  # type: ignore
    ).all()
    return [PaymentsGroupRead.model_validate(g) for g in groups]


async def get_payments_group(
    request: Request,
    org_id: int,
    group_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> PaymentsGroupRead:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    group = db_session.exec(
        select(PaymentsGroup).where(PaymentsGroup.id == group_id, PaymentsGroup.org_id == org_id)
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="PaymentsGroup not found")
    return PaymentsGroupRead.model_validate(group)


async def update_payments_group(
    request: Request,
    org_id: int,
    group_id: int,
    data: PaymentsGroupUpdate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> PaymentsGroupRead:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    group = db_session.exec(
        select(PaymentsGroup).where(PaymentsGroup.id == group_id, PaymentsGroup.org_id == org_id)
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="PaymentsGroup not found")

    group.name = data.name
    group.description = data.description
    group.update_date = datetime.now()
    db_session.add(group)
    db_session.commit()
    db_session.refresh(group)
    return PaymentsGroupRead.model_validate(group)


async def delete_payments_group(
    request: Request,
    org_id: int,
    group_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> None:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "delete", db_session)

    group = db_session.exec(
        select(PaymentsGroup).where(PaymentsGroup.id == group_id, PaymentsGroup.org_id == org_id)
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="PaymentsGroup not found")

    db_session.delete(group)
    db_session.commit()


# ---------------------------------------------------------------------------
# Resource management
# ---------------------------------------------------------------------------

async def add_resource_to_group(
    request: Request,
    org_id: int,
    group_id: int,
    resource_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> dict:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    group = db_session.exec(
        select(PaymentsGroup).where(PaymentsGroup.id == group_id, PaymentsGroup.org_id == org_id)
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="PaymentsGroup not found")

    existing = db_session.exec(
        select(PaymentsGroupResource).where(
            PaymentsGroupResource.payments_group_id == group_id,
            PaymentsGroupResource.resource_uuid == resource_uuid,
        )
    ).first()
    if existing:
        return {"message": "Resource already in group"}

    db_session.add(PaymentsGroupResource(
        payments_group_id=group_id,
        resource_uuid=resource_uuid,
        org_id=org_id,
        creation_date=datetime.now(),
        update_date=datetime.now(),
    ))
    db_session.commit()
    return {"message": "Resource added"}


async def remove_resource_from_group(
    request: Request,
    org_id: int,
    group_id: int,
    resource_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> None:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    row = db_session.exec(
        select(PaymentsGroupResource).where(
            PaymentsGroupResource.payments_group_id == group_id,
            PaymentsGroupResource.resource_uuid == resource_uuid,
        )
    ).first()
    if row:
        db_session.delete(row)
        db_session.commit()


async def list_group_resources(
    org_id: int,
    group_id: int,
    db_session: Session,
) -> list[str]:
    rows = db_session.exec(
        select(PaymentsGroupResource).where(PaymentsGroupResource.payments_group_id == group_id)
    ).all()
    return [r.resource_uuid for r in rows]


# ---------------------------------------------------------------------------
# UserGroup sync management
# ---------------------------------------------------------------------------

async def add_sync(
    request: Request,
    org_id: int,
    group_id: int,
    usergroup_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> dict:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    ug = db_session.exec(
        select(UserGroup).where(UserGroup.id == usergroup_id, UserGroup.org_id == org_id)
    ).first()
    if not ug:
        raise HTTPException(status_code=404, detail="UserGroup not found")

    existing = db_session.exec(
        select(PaymentsGroupSync).where(
            PaymentsGroupSync.payments_group_id == group_id,
            PaymentsGroupSync.usergroup_id == usergroup_id,
        )
    ).first()
    if not existing:
        db_session.add(PaymentsGroupSync(payments_group_id=group_id, usergroup_id=usergroup_id))
        db_session.commit()
    return {"message": "Sync added"}


async def remove_sync(
    request: Request,
    org_id: int,
    group_id: int,
    usergroup_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> None:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    row = db_session.exec(
        select(PaymentsGroupSync).where(
            PaymentsGroupSync.payments_group_id == group_id,
            PaymentsGroupSync.usergroup_id == usergroup_id,
        )
    ).first()
    if row:
        db_session.delete(row)
        db_session.commit()


async def list_syncs(
    org_id: int,
    group_id: int,
    db_session: Session,
) -> list[dict]:
    rows = db_session.exec(
        select(PaymentsGroupSync, UserGroup)
        .join(UserGroup, PaymentsGroupSync.usergroup_id == UserGroup.id)  # type: ignore
        .where(PaymentsGroupSync.payments_group_id == group_id)
    ).all()
    return [{"usergroup_id": ug.id, "usergroup_name": ug.name} for _, ug in rows]


# ---------------------------------------------------------------------------
# Offer-level direct resource management
# ---------------------------------------------------------------------------

async def add_offer_resource(
    request: Request,
    org_id: int,
    offer_id: int,
    resource_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> dict:
    from ee.db.payments.payments_offers import PaymentsOffer
    from ee.db.payments.payments_groups import PaymentsOfferResource

    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    offer = db_session.exec(
        select(PaymentsOffer).where(PaymentsOffer.id == offer_id, PaymentsOffer.org_id == org_id)
    ).first()
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")

    existing = db_session.exec(
        select(PaymentsOfferResource).where(
            PaymentsOfferResource.offer_id == offer_id,
            PaymentsOfferResource.resource_uuid == resource_uuid,
        )
    ).first()
    if existing:
        return {"message": "Resource already linked to offer"}

    db_session.add(PaymentsOfferResource(
        offer_id=offer_id,
        resource_uuid=resource_uuid,
        org_id=org_id,
        creation_date=datetime.now(),
        update_date=datetime.now(),
    ))
    db_session.commit()
    return {"message": "Resource linked to offer"}


async def remove_offer_resource(
    request: Request,
    org_id: int,
    offer_id: int,
    resource_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> None:
    from ee.db.payments.payments_groups import PaymentsOfferResource

    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    row = db_session.exec(
        select(PaymentsOfferResource).where(
            PaymentsOfferResource.offer_id == offer_id,
            PaymentsOfferResource.resource_uuid == resource_uuid,
        )
    ).first()
    if row:
        db_session.delete(row)
        db_session.commit()


async def list_offer_resources(
    offer_id: int,
    db_session: Session,
) -> list[str]:
    from ee.db.payments.payments_groups import PaymentsOfferResource
    rows = db_session.exec(
        select(PaymentsOfferResource).where(PaymentsOfferResource.offer_id == offer_id)
    ).all()
    return [r.resource_uuid for r in rows]
