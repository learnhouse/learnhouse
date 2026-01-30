import json
import logging
from datetime import datetime
from typing import Literal
from uuid import uuid4
from sqlmodel import Session, select
from src.db.organization_config import (
    AIOrgConfig,
    APIOrgConfig,
    AnalyticsOrgConfig,
    AssignmentOrgConfig,
    CollaborationOrgConfig,
    CollectionsOrgConfig,
    CommunitiesOrgConfig,
    CourseOrgConfig,
    DiscussionOrgConfig,
    MemberOrgConfig,
    OrgCloudConfig,
    OrgFeatureConfig,
    OrgGeneralConfig,
    OrganizationConfig,
    OrganizationConfigBase,
    PaymentOrgConfig,
    StorageOrgConfig,
    UserGroupOrgConfig,
)
from src.security.rbac.rbac import (
    authorization_verify_based_on_org_admin_status,
    authorization_verify_if_user_is_anon,
)
from src.db.users import AnonymousUser, APITokenUser, InternalUser, PublicUser
from src.db.user_organizations import UserOrganization
from src.db.organizations import (
    Organization,
    OrganizationCreate,
    OrganizationRead,
    OrganizationUpdate,
)
from fastapi import HTTPException, UploadFile, status, Request

from src.services.orgs.uploads import upload_org_logo, upload_org_preview, upload_org_thumbnail, upload_org_landing_content


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

    org_config = org_config = OrganizationConfigBase(
        config_version="1.1å",
        general=OrgGeneralConfig(
            enabled=True,
            color="",
            watermark=True,
        ),
        features=OrgFeatureConfig(
            courses=CourseOrgConfig(enabled=True, limit=0),
            members=MemberOrgConfig(
                enabled=True, signup_mode="open", admin_limit=0, limit=0
            ),
            usergroups=UserGroupOrgConfig(enabled=True, limit=0),
            storage=StorageOrgConfig(enabled=True, limit=0),
            ai=AIOrgConfig(enabled=True, limit=0, model=""),
            assignments=AssignmentOrgConfig(enabled=True, limit=0),
            payments=PaymentOrgConfig(enabled=True),
            discussions=DiscussionOrgConfig(enabled=True, limit=0),
            communities=CommunitiesOrgConfig(enabled=True),
            collections=CollectionsOrgConfig(enabled=True),
            analytics=AnalyticsOrgConfig(enabled=True, limit=0),
            collaboration=CollaborationOrgConfig(enabled=True, limit=0),
            api=APIOrgConfig(enabled=True, limit=0),
        ),
        cloud=OrgCloudConfig(plan="free", custom_domain=False),
    )

    org_config = json.loads(org_config.model_dump_json())

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

    org_config = json.loads(org_config.model_dump_json())

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


async def update_org_with_config_no_auth(
    request: Request,
    orgconfig: OrganizationConfigBase,
    org_id: int,
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

    updated_config = orgconfig

    # Update the database
    org_config.config = json.loads(updated_config.model_dump_json())
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "Organization updated"}


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

async def update_org_thumbnail(
    request: Request,
    thumbnail_file: UploadFile,
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
    name_in_disk = await upload_org_thumbnail(thumbnail_file, org.org_uuid)

    # Update org
    org.thumbnail_image = name_in_disk

    # Complete the org object
    org.update_date = str(datetime.now())

    db_session.add(org)
    db_session.commit()
    db_session.refresh(org)

    return {"detail": "Thumbnail updated"}

async def update_org_preview(
    request: Request,
    preview_file: UploadFile,
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
    name_in_disk = await upload_org_preview(preview_file, org.org_uuid)

    return {"name_in_disk": name_in_disk}

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


async def get_orgs_by_user_admin(
    request: Request,
    db_session: Session,
    user_id: str,
    page: int = 1,
    limit: int = 10,
) -> list[OrganizationRead]:
    # Join Organization, UserOrganization and OrganizationConfig in a single query
    statement = (
        select(Organization, OrganizationConfig)
        .join(UserOrganization)
        .outerjoin(OrganizationConfig)
        .where(
            UserOrganization.user_id == user_id,
            UserOrganization.role_id == 1,  # Only where the user is admin
            UserOrganization.org_id == Organization.id,
            OrganizationConfig.org_id == Organization.id
        )
        .offset((page - 1) * limit)
        .limit(limit)
    )

    # Execute single query to get all data
    result = db_session.exec(statement)
    org_data = result.all()

    # Process results in memory
    orgsWithConfig = []
    for org, org_config in org_data:
        config = OrganizationConfig.model_validate(org_config) if org_config else {}
        org_read = OrganizationRead(**org.model_dump(), config=config)
        orgsWithConfig.append(org_read)

    return orgsWithConfig


async def get_orgs_by_user(
    request: Request,
    db_session: Session,
    user_id: str,
    page: int = 1,
    limit: int = 10,
) -> list[OrganizationRead]:
    # Join Organization, UserOrganization and OrganizationConfig in a single query
    statement = (
        select(Organization, OrganizationConfig)
        .join(UserOrganization)
        .outerjoin(OrganizationConfig)
        .where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == Organization.id,
            OrganizationConfig.org_id == Organization.id
        )
        .offset((page - 1) * limit)
        .limit(limit)
    )

    # Execute single query to get all data
    result = db_session.exec(statement)
    org_data = result.all()

    # Process results in memory
    orgsWithConfig = []
    for org, org_config in org_data:
        config = OrganizationConfig.model_validate(org_config) if org_config else {}
        org_read = OrganizationRead(**org.model_dump(), config=config)
        orgsWithConfig.append(org_read)

    return orgsWithConfig


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
    updated_config.features.members.signup_mode = signup_mechanism

    # Update the database
    org_config.config = json.loads(updated_config.model_dump_json())
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "Signup mechanism updated"}


async def update_org_ai_config(
    request: Request,
    ai_enabled: bool,
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
    updated_config.features.ai.enabled = ai_enabled

    # Update the database
    org_config.config = json.loads(updated_config.model_dump_json())
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "AI configuration updated"}


async def update_org_communities_config(
    request: Request,
    communities_enabled: bool,
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

    # Create a deep copy to ensure SQLAlchemy detects the change
    updated_config = json.loads(json.dumps(org_config.config))

    # Handle backward compatibility - add communities config if it doesn't exist
    if "features" not in updated_config:
        updated_config["features"] = {}

    if "communities" not in updated_config["features"]:
        updated_config["features"]["communities"] = {"enabled": True}

    # Update config
    updated_config["features"]["communities"]["enabled"] = communities_enabled

    # Update the database with the new dictionary
    org_config.config = updated_config
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "Communities configuration updated"}


async def update_org_payments_config(
    request: Request,
    payments_enabled: bool,
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

    # Create a deep copy to ensure SQLAlchemy detects the change
    updated_config = json.loads(json.dumps(org_config.config))

    # Handle backward compatibility
    if "features" not in updated_config:
        updated_config["features"] = {}

    if "payments" not in updated_config["features"]:
        updated_config["features"]["payments"] = {"enabled": False}

    # Update config
    updated_config["features"]["payments"]["enabled"] = payments_enabled

    # Update the database with the new dictionary
    org_config.config = updated_config
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "Payments configuration updated"}


async def update_org_collections_config(
    request: Request,
    collections_enabled: bool,
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

    # Create a deep copy to ensure SQLAlchemy detects the change
    updated_config = json.loads(json.dumps(org_config.config))

    # Handle backward compatibility
    if "features" not in updated_config:
        updated_config["features"] = {}

    if "collections" not in updated_config["features"]:
        updated_config["features"]["collections"] = {"enabled": True}

    # Update config
    updated_config["features"]["collections"]["enabled"] = collections_enabled

    # Update the database with the new dictionary
    org_config.config = updated_config
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "Collections configuration updated"}


async def update_org_color_config(
    request: Request,
    color: str,
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

    # Create a deep copy to ensure SQLAlchemy detects the change
    updated_config = json.loads(json.dumps(org_config.config))

    # Handle backward compatibility
    if "general" not in updated_config:
        updated_config["general"] = {"enabled": True, "color": "", "watermark": True}

    # Update config
    updated_config["general"]["color"] = color

    # Update the database with the new dictionary
    org_config.config = updated_config
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "Color configuration updated"}


async def update_org_footer_text_config(
    request: Request,
    footer_text: str,
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

    # Create a deep copy to ensure SQLAlchemy detects the change
    updated_config = json.loads(json.dumps(org_config.config))

    # Handle backward compatibility
    if "general" not in updated_config:
        updated_config["general"] = {"enabled": True, "color": "", "footer_text": "", "watermark": True}

    # Update config
    updated_config["general"]["footer_text"] = footer_text

    # Update the database with the new dictionary
    org_config.config = updated_config
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "Footer text configuration updated"}


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
    signup_mechanism = config.features.members.signup_mode

    return signup_mechanism

async def upload_org_preview_service(
    preview_file: UploadFile,
    org_uuid: str,
) -> dict:
    # No need for request or current_user since we're not doing RBAC checks for previews
    
    # Upload preview
    name_in_disk = await upload_org_preview(preview_file, org_uuid)

    return {
        "detail": "Preview uploaded successfully",
        "filename": name_in_disk
    }

async def update_org_landing(
    request: Request,
    landing_object: dict,
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

    # Convert to OrganizationConfigBase model and back to ensure all fields exist
    config_model = OrganizationConfigBase(**org_config.config)
    
    # Update the landing object
    config_model.landing = landing_object

    # Convert back to dict and update
    updated_config = json.loads(config_model.model_dump_json())
    org_config.config = updated_config
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "Landing object updated"}

async def upload_org_landing_content_service(
    request: Request,
    content_file: UploadFile,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> dict:
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

    # Upload content
    name_in_disk = await upload_org_landing_content(content_file, org.org_uuid)

    return {
        "detail": "Landing content uploaded successfully",
        "filename": name_in_disk
    }

## 🔒 RBAC Utils ##


async def rbac_check(
    request: Request,
    org_uuid: str,
    current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
):
    # Organizations are readable by anyone
    if action == "read":
        return True

    # Internal users can do anything
    if isinstance(current_user, InternalUser):
        return True

    # API Token path: verify token has permissions for this action on payments
    if isinstance(current_user, APITokenUser):
        # Verify token belongs to this organization
        org = db_session.exec(
            select(Organization).where(Organization.org_uuid == org_uuid)
        ).first()

        if not org or org.id != current_user.org_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API token cannot access resources outside its organization",
            )

        # Check token's rights for payments
        if not current_user.rights:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API token has no permissions configured",
            )

        rights = current_user.rights
        if isinstance(rights, dict):
            payments_rights = rights.get("payments", {})
            has_permission = payments_rights.get(f"action_{action}", False)
        else:
            payments_rights = getattr(rights, "payments", None)
            has_permission = getattr(payments_rights, f"action_{action}", False) if payments_rights else False

        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"API token does not have '{action}' permission for payments",
            )
        return True

    # Regular user path
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
