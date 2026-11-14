"""The current impersonation's own controls: ``/api/v1/auth/impersonation``.

Called with the impersonation token itself (the web app's auth proxy sends it
from the httpOnly ``LH_imp`` cookie). Starting a session is a platform console
action (``/api/v1/ee/superadmin/impersonations``); these two only describe and
end, switch (another member, a role, read-only, messaging) the one the caller
is in, and list who it could switch to. They are the only ``/auth`` routes the
impersonation gate lets through.
"""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.security.auth import get_current_user
from src.security.impersonation import current_impersonation

router = APIRouter()


def _session_or_404():
    ctx = current_impersonation()
    if ctx is None or not ctx.verified:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not impersonating")
    return ctx


def _hook(name: str):
    from src.core.ee_hooks import get_ee_hooks

    hooks = get_ee_hooks()
    hook = getattr(hooks, name, None) if hooks else None
    if hook is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not impersonating")
    return hook


@router.get("/status", summary="Describe the impersonation this request runs in")
async def api_impersonation_status(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    ctx = _session_or_404()
    return await _hook("describe_impersonation")(db_session, ctx)


@router.post("/end", summary="Stop impersonating")
async def api_impersonation_end(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    ctx = _session_or_404()
    return await _hook("end_impersonation_session")(db_session, ctx)


class ImpersonationSwitch(BaseModel):
    user_id: Optional[int] = None
    role_id: Optional[int] = None
    mode: Optional[Literal["read_only", "full"]] = None
    allow_messaging: Optional[bool] = None


@router.post("/switch", summary="Switch who (or how) you are impersonating")
async def api_impersonation_switch(
    body: ImpersonationSwitch,
    request: Request,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    ctx = _session_or_404()
    return await _hook("switch_impersonation")(db_session, ctx, body.model_dump())


@router.get("/targets", summary="Members and roles of this org you could switch to")
async def api_impersonation_targets(
    request: Request,
    q: Optional[str] = Query(default=None, max_length=100),
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    ctx = _session_or_404()
    return await _hook("impersonation_targets")(db_session, ctx, q)
