import json
import logging
from datetime import datetime
from typing import Literal
from uuid import uuid4
from sqlmodel import Session, select
from src.db.organization_config import (
    AIConfig,
    AIEnabledFeatures,
    AILimitsSettings,
    GeneralConfig,
    LimitSettings,
    OrgUserConfig,
    OrganizationConfig,
    OrganizationConfigBase,
)
from src.security.rbac.rbac import (
    authorization_verify_based_on_org_admin_status,
    authorization_verify_if_user_is_anon,
)
from src.db.users import AnonymousUser, PublicUser
from src.db.user_organizations import UserOrganization
from src.db.organizations import (
    Organization,
    OrganizationCreate,
    OrganizationRead,
    OrganizationUpdate,
)
from src.services.orgs.logos import upload_org_logo
from fastapi import HTTPException, UploadFile, status, Request


async def get_organization(
    request: Request,
    org_id: str,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
) -> OrganizationRead:
    statement = select(Organization).where(Organization.id == org_id)
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    # Get org config
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    result = db_session.exec(statement)

    org_config = result.first()

    if org_config is None:
        logging.error(f"Organization {org_id} has no config")

    config = OrganizationConfig.model_validate(org_config) if org_config else {}

    org = OrganizationRead(**org.model_dump(), config=config)

    return org


async def get_organization_by_slug(
    request: Request,
    org_slug: str,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
) -> OrganizationRead:
    statement = select(Organization).where(Organization.slug == org_slug)
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    # Get org config
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    result = db_session.exec(statement)

    org_config = result.first()

    if org_config is None:
        logging.error(f"Organization {org_slug} has no config")

    config = OrganizationConfig.model_validate(org_config) if org_config else {}

    org = OrganizationRead(**org.model_dump(), config=config)

    return org


async def create_org(
    request: Request,
    org_object: OrganizationCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Organization).where(Organization.slug == org_object.slug)
    result = db_session.exec(statement)

    org = result.first()

    if org:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Organization already exists",
        )

    org = Organization.model_validate(org_object)

    if isinstance(current_user, AnonymousUser):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You should be logged in to be able to achieve this action",
        )

    # Complete the org object
    org.org_uuid = f"org_{uuid4()}"
    org.creation_date = str(datetime.now())
    org.update_date = str(datetime.now())

    db_session.add(org)
    db_session.commit()
    db_session.refresh(org)

    # Link user to org
    user_org = UserOrganization(
        user_id=int(current_user.id),
        org_id=int(org.id if org.id else 0),
        role_id=1,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(user_org)
    db_session.commit()
    db_session.refresh(user_org)

    org_config = OrganizationConfigBase(
        GeneralConfig=GeneralConfig(
            color="#000000",
            limits=LimitSettings(
                limits_enabled=False,
                max_users=0,
                max_storage=0,
                max_staff=0,
            ),
            collaboration=False,
            users=OrgUserConfig(
                signup_mechanism="open",
            ),
            active=True,
        ),
        AIConfig=AIConfig(
            enabled=False,
            limits=AILimitsSettings(
                limits_enabled=False,
                max_asks=0,
            ),
            embeddings="text-embedding-ada-002",
            ai_model="gpt-3.5-turbo",
            features=AIEnabledFeatures(
                editor=False,
                activity_ask=False,
                course_ask=False,
                global_ai_ask=False,
            ),
        ),
    )

    org_config = json.loads(org_config.json())

    # OrgSettings
    org_settings = OrganizationConfig(
        org_id=int(org.id if org.id else 0),
        config=org_config,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(org_settings)
    db_session.commit()
    db_session.refresh(org_settings)

    # Get org config
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    result = db_session.exec(statement)

    org_config = result.first()

    if org_config is None:
        logging.error(f"Organization {org.id} has no config")

    config = OrganizationConfig.model_validate(org_config)

    org = OrganizationRead(**org.model_dump(), config=config)

    return org


# Temporary pre-alpha code
async def create_org_with_config(
    request: Request,
    org_object: OrganizationCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
    submitted_config: OrganizationConfigBase,
):
    statement = select(Organization).where(Organization.slug == org_object.slug)
    result = db_session.exec(statement)

    org = result.first()

    if org:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Organization already exists",
        )

    org = Organization.model_validate(org_object)

    if isinstance(current_user, AnonymousUser):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You should be logged in to be able to achieve this action",
        )

    # Complete the org object
    org.org_uuid = f"org_{uuid4()}"
    org.creation_date = str(datetime.now())
    org.update_date = str(datetime.now())

    db_session.add(org)
    db_session.commit()
    db_session.refresh(org)

    # Link user to org
    user_org = UserOrganization(
        user_id=int(current_user.id),
        org_id=int(org.id if org.id else 0),
        role_id=1,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(user_org)
    db_session.commit()
    db_session.refresh(user_org)

    org_config = submitted_config

    org_config = json.loads(org_config.json())

    # OrgSettings
    org_settings = OrganizationConfig(
        org_id=int(org.id if org.id else 0),
        config=org_config,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(org_settings)
    db_session.commit()
    db_session.refresh(org_settings)

    # Get org config
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    result = db_session.exec(statement)

    org_config = result.first()

    if org_config is None:
        logging.error(f"Organization {org.id} has no config")

    config = OrganizationConfig.model_validate(org_config)

    org = OrganizationRead(**org.model_dump(), config=config)

    return org


async def update_org(
    request: Request,
    org_object: OrganizationUpdate,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Organization).where(Organization.id == org_id)
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization slug not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    # Verify if the new slug is already in use
    statement = select(Organization).where(Organization.slug == org_object.slug)
    result = db_session.exec(statement)

    slug_available = result.first()

    if slug_available and slug_available.id != org_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Organization slug already exists",
        )

    # Update only the fields that were passed in
    for var, value in vars(org_object).items():
        if value is not None:
            setattr(org, var, value)

    # Complete the org object
    org.update_date = str(datetime.now())

    db_session.add(org)
    db_session.commit()
    db_session.refresh(org)

    org = OrganizationRead.model_validate(org)

    return org


async def update_org_logo(
    request: Request,
    logo_file: UploadFile,
    org_id: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Organization).where(Organization.id == org_id)
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    # Upload logo
    name_in_disk = await upload_org_logo(logo_file, org.org_uuid)

    # Update org
    org.logo_image = name_in_disk

    # Complete the org object
    org.update_date = str(datetime.now())

    db_session.add(org)
    db_session.commit()
    db_session.refresh(org)

    return {"detail": "Logo updated"}


async def delete_org(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Organization).where(Organization.id == org_id)
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "delete", db_session)

    db_session.delete(org)
    db_session.commit()

    # Delete links to org
    statement = select(UserOrganization).where(UserOrganization.org_id == org_id)
    result = db_session.exec(statement)

    user_orgs = result.all()

    for user_org in user_orgs:
        db_session.delete(user_org)
        db_session.commit()

    db_session.refresh(org)

    return {"detail": "Organization deleted"}


async def get_orgs_by_user(
    request: Request,
    db_session: Session,
    user_id: str,
    page: int = 1,
    limit: int = 10,
) -> list[Organization]:
    statement = (
        select(Organization)
        .join(UserOrganization)
        .where(
            Organization.id == UserOrganization.org_id,
            UserOrganization.user_id == user_id,
        )
    )
    result = db_session.exec(statement)

    orgs = result.all()

    return orgs #type:ignore

# Config related
async def update_org_signup_mechanism(
    request: Request,
    signup_mechanism: Literal["open", "inviteOnly"],
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Organization).where(Organization.id == org_id)
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    # Get org config
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    result = db_session.exec(statement)

    org_config = result.first()

    if org_config is None:
        logging.error(f"Organization {org_id} has no config")
        raise HTTPException(
            status_code=404,
            detail="Organization config not found",
        )

    updated_config = org_config.config

    # Update config
    updated_config = OrganizationConfigBase(**updated_config)
    updated_config.GeneralConfig.users.signup_mechanism = signup_mechanism

    # Update the database
    org_config.config = json.loads(updated_config.json())
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "Signup mechanism updated"}


async def get_org_join_mechanism(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Organization).where(Organization.id == org_id)
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    # Get org config
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    result = db_session.exec(statement)

    org_config = result.first()

    if org_config is None:
        logging.error(f"Organization {org_id} has no config")
        raise HTTPException(
            status_code=404,
            detail="Organization config not found",
        )

    config = org_config.config

    # Get the signup mechanism
    config = OrganizationConfigBase(**config)
    signup_mechanism = config.GeneralConfig.users.signup_mechanism

    return signup_mechanism


## 🔒 RBAC Utils ##


async def rbac_check(
    request: Request,
    org_uuid: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
):
    # Organizations are readable by anyone
    if action == "read":
        return True

    else:
        isUserAnon = await authorization_verify_if_user_is_anon(current_user.id)

        isAllowedOnOrgAdminStatus = (
            await authorization_verify_based_on_org_admin_status(
                request, current_user.id, action, org_uuid, db_session
            )
        )

        if isUserAnon:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="You should be logged in to be able to achieve this action",
            )

        if not isAllowedOnOrgAdminStatus:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User rights (admin status) : You don't have the right to perform this action",
            )


## 🔒 RBAC Utils ##
