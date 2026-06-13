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

_PAGE_SIZE = 200
_MAX_PAGES = 50  # safety cap → 10k artifacts before we warn and stop


async def _fetch_all_artifacts(client, kb_api: str, kb_token: str) -> list:
    """Page through every launch_artifact, not just the first `_PAGE_SIZE`.

    KB exposes no status filter, so we must pull all rows and filter approved
    client-side; capping at one page would silently drop artifacts past row 200.
    We page on `offset` and dedupe by id, which also makes us safe if the API
    ignores `offset` (a non-advancing page yields no new ids → we stop) instead
    of looping forever.
    """
    headers = {"Authorization": f"Bearer {kb_token}"}
    rows: list = []
    seen: set = set()
    for page in range(_MAX_PAGES):
        resp = await client.get(
            f"{kb_api}/entities/launch_artifact",
            params={"limit": _PAGE_SIZE, "offset": page * _PAGE_SIZE},
            headers=headers,
            timeout=30.0,
        )
        resp.raise_for_status()
        batch = resp.json()
        fresh = [r for r in batch if r.get("id") not in seen]
        if not fresh:
            break  # no new rows (exhausted, or API ignored offset)
        seen.update(r.get("id") for r in fresh)
        rows.extend(fresh)
        if len(batch) < _PAGE_SIZE:
            break  # last (short) page
    else:
        logger.warning(
            "kb_sync: hit max page cap (%d pages × %d); artifacts beyond %d may be unsynced",
            _MAX_PAGES,
            _PAGE_SIZE,
            _MAX_PAGES * _PAGE_SIZE,
        )
    return rows


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
        rows = await _fetch_all_artifacts(client, kb_api, kb_token)

    n = await sync_rows(rows, LhCourseClient(org_id), org_id)
    logger.info("kb_sync: upserted %d approved artifacts", n)
    return n
