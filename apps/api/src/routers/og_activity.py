"""Admin-triggered KB -> LearnHouse activity ingestion.

Runs as the authenticated caller (router-level require_authenticated_user gate).
Assumes the caller has platform-admin trust: org-scoped authorization for the
`org_id` argument is deliberately deferred.
"""

import os

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.og_activity.kb_client import KbClient
from src.services.og_activity.kb_ingest import ingest_from_kb
from src.services.og_activity.store import ServiceActivityStore

router = APIRouter()


class IngestReportResponse(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: int


@router.post("/kb-ingest", response_model=IngestReportResponse)
async def trigger_kb_ingest(
    request: Request,  # forwarded to the store for RBAC context
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    kb_api_url = os.getenv("KB_API_URL", "")
    if not kb_api_url:
        raise HTTPException(status_code=503, detail="KB_API_URL is not configured")
    kb_client = KbClient(kb_api_url, os.getenv("KB_API_TOKEN", ""))
    store = ServiceActivityStore(request, current_user, db_session)
    report = await ingest_from_kb(kb_client, session=db_session, org_id=org_id, store=store)
    return {
        "created": report.created,
        "updated": report.updated,
        "skipped": report.skipped,
        "errors": report.errors,
    }
