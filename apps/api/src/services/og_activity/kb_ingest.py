"""Map approved KB launch artifacts into the Activity Content Contract and
upsert them through the P0/P1 adapter.

Curriculum shape (P2): one course per `launch`; each `launch_artifact` is a
chapter. `bodyMd` -> one `dynamic_page` activity carrying raw markdown
(OKF-aligned); each attachment -> a `document` activity. Idempotent on
`extra_metadata.kb_id`; unchanged `kb_sha` is skipped.
"""

import logging
from dataclasses import dataclass
from typing import Literal, Optional

from src.services.og_activity.adapter import upsert_activity
from src.services.og_activity.contract import ActivityContract
from src.services.og_activity.registry import ActivityTypeRegistry
from src.services.og_activity.store import ActivityStore

logger = logging.getLogger(__name__)

_DEFAULT_MIME = "application/octet-stream"


def artifact_to_contracts(artifact: dict) -> list[ActivityContract]:
    """One markdown `dynamic_page` for bodyMd + one `document` per attachment.

    Each contract carries a distinct `source.kb_id` so re-runs match per
    activity within the launch's course: the page uses the artifact id; each
    document uses ``{artifact_id}:{file_ref}``.
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
    contracts: list[ActivityContract] = []

    body_md = artifact.get("bodyMd")
    if body_md and body_md.strip():
        contracts.append(
            ActivityContract.model_validate(
                {
                    "type": "dynamic_page",
                    "title": artifact.get("name") or "Untitled",
                    "summary": artifact.get("summary"),
                    "source": dict(base_source),
                    "payload": {"markdown": body_md},
                }
            )
        )

    for att in artifact.get("attachments") or []:
        file_ref = att.get("fileRef") or att.get("url") or att.get("href")
        if not file_ref:
            continue
        mime = att.get("mime") or att.get("contentType") or _DEFAULT_MIME
        contracts.append(
            ActivityContract.model_validate(
                {
                    "type": "document",
                    "title": att.get("name") or att.get("title") or file_ref,
                    "source": {**base_source, "kb_id": f"{artifact_id}:{file_ref}"},
                    "payload": {"file_ref": file_ref, "mime": mime},
                }
            )
        )

    return contracts


@dataclass
class IngestReport:
    created: int = 0
    updated: int = 0
    skipped: int = 0

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
