"""Nightly mirror of approved KB launch artifacts into LearnHouse courses.

Only KbArtifactStatus == "approved" rows sync (filtered client-side — KB has no
status query param). Courses are keyed on extra_metadata.kb_id for idempotency;
extra_metadata.kb_sha lets a re-run skip unchanged artifacts. Content (bodyMd)
goes into the course's first chapter; summary populates the description.
"""

import logging
import os

import httpx

logger = logging.getLogger(__name__)


async def sync_rows(rows, lh_client, org_id: int) -> int:
    """Upsert the approved subset of `rows` via `lh_client`. Returns count."""
    approved = [r for r in rows if r.get("status") == "approved"]
    count = 0
    for r in approved:
        await lh_client.upsert_course(
            org_id=org_id,
            match={"extra_metadata.kb_id": r["id"]},
            course={
                "name": r["name"],
                "description": r.get("summary") or "",
                "tags": f"source:kb,type:{r['artifactType']}",
                "public": False,
                "published": True,
                "open_to_contributors": False,
                "extra_metadata": {
                    "source": "kb",
                    "kb_id": r["id"],
                    "kb_sha": r.get("sourceSha"),
                },
            },
            body_md=r.get("bodyMd"),
        )
        count += 1
    return count


async def run() -> int:
    """Entry point for the nightly job (cron/scheduler calls this)."""
    from src.services.courses.lh_course_client import LhCourseClient

    kb_api = os.getenv("KB_API_URL", "").rstrip("/")
    kb_token = os.getenv("KB_API_TOKEN", "")
    org_id = int(os.getenv("ENABLEMENT_ORG_ID", "1"))

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{kb_api}/entities/launch_artifact",
            params={"limit": 200},
            headers={"Authorization": f"Bearer {kb_token}"},
            timeout=30.0,
        )
        resp.raise_for_status()
        rows = resp.json()

    n = await sync_rows(rows, LhCourseClient(org_id), org_id)
    logger.info("kb_sync: upserted %d approved artifacts", n)
    return n
