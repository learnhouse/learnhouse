"""
Org apps service: install (upload), approve, list, enable/disable, uninstall.

Authorization model: all management operations are org-admin-only and are
gated in the router via `require_org_admin`; listing is available to org
members (non-admins only see installed+enabled apps). Apps never manage
other apps: the router requires a real user session (API tokens and app
sessions are rejected there).
"""

import os
from datetime import datetime
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.org_apps import (
    OrgApp,
    OrgAppAdminRead,
    OrgAppRead,
)
from src.db.organizations import Organization
from src.db.users import PublicUser
from src.services.apps.install import (
    app_storage_prefix,
    cleanup_extract_dir,
    extract_app_package,
    store_app_bundle,
)
from src.services.apps.manifest import scopes_to_rights, validate_scopes
from src.services.courses.transfer.storage_utils import delete_storage_directory


def _admin_read(app: OrgApp) -> OrgAppAdminRead:
    return OrgAppAdminRead(
        **app.model_dump(exclude={"manifest", "approved_scopes"}),
        manifest=app.manifest or {},
        approved_scopes=app.approved_scopes,
        requested_scopes=list((app.manifest or {}).get("scopes", [])),
    )


async def get_org_or_404(org_id: int, db_session: AsyncSession) -> Organization:
    org = (
        await db_session.execute(select(Organization).where(Organization.id == org_id))
    ).scalars().first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return org


async def get_org_app_or_404(
    org_id: int, app_uuid: str, db_session: AsyncSession
) -> OrgApp:
    app = (
        await db_session.execute(
            select(OrgApp).where(OrgApp.app_uuid == app_uuid, OrgApp.org_id == org_id)
        )
    ).scalars().first()
    if not app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="App not found")
    return app


async def install_app_from_upload(
    zip_file: UploadFile,
    org_id: int,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> OrgAppAdminRead:
    """Process an uploaded app package into a pending (unapproved) install.

    Uploading a slug that already exists stages an update: the row's manifest
    and bundle are replaced and the app is disabled until an admin re-approves
    its (possibly changed) scopes.
    """
    org = await get_org_or_404(org_id, db_session)

    manifest, extract_dir = extract_app_package(zip_file)
    try:
        existing = (
            await db_session.execute(
                select(OrgApp).where(OrgApp.org_id == org_id, OrgApp.slug == manifest.id)
            )
        ).scalars().first()

        now = str(datetime.now())
        if existing:
            app = existing
        else:
            app = OrgApp(
                app_uuid=f"orgapp_{uuid4()}",
                org_id=org_id,
                created_by_user_id=current_user.id,
                slug=manifest.id,
                creation_date=now,
                name="",
                version="",
            )

        storage_prefix = app_storage_prefix(org.org_uuid, app.app_uuid, manifest.version)
        store_app_bundle(extract_dir, storage_prefix)

        app.name = manifest.name
        app.description = manifest.description
        app.version = manifest.version
        app.entry_point = manifest.entry
        app.icon_path = manifest.icon
        app.manifest = manifest.model_dump()
        # SECURITY: every (re)upload resets approval — new code must never
        # inherit previously approved scopes, and a pending app cannot run.
        app.approved_scopes = None
        app.status = "pending"
        app.enabled = False
        app.storage_prefix = storage_prefix
        app.update_date = now

        db_session.add(app)
        await db_session.commit()
        await db_session.refresh(app)
        return _admin_read(app)
    finally:
        cleanup_extract_dir(extract_dir)


async def approve_app(
    org_id: int,
    app_uuid: str,
    granted_scopes: list[str],
    db_session: AsyncSession,
) -> OrgAppAdminRead:
    """Admin grants scopes to a pending app and activates it.

    Granted scopes must be a subset of what the manifest requested — the
    server re-checks so a tampered client cannot widen the grant beyond the
    reviewed request.
    """
    app = await get_org_app_or_404(org_id, app_uuid, db_session)

    granted = validate_scopes(granted_scopes)
    requested = set((app.manifest or {}).get("scopes", []))
    extra = [s for s in granted if s not in requested]
    if extra:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot grant scopes the app did not request: {extra}",
        )

    app.approved_scopes = scopes_to_rights(granted)
    app.status = "installed"
    app.enabled = True
    app.update_date = str(datetime.now())

    # Drop bundles of superseded versions now that the new one is live.
    app_root = os.path.dirname(app.storage_prefix)
    current_version_dir = os.path.basename(app.storage_prefix)
    if os.path.isdir(app_root):
        for entry in os.listdir(app_root):
            if entry != current_version_dir:
                delete_storage_directory(os.path.join(app_root, entry))

    db_session.add(app)
    await db_session.commit()
    await db_session.refresh(app)
    return _admin_read(app)


async def list_org_apps(
    org_id: int,
    db_session: AsyncSession,
    include_pending: bool,
) -> list[OrgAppRead] | list[OrgAppAdminRead]:
    """List an org's apps. Admins (include_pending) get the full picture with
    manifests and scopes; members only see installed, enabled apps."""
    statement = select(OrgApp).where(OrgApp.org_id == org_id)
    apps = (await db_session.execute(statement)).scalars().all()
    if include_pending:
        return [_admin_read(app) for app in apps]
    return [
        OrgAppRead(**app.model_dump())
        for app in apps
        if app.status == "installed" and app.enabled
    ]


async def set_app_enabled(
    org_id: int,
    app_uuid: str,
    enabled: bool,
    db_session: AsyncSession,
) -> OrgAppAdminRead:
    app = await get_org_app_or_404(org_id, app_uuid, db_session)
    if enabled and app.status != "installed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="App scopes must be approved before it can be enabled",
        )
    app.enabled = enabled
    app.update_date = str(datetime.now())
    db_session.add(app)
    await db_session.commit()
    await db_session.refresh(app)
    return _admin_read(app)


async def uninstall_app(
    org_id: int,
    app_uuid: str,
    db_session: AsyncSession,
) -> None:
    app = await get_org_app_or_404(org_id, app_uuid, db_session)
    # Remove every stored version under the app's root, then the row.
    if app.storage_prefix:
        delete_storage_directory(os.path.dirname(app.storage_prefix))
    await db_session.delete(app)
    await db_session.commit()
