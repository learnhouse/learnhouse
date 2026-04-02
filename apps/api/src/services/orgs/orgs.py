import json
import logging
from datetime import datetime
from typing import Literal, Optional
from uuid import uuid4
from sqlmodel import Session, select
from src.db.organization_config import (
    OrganizationConfig,
    OrganizationConfigBase,
)
from src.security.rbac.rbac import (
    authorization_verify_based_on_org_admin_status,
    authorization_verify_if_user_is_anon,
)
from src.security.rbac.constants import ADMIN_ROLE_ID
from src.db.users import AnonymousUser, APITokenUser, InternalUser, PublicUser
from src.db.user_organizations import UserOrganization
from src.db.organizations import (
    Organization,
    OrganizationCreate,
    OrganizationRead,
    OrganizationUpdate,
)
from fastapi import HTTPException, UploadFile, status, Request

from src.services.orgs.uploads import upload_org_logo, upload_org_preview, upload_org_thumbnail, upload_org_landing_content, upload_org_auth_background, upload_org_og_image, upload_org_favicon
from src.db.organization_config import AuthBrandingConfig, SeoOrgConfig
from src.core.ee_hooks import is_multi_org_allowed


def _build_org_read_with_resolved(org, org_config) -> OrganizationRead:
    """Build OrganizationRead with resolved_features attached."""
    from src.security.features_utils.resolve import resolve_all_features

    config = OrganizationConfig.model_validate(org_config) if org_config else {}
    org_read = OrganizationRead(**org.model_dump(), config=config)

    # Attach resolved_features as extra data on the config
    if org_config and org_config.config:
        resolved = resolve_all_features(org_config.config, org.id or 0)
        # Inject into the config dict so it's returned in the response
        config_dict = org_config.config.copy() if org_config.config else {}
        config_dict["resolved_features"] = resolved
        org_read.config = OrganizationConfig(
            id=org_config.id,
            org_id=org_config.org_id,
            config=config_dict,
            creation_date=org_config.creation_date,
            update_date=org_config.update_date,
        )

    return org_read


async def get_organization_by_uuid(
    request: Request,
    org_uuid: str,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
) -> OrganizationRead:
    statement = select(Organization).where(Organization.org_uuid == org_uuid)
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
        logging.error(f"Organization {org_uuid} has no config")

    return _build_org_read_with_resolved(org, org_config)


async def get_organization_by_slug(
    request: Request,
    org_slug: str,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
) -> OrganizationRead:
    from src.services.orgs.cache import get_cached_org_by_slug, set_cached_org_by_slug

    # Check Redis cache first (org read is public, no RBAC needed)
    cached = get_cached_org_by_slug(org_slug)
    if cached is not None:
        return OrganizationRead(**cached)

    statement = select(Organization).where(Organization.slug == org_slug).order_by(Organization.id)
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    result = db_session.exec(statement)

    org_config = result.first()

    if org_config is None:
        logging.error(f"Organization {org_slug} has no config")

    org_read = _build_org_read_with_resolved(org, org_config)

    try:
        set_cached_org_by_slug(org_slug, org_read.model_dump(mode="json"))
    except Exception:
        pass

    return org_read


async def create_org(
    request: Request,
    org_object: OrganizationCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    # EE gating: only allow multiple orgs with Enterprise Edition
    if not is_multi_org_allowed():
        existing_org = db_session.exec(select(Organization).limit(1)).first()
        if existing_org is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Multi-organization mode requires Enterprise Edition",
            )

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

    # Invalidate session cache so the new org role is picked up immediately
    from src.routers.users import _invalidate_session_cache
    _invalidate_session_cache(int(current_user.id))

    from src.db.organization_config import OrganizationConfigV2Base
    org_config = OrganizationConfigV2Base(
        config_version="2.0",
        plan="free",
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
    submitted_config: dict | OrganizationConfigBase,
):
    # EE gating: only allow multiple orgs with Enterprise Edition
    if not is_multi_org_allowed():
        existing_org = db_session.exec(select(Organization).limit(1)).first()
        if existing_org is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Multi-organization mode requires Enterprise Edition",
            )

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

    # Invalidate session cache so the new org role is picked up immediately
    from src.routers.users import _invalidate_session_cache
    _invalidate_session_cache(int(current_user.id))

    # Support both dict (v2) and Pydantic model (v1) inputs
    if isinstance(submitted_config, dict):
        org_config = submitted_config
    else:
        org_config = json.loads(submitted_config.model_dump_json())

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
    orgconfig: dict | OrganizationConfigBase,
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

    # Support both dict (v2) and Pydantic model (v1) inputs
    if isinstance(orgconfig, dict):
        config_dict = orgconfig
    else:
        config_dict = json.loads(orgconfig.model_dump_json())

    # Update the database
    org_config.config = config_dict
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "Organization updated"}


async def update_org_logo(
    request: Request,
    logo_file: UploadFile,
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


async def update_org_favicon(
    request: Request,
    favicon_file: UploadFile,
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

    # Upload favicon
    name_in_disk = await upload_org_favicon(favicon_file, org.org_uuid)

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

    updated_config = _deep_copy_config(org_config)

    if _is_v2_config(updated_config):
        updated_config.setdefault("customization", {}).setdefault("general", {})
        updated_config["customization"]["general"]["favicon_image"] = name_in_disk
    else:
        if "general" not in updated_config:
            updated_config["general"] = {"enabled": True, "color": "", "footer_text": "", "watermark": True, "favicon_image": "", "auth_branding": {}}
        updated_config["general"]["favicon_image"] = name_in_disk

    org_config.config = updated_config
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "Favicon updated"}


async def update_org_thumbnail(
    request: Request,
    thumbnail_file: UploadFile,
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

    # Upload logo
    name_in_disk = await upload_org_preview(preview_file, org.org_uuid)

    return {"name_in_disk": name_in_disk}

async def delete_org(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    """
    Delete an organization and all related data.

    SECURITY: Only organization admins can delete their own organization.
    The RBAC check ensures the user has admin role (role_id=1) specifically
    in the organization being deleted.

    CASCADE DELETE: Related data is automatically deleted via database
    CASCADE constraints on foreign keys.
    """
    statement = select(Organization).where(Organization.id == org_id)
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # Store org info for logging before deletion
    org_uuid = org.org_uuid
    org_name = org.name

    # RBAC check - verifies user is admin of THIS specific organization
    await rbac_check(request, org.org_uuid, current_user, "delete", db_session)

    # AUDIT LOG: Record the deletion for security audit trail
    user_id = current_user.id if hasattr(current_user, 'id') else 'unknown'
    logging.warning(
        f"AUDIT: Organization deletion - org_id={org_id}, org_uuid={org_uuid}, "
        f"org_name={org_name}, deleted_by_user_id={user_id}"
    )

    # Invalidate session cache for all users in this org before deletion
    from src.routers.users import _invalidate_session_cache
    affected_users = db_session.exec(
        select(UserOrganization.user_id).where(UserOrganization.org_id == org_id)
    ).all()
    for uid in affected_users:
        _invalidate_session_cache(uid)

    # Delete the organization
    # Related data (UserOrganization, Courses, Collections, etc.) will be
    # automatically deleted via CASCADE constraints in the database
    db_session.delete(org)
    db_session.commit()

    return {"detail": "Organization deleted", "org_id": org_id, "org_name": org_name}


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
            UserOrganization.role_id == ADMIN_ROLE_ID,  # Only where the user is admin
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
def _deep_copy_config(org_config: OrganizationConfig) -> dict:
    """Deep copy config dict so SQLAlchemy detects changes."""
    return json.loads(json.dumps(org_config.config or {}))


def _is_v2_config(config: dict) -> bool:
    """Check if config is v2 format."""
    return config.get("config_version", "1.0").startswith("2")


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

    updated_config = _deep_copy_config(org_config)

    if _is_v2_config(updated_config):
        updated_config.setdefault("admin_toggles", {}).setdefault("members", {})
        updated_config["admin_toggles"]["members"]["signup_mode"] = signup_mechanism
    else:
        updated_config.setdefault("features", {}).setdefault("members", {
            "enabled": True, "signup_mode": "open", "admin_limit": 1, "limit": 10
        })
        updated_config["features"]["members"]["signup_mode"] = signup_mechanism

    org_config.config = updated_config
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "Signup mechanism updated"}


async def update_org_ai_config(
    request: Request,
    ai_enabled: Optional[bool],
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
    copilot_enabled: Optional[bool] = None,
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

    updated_config = _deep_copy_config(org_config)

    if _is_v2_config(updated_config):
        updated_config.setdefault("admin_toggles", {}).setdefault("ai", {})
        if ai_enabled is not None:
            updated_config["admin_toggles"]["ai"]["disabled"] = not ai_enabled
        if copilot_enabled is not None:
            updated_config["admin_toggles"]["ai"]["copilot_enabled"] = copilot_enabled
    else:
        updated_config.setdefault("features", {}).setdefault("ai", {"enabled": True, "limit": 10})
        if ai_enabled is not None:
            updated_config["features"]["ai"]["enabled"] = ai_enabled
        if copilot_enabled is not None:
            updated_config["features"]["ai"]["copilot_enabled"] = copilot_enabled
        if "model" in updated_config["features"]["ai"]:
            del updated_config["features"]["ai"]["model"]

    org_config.config = updated_config
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "AI configuration updated"}


async def _update_feature_toggle(
    request: Request,
    feature: str,
    enabled: bool,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
    v1_default: dict | None = None,
) -> dict:
    """Generic helper for updating a feature's enabled/disabled state."""
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    org_config = db_session.exec(statement).first()

    if org_config is None:
        raise HTTPException(status_code=404, detail="Organization config not found")

    updated_config = _deep_copy_config(org_config)

    if _is_v2_config(updated_config):
        updated_config.setdefault("admin_toggles", {}).setdefault(feature, {})
        updated_config["admin_toggles"][feature]["disabled"] = not enabled
    else:
        updated_config.setdefault("features", {})
        if feature not in updated_config["features"]:
            updated_config["features"][feature] = v1_default or {"enabled": True}
        updated_config["features"][feature]["enabled"] = enabled

    org_config.config = updated_config
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": f"{feature.capitalize()} configuration updated"}


async def update_org_communities_config(
    request: Request,
    communities_enabled: bool,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    return await _update_feature_toggle(
        request, "communities", communities_enabled, org_id, current_user, db_session,
        v1_default={"enabled": True},
    )


async def update_org_payments_config(
    request: Request,
    payments_enabled: bool,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    return await _update_feature_toggle(
        request, "payments", payments_enabled, org_id, current_user, db_session,
        v1_default={"enabled": False},
    )


async def update_org_collections_config(
    request: Request,
    collections_enabled: bool,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    return await _update_feature_toggle(
        request, "collections", collections_enabled, org_id, current_user, db_session,
        v1_default={"enabled": True},
    )


async def update_org_courses_config(
    request: Request,
    courses_enabled: bool,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    return await _update_feature_toggle(
        request, "courses", courses_enabled, org_id, current_user, db_session,
        v1_default={"enabled": True, "limit": 100},
    )


async def update_org_podcasts_config(
    request: Request,
    podcasts_enabled: bool,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    return await _update_feature_toggle(
        request, "podcasts", podcasts_enabled, org_id, current_user, db_session,
        v1_default={"enabled": False, "limit": 10},
    )


async def update_org_boards_config(
    request: Request,
    boards_enabled: bool,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    return await _update_feature_toggle(
        request, "boards", boards_enabled, org_id, current_user, db_session,
        v1_default={"enabled": False, "limit": 10},
    )


async def update_org_playgrounds_config(
    request: Request,
    playgrounds_enabled: bool,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    return await _update_feature_toggle(
        request, "playgrounds", playgrounds_enabled, org_id, current_user, db_session,
        v1_default={"enabled": False, "limit": 10},
    )


async def update_org_color_config(
    request: Request,
    color: str,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    org_config = db_session.exec(statement).first()

    if org_config is None:
        raise HTTPException(status_code=404, detail="Organization config not found")

    updated_config = _deep_copy_config(org_config)

    if _is_v2_config(updated_config):
        updated_config.setdefault("customization", {}).setdefault("general", {})
        updated_config["customization"]["general"]["color"] = color
    else:
        updated_config.setdefault("general", {"enabled": True, "color": "", "watermark": True})
        updated_config["general"]["color"] = color

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
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    org_config = db_session.exec(statement).first()

    if org_config is None:
        raise HTTPException(status_code=404, detail="Organization config not found")

    updated_config = _deep_copy_config(org_config)

    if _is_v2_config(updated_config):
        updated_config.setdefault("customization", {}).setdefault("general", {})
        updated_config["customization"]["general"]["footer_text"] = footer_text
    else:
        updated_config.setdefault("general", {"enabled": True, "color": "", "footer_text": "", "watermark": True})
        updated_config["general"]["footer_text"] = footer_text

    org_config.config = updated_config
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "Footer text configuration updated"}


async def update_org_font_config(
    request: Request,
    font: str,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    org_config = db_session.exec(statement).first()

    if org_config is None:
        raise HTTPException(status_code=404, detail="Organization config not found")

    updated_config = _deep_copy_config(org_config)

    if _is_v2_config(updated_config):
        updated_config.setdefault("customization", {}).setdefault("general", {})
        updated_config["customization"]["general"]["font"] = font
    else:
        updated_config.setdefault("general", {"enabled": True, "color": "", "watermark": True})
        updated_config["general"]["font"] = font

    org_config.config = updated_config
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "Font configuration updated"}


async def update_org_watermark_config(
    request: Request,
    watermark_enabled: bool,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    org_config = db_session.exec(statement).first()

    if org_config is None:
        raise HTTPException(status_code=404, detail="Organization config not found")

    updated_config = _deep_copy_config(org_config)

    # Free plan always shows watermark
    plan = updated_config.get("plan", updated_config.get("cloud", {}).get("plan", "free"))
    if plan == "free" and not watermark_enabled:
        raise HTTPException(status_code=403, detail="Watermark cannot be disabled on the free plan")

    if _is_v2_config(updated_config):
        updated_config.setdefault("customization", {}).setdefault("general", {})
        updated_config["customization"]["general"]["watermark"] = watermark_enabled
    else:
        updated_config.setdefault("general", {})
        updated_config["general"]["watermark"] = watermark_enabled

    org_config.config = updated_config
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "Watermark configuration updated"}


async def update_org_auth_branding_config(
    request: Request,
    auth_branding: AuthBrandingConfig,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    org_config = db_session.exec(statement).first()

    if org_config is None:
        raise HTTPException(status_code=404, detail="Organization config not found")

    updated_config = _deep_copy_config(org_config)
    branding_data = json.loads(auth_branding.model_dump_json())

    if _is_v2_config(updated_config):
        updated_config.setdefault("customization", {})
        updated_config["customization"]["auth_branding"] = branding_data
    else:
        updated_config.setdefault("general", {"enabled": True, "color": "", "footer_text": "", "watermark": True, "auth_branding": {}})
        updated_config["general"]["auth_branding"] = branding_data

    org_config.config = updated_config
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "Auth branding configuration updated"}


async def upload_org_auth_background_service(
    request: Request,
    background_file: UploadFile,
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

    # Upload background
    name_in_disk = await upload_org_auth_background(background_file, org.org_uuid)

    return {
        "detail": "Auth background uploaded successfully",
        "filename": name_in_disk
    }


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

    config = org_config.config or {}
    version = config.get("config_version", "1.0")

    if version.startswith("2"):
        signup_mechanism = config.get("admin_toggles", {}).get("members", {}).get("signup_mode", "open")
    else:
        signup_mechanism = config.get("features", {}).get("members", {}).get("signup_mode", "open")

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

    updated_config = _deep_copy_config(org_config)

    if _is_v2_config(updated_config):
        updated_config.setdefault("customization", {})
        updated_config["customization"]["landing"] = landing_object
    else:
        updated_config["landing"] = landing_object

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

async def update_org_seo_config(
    request: Request,
    seo_config: SeoOrgConfig,
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

    updated_config = _deep_copy_config(org_config)
    seo_data = json.loads(seo_config.model_dump_json())

    if _is_v2_config(updated_config):
        updated_config.setdefault("customization", {})
        updated_config["customization"]["seo"] = seo_data
    else:
        updated_config["seo"] = seo_data

    # Update the database with the new dictionary
    org_config.config = updated_config
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"detail": "SEO configuration updated"}


async def upload_org_og_image_service(
    request: Request,
    og_image_file: UploadFile,
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

    # Upload OG image
    name_in_disk = await upload_org_og_image(og_image_file, org.org_uuid)

    return {
        "detail": "OG image uploaded successfully",
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

    # API Token path: verify token has permissions for this action on organizations
    if isinstance(current_user, APITokenUser):
        # SECURITY: API tokens should NOT be allowed to delete organizations
        # Organization deletion is a critical operation that should only be
        # performed by authenticated admin users, not programmatic API tokens
        if action == "delete":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API tokens are not allowed to delete organizations",
            )

        # Verify token belongs to this organization
        org = db_session.exec(
            select(Organization).where(Organization.org_uuid == org_uuid)
        ).first()

        if not org or org.id != current_user.org_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API token cannot access resources outside its organization",
            )

        # Check token's rights for organizations (not payments!)
        if not current_user.rights:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API token has no permissions configured",
            )

        rights = current_user.rights
        if isinstance(rights, dict):
            org_rights = rights.get("organizations", {})
            has_permission = org_rights.get(f"action_{action}", False)
        else:
            org_rights = getattr(rights, "organizations", None)
            has_permission = getattr(org_rights, f"action_{action}", False) if org_rights else False

        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"API token does not have '{action}' permission for organizations",
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
