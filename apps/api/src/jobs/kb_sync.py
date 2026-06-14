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
