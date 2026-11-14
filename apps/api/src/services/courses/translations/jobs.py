"""Progress of translation runs (Atlas), readable by the course editor.

The engine that translates (Enterprise, Atlas) records each run here so the
Languages panel shows "Translating 14/40 pages to French" whether the run
was started from a chat or from the editor. Redis only; without Redis the
panel simply shows no runs.
"""

from __future__ import annotations

import json
import logging
import secrets
import time
from typing import Any, Optional

from src.core.redis import get_redis_client

logger = logging.getLogger(__name__)

JOB_TTL_SECONDS = 6 * 60 * 60
# A running job not updated for this long is reported as failed (worker died).
STALE_SECONDS = 10 * 60
MAX_JOBS = 20


def _key(course_uuid: str) -> str:
    return f"course-i18n:jobs:{course_uuid}"


def new_job_id() -> str:
    return f"trjob_{secrets.token_urlsafe(9)}"


def save_job(course_uuid: str, job: dict[str, Any]) -> None:
    r = get_redis_client()
    if r is None:
        return
    job = {**job, "updated_at": time.time()}
    try:
        r.hset(_key(course_uuid), job["job_id"], json.dumps(job, default=str))
        r.expire(_key(course_uuid), JOB_TTL_SECONDS)
    except Exception:  # pragma: no cover - best effort
        logger.debug("translation job save failed", exc_info=True)


def get_job(course_uuid: str, job_id: str) -> Optional[dict[str, Any]]:
    for job in list_jobs(course_uuid, include_old=True):
        if job.get("job_id") == job_id:
            return job
    return None


def list_jobs(course_uuid: str, include_old: bool = False) -> list[dict[str, Any]]:
    """Recent runs of a course, newest first. Finished runs older than an
    hour are left out unless ``include_old``."""
    r = get_redis_client()
    if r is None:
        return []
    try:
        raw = r.hgetall(_key(course_uuid)) or {}
    except Exception:  # pragma: no cover - best effort
        return []
    now = time.time()
    jobs: list[dict[str, Any]] = []
    for value in raw.values():
        try:
            job = json.loads(value)
        except (TypeError, ValueError):
            continue
        if job.get("state") == "running" and now - float(job.get("updated_at") or 0) > STALE_SECONDS:
            job["state"] = "failed"
            job["error"] = "stopped"
        if not include_old and job.get("state") != "running" and now - float(job.get("updated_at") or 0) > 3600:
            continue
        jobs.append(job)
    jobs.sort(key=lambda j: -float(j.get("started_at") or j.get("updated_at") or 0))
    return jobs[:MAX_JOBS]
