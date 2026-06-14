"""Nightly KB -> LearnHouse sync.

DEPRECATED course/markdown-activity path: superseded by
``src.services.og_activity.kb_ingest`` (P2), which writes one canonical
contract-driven activity per artifact (markdown dynamic_page + document
attachments) into one course per launch, with knowledge-graph alignment. This
module now delegates to it. ``sync_rows`` is retained only for the existing
unit test and emits a deprecation warning.
"""

import logging
import warnings

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
    """DEPRECATED. Use src.services.og_activity.kb_ingest.ingest_from_kb."""
    warnings.warn(
        "kb_sync.sync_rows is deprecated; use og_activity.kb_ingest.ingest_from_kb",
        DeprecationWarning,
        stacklevel=2,
    )
    approved = [r for r in rows if r.get("status") == "approved"]
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
                "extra_metadata": {"source": "kb", "kb_id": r["id"], "kb_sha": r.get("sourceSha")},
            },
            body_md=r.get("bodyMd"),
        )
    return len(approved)


async def run() -> int:
    """Entry point for the nightly job - delegates to the contract-driven ingest."""
    from src.services.og_activity.kb_ingest import run as ingest_run

    report = await ingest_run()
    logger.info("kb_sync: %d created, %d updated, %d skipped", report.created, report.updated, report.skipped)
    return report.created + report.updated
