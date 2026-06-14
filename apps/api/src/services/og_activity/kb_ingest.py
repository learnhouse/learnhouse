"""Map approved KB launch artifacts into the Activity Content Contract and
upsert them through the P0/P1 adapter.

Curriculum shape (P2): one course per `launch`; each `launch_artifact` is a
chapter. `bodyMd` -> one `dynamic_page` activity carrying raw markdown
(OKF-aligned). Idempotent on `extra_metadata.kb_id`; unchanged `kb_sha` is
skipped.

Note: KB `launch_artifact` entities carry no `attachments` field (verified
against the KB API source: `KbCommonFields` + `KbLaunchArtifact` expose only
slug/name/summary/bodyMd/sourceSha + launchId/artifactType/status/version/
skillUsed). Document activities from attachments are deferred to the full
connector when a real attachment source exists.
"""

import logging
import os
from dataclasses import dataclass
from typing import Literal, Optional

from fastapi import Request
from sqlmodel import select

from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.users import PublicUser, User
from src.services.og_activity.adapter import upsert_activity
from src.services.og_activity.alignment import resolve_alignment
from src.services.og_activity.contract import ActivityContract
from src.services.og_activity.course_provision import provision_artifact_chapter, provision_launch_course
from src.services.og_activity.kb_client import KbClient, approved
from src.services.og_activity.registry import ActivityTypeRegistry
from src.services.og_activity.store import ActivityStore, ServiceActivityStore

logger = logging.getLogger(__name__)


def artifact_to_contracts(artifact: dict) -> list[ActivityContract]:
    """One markdown `dynamic_page` for bodyMd (empty body -> empty list).

    The contract carries `source.kb_id` equal to the artifact id so re-runs
    match per activity within the launch's course. Document activities from
    attachments are deferred to the full connector — KB launch_artifacts carry
    no attachments field.
    """
    artifact_id = artifact.get("id")
    if not artifact_id:
        logger.warning("artifact_to_contracts: artifact missing 'id'; skipping: %r", artifact)
        return []
    base_source = {
        "origin": "kb",
        "kb_id": artifact_id,
        "kb_sha": artifact.get("sourceSha"),
        "skill_used": artifact.get("skillUsed"),
    }

    body_md = artifact.get("bodyMd")
    if not body_md or not body_md.strip():
        return []
    return [
        ActivityContract.model_validate(
            {
                "type": "dynamic_page",
                "title": artifact.get("name") or "Untitled",
                "summary": artifact.get("summary"),
                "source": dict(base_source),
                "payload": {"markdown": body_md},
            }
        )
    ]


@dataclass
class IngestReport:
    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: int = 0

    def record(self, action: Literal["created", "updated", "skipped"]) -> None:
        setattr(self, action, getattr(self, action) + 1)


async def ingest_artifact(
    artifact: dict,
    *,
    course_id: int,
    chapter_id: int,
    org_id: int,
    store: ActivityStore,
    report: IngestReport,
    registry: Optional[ActivityTypeRegistry] = None,
) -> None:
    """Upsert every contract derived from `artifact` into the given chapter,
    accumulating actions into `report`."""
    for contract in artifact_to_contracts(artifact):
        result = await upsert_activity(
            contract,
            chapter_id=chapter_id,
            course_id=course_id,
            org_id=org_id,
            store=store,
            registry=registry,
        )
        report.record(result.action)


async def ingest_from_kb(
    kb_client: KbClient,
    *,
    session: AsyncSession,
    org_id: int,
    store: ActivityStore,
    registry: Optional[ActivityTypeRegistry] = None,
) -> IngestReport:
    """Group approved artifacts by launch, provision a course per launch and a
    chapter per artifact, and upsert each artifact's activities through the
    contract adapter. Returns an :class:`IngestReport`."""
    report = IngestReport()

    artifacts = approved(await kb_client.list_all_artifacts())
    by_launch: dict[str, list[dict]] = {}
    for a in artifacts:
        launch_id = a.get("launchId")
        if not launch_id:
            logger.warning("kb_ingest: artifact %s has no launchId; skipping", a.get("id"))
            continue
        by_launch.setdefault(launch_id, []).append(a)

    for launch_id, slim_artifacts in by_launch.items():
        try:
            launch = await kb_client.get_entity("launch", launch_id)
            alignment = await resolve_alignment(launch_id, kb_client)
            course_id = await provision_launch_course(session, org_id, launch, alignment)

            for slim in slim_artifacts:
                full = await kb_client.get_entity("launch_artifact", slim["id"])
                # The full row may omit fields the slim list carried.
                full.setdefault("sourceSha", slim.get("sourceSha"))
                full.setdefault("skillUsed", slim.get("skillUsed"))
                full.setdefault("name", slim.get("name"))
                chapter_id = await provision_artifact_chapter(session, org_id, course_id, full)
                await ingest_artifact(
                    full,
                    course_id=course_id,
                    chapter_id=chapter_id,
                    org_id=org_id,
                    store=store,
                    report=report,
                    registry=registry,
                )
        except Exception:
            logger.exception("kb_ingest: launch %s failed; skipping remaining work for it", launch_id)
            await session.rollback()
            report.errors += 1
            continue

    logger.info(
        "kb_ingest: %d created, %d updated, %d skipped, %d errors",
        report.created, report.updated, report.skipped, report.errors,
    )
    return report


def _system_request() -> Request:
    # Minimal ASGI scope for the service-layer store. No receive/send is wired,
    # so any downstream request.body()/form() access would raise — the store
    # only forwards this request, it does not read its body.
    return Request({"type": "http", "method": "POST", "path": "/og/kb-ingest", "headers": [], "query_string": b""})


async def _service_user(session: AsyncSession, user_id: int) -> PublicUser:
    user = (await session.execute(select(User).where(User.id == user_id))).scalars().one_or_none()
    if user is None:
        raise RuntimeError(
            f"kb_ingest: service user id={user_id} not found; set ENABLEMENT_SERVICE_USER_ID"
        )
    return PublicUser(
        id=user.id, username=user.username, first_name=user.first_name,
        last_name=user.last_name, email=user.email, user_uuid=user.user_uuid,
    )


async def run() -> IngestReport:
    """Headless entrypoint (cron/scheduler). Requires env: KB_API_URL,
    KB_API_TOKEN, ENABLEMENT_ORG_ID, ENABLEMENT_SERVICE_USER_ID.

    The service user must hold author rights in the org (RBAC via
    check_resource_access). This mirrors the service-account deferral noted in
    lh_course_client.py."""
    from src.core.events.database import _async_session_factory  # lazy: avoids circular import

    kb_api_url = os.getenv("KB_API_URL", "")
    if not kb_api_url:
        raise ValueError("kb_ingest: KB_API_URL is not set")
    kb_client = KbClient(kb_api_url, os.getenv("KB_API_TOKEN", ""))
    org_id = int(os.getenv("ENABLEMENT_ORG_ID", "1"))
    service_user_id = int(os.getenv("ENABLEMENT_SERVICE_USER_ID", "1"))

    async with _async_session_factory() as session:
        user = await _service_user(session, service_user_id)
        store = ServiceActivityStore(_system_request(), user, session)
        return await ingest_from_kb(kb_client, session=session, org_id=org_id, store=store)
