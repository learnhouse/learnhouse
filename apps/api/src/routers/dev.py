import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from config.config import get_learnhouse_config
from migrations.orgconfigs.orgconfigs_migrations import migrate_to_v1_1, migrate_to_v1_2, migrate_v0_to_v1
from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig
from src.db.users import PublicUser
from src.security.auth import get_authenticated_user

logger = logging.getLogger(__name__)


router = APIRouter()


def _require_superadmin(current_user: PublicUser):
    """Require superadmin access for dev endpoints."""
    if not hasattr(current_user, 'is_superadmin') or not current_user.is_superadmin:
        raise HTTPException(status_code=403, detail="Superadmin access required")


@router.get(
    "/config",
    summary="Get LearnHouse runtime config",
    description="Returns the current LearnHouse configuration with sensitive values redacted. Restricted to superadmin users.",
    responses={
        200: {"description": "Configuration dictionary with secrets redacted"},
        401: {"description": "Authentication required"},
        403: {"description": "Superadmin access required"},
    },
)
async def config(
    current_user: PublicUser = Depends(get_authenticated_user),
):
    _require_superadmin(current_user)
    config = get_learnhouse_config()
    config_dict = config.model_dump()

    # Redact sensitive values
    _redact_secrets(config_dict)
    return config_dict


def _redact_secrets(d: dict, _sensitive_keys=None):
    """Recursively redact values for keys that look like secrets."""
    if _sensitive_keys is None:
        _sensitive_keys = {
            "password", "secret", "token", "key", "api_key", "api_secret",
            "connection_string", "redis_connection_string", "database_url",
            "ingest_token", "read_token", "write_token", "webhook_secret",
            "client_secret", "private_key",
        }
    for k, v in d.items():
        if isinstance(v, dict):
            _redact_secrets(v, _sensitive_keys)
        elif isinstance(v, str) and any(s in k.lower() for s in _sensitive_keys):
            if v:
                d[k] = v[:4] + "***REDACTED***"


@router.post(
    "/migrate_orgconfig_v0_to_v1",
    summary="Migrate organization config v0 to v1",
    description="Runs the v0 to v1 schema migration across every organization's configuration. Restricted to superadmin users.",
    responses={
        200: {"description": "Migration completed successfully"},
        401: {"description": "Authentication required"},
        403: {"description": "Superadmin access required"},
    },
)
async def migrate(
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_authenticated_user),
):
    """
    Migrate organization config from v0 to v1
    """
    _require_superadmin(current_user)
    statement = select(OrganizationConfig)
    result = db_session.exec(statement)

    for orgConfig in result:
        orgConfig.config = migrate_v0_to_v1(orgConfig.config)

        db_session.add(orgConfig)
        db_session.commit()

    return {"message": "Migration successful"}


@router.post(
    "/migrate_orgconfig_v1_to_v1.1",
    summary="Migrate organization config v1 to v1.1",
    description="Runs the v1 to v1.1 schema migration across every organization's configuration. Restricted to superadmin users.",
    responses={
        200: {"description": "Migration completed successfully"},
        401: {"description": "Authentication required"},
        403: {"description": "Superadmin access required"},
    },
)
async def migratev1_1(
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_authenticated_user),
):
    """
    Migrate organization config from v1 to v1.1
    """
    _require_superadmin(current_user)
    statement = select(OrganizationConfig)
    result = db_session.exec(statement)

    for orgConfig in result:
        orgConfig.config = migrate_to_v1_1(orgConfig.config)

        db_session.add(orgConfig)
        db_session.commit()

    return {"message": "Migration successful"}

@router.post(
    "/migrate_orgconfig_v1_to_v1.2",
    summary="Migrate organization config v1 to v1.2",
    description="Runs the v1 to v1.2 schema migration across every organization's configuration. Restricted to superadmin users.",
    responses={
        200: {"description": "Migration completed successfully"},
        401: {"description": "Authentication required"},
        403: {"description": "Superadmin access required"},
    },
)
async def migratev1_2(
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_authenticated_user),
):
    """
    Migrate organization config from v1 to v1.2
    """
    _require_superadmin(current_user)
    statement = select(OrganizationConfig)
    result = db_session.exec(statement)

    for orgConfig in result:
        orgConfig.config = migrate_to_v1_2(orgConfig.config)

        db_session.add(orgConfig)
        db_session.commit()

    return {"message": "Migration successful"}
