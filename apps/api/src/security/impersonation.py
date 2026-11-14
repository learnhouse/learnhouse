"""Platform staff impersonation: the core side.

A platform superadmin (or staff member with an impersonation permission) acts
as one member of one organization. The session is started
from the platform console (Enterprise Edition, ``ee/services/platform/
impersonation.py``), which keeps the server-side record. Everything that has
to hold on *every* request lives here, in core, because the request pipeline
is core code:

* **Token.** A short-lived JWT with ``purpose: "impersonation"``. Every gate
  that only accepts ``purpose: "session"`` already refuses it, so it can never
  be refreshed, never mints a normal session and is inert anywhere that does
  not know about it. :func:`src.security.auth.get_current_user` resolves it to
  the TARGET user after the server-side record confirms it (EE hook), so the
  target's own permissions apply exactly and no superadmin bypass leaks in.
* **Context.** :class:`ImpersonationContext` sits on a ContextVar (and on the
  ASGI scope's state) for the lifetime of the request, so side-effect code
  (analytics, activity, notifications, audit) can tell an impersonated request
  apart without threading anything through call signatures.
* **Gate.** :class:`ImpersonationGateMiddleware` refuses, before any route
  runs, what an impersonated request may never do: every write in read-only
  mode, a fixed denylist of account- and org-security actions in every mode,
  and messaging as the user unless the session allows it. Browser analytics
  ingest is swallowed (202) so impersonated activity never reaches analytics.
* **Org scope.** While impersonating, ORM queries on ``userorganization`` only
  see the target's membership in the impersonated org (:func:`install_orm_scope`),
  so the target's other organizations are out of reach even through code that
  queries memberships directly.

Without EE there is no way to start a session and the auth hook that confirms
one is missing, so an impersonation token is always refused.
"""

from __future__ import annotations

import contextvars
import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass, replace
from typing import Any, Optional

import jwt
from jwt.exceptions import ExpiredSignatureError, PyJWTError

from src.security.security import ALGORITHM, SECRET_KEY

logger = logging.getLogger(__name__)

IMPERSONATION_PURPOSE = "impersonation"
# httpOnly cookie that holds the impersonation token next to (never instead of)
# the superadmin's own LH_access / LH_refresh pair, so ending the session is
# just dropping this cookie.
IMPERSONATION_COOKIE = "LH_imp"
IMPERSONATION_CLAIM = "imp"

MODE_READ_ONLY = "read_only"
MODE_FULL = "full"
MODES = (MODE_READ_ONLY, MODE_FULL)

KIND_USER = "user"
KIND_ROLE = "role"
KINDS = (KIND_USER, KIND_ROLE)

# How impersonated activity is attributed wherever the org can see it.
SUPPORT_LABEL = "LearnHouse"

# Role-mode sessions act through a short-lived shadow member (see the EE
# service). Its address sits on a reserved example.com subdomain (RFC 2606, no
# MX: undeliverable, yet a valid address for every response model) and
# send_email drops it outright. ``signup_method`` is a greppable sentinel.
SHADOW_EMAIL_DOMAIN = "impersonation.example.com"
SHADOW_SIGNUP_METHOD = "impersonation_shadow"


def is_shadow_email(address: Optional[str]) -> bool:
    return bool(address) and str(address).strip().lower().endswith("@" + SHADOW_EMAIL_DOMAIN)


# Error codes the web client matches on.
CODE_READ_ONLY = "IMPERSONATION_READ_ONLY"
CODE_DENIED = "IMPERSONATION_DENIED"
CODE_MESSAGING = "IMPERSONATION_MESSAGING_BLOCKED"
CODE_ENDED = "IMPERSONATION_ENDED"
CODE_WRONG_ORG = "IMPERSONATION_WRONG_ORG"
# Audit-only: an impersonation token presented outside LH_imp / Bearer.
CODE_MISPLACED = "IMPERSONATION_TOKEN_MISPLACED"


@dataclass(frozen=True)
class ImpersonationContext:
    """Who is acting as whom, from the token (and confirmed against the record
    once :func:`src.security.auth.get_current_user` has run: ``verified``)."""

    session_id: str
    impersonator_id: int
    org_id: int
    target_user_id: int
    mode: str
    kind: str
    role_id: Optional[int]
    allow_messaging: bool
    expires_at: int
    jti: str
    verified: bool = False
    target_label: Optional[str] = None

    @property
    def read_only(self) -> bool:
        return self.mode != MODE_FULL

    def confirmed(self, target_label: Optional[str]) -> "ImpersonationContext":
        return replace(self, verified=True, target_label=target_label)

    def audit_details(self) -> dict:
        """What an audit entry records about the session (never the reason)."""
        return {
            "by": SUPPORT_LABEL,
            "session": self.session_id,
            "mode": self.mode,
        }


_current: contextvars.ContextVar[Optional[ImpersonationContext]] = contextvars.ContextVar(
    "lh_impersonation", default=None
)


def current_impersonation() -> Optional[ImpersonationContext]:
    return _current.get()


def is_impersonating() -> bool:
    return _current.get() is not None


def set_impersonation(ctx: Optional[ImpersonationContext]) -> contextvars.Token:
    return _current.set(ctx)


def reset_impersonation(token: contextvars.Token) -> None:
    _current.reset(token)


def token_hash(jti: str) -> str:
    """The stored fingerprint of a token's ``jti`` (the record never holds the token)."""
    return hashlib.sha256(jti.encode("utf-8")).hexdigest()


def mint_impersonation_token(
    *,
    session_id: str,
    jti: str,
    impersonator_id: int,
    org_id: int,
    target_user_id: int,
    target_email: str,
    mode: str,
    kind: str,
    role_id: Optional[int],
    allow_messaging: bool,
    expires_at: int,
) -> str:
    """Sign the token for a session the EE service has just recorded.

    ``type: "access"`` keeps it out of ``/auth/refresh`` (refresh only accepts
    ``type: "refresh"``) and ``purpose`` keeps it out of every session gate.
    ``exp`` is the session's own end, never extended.
    """
    now = int(time.time())
    payload = {
        "sub": target_email,
        "type": "access",
        "purpose": IMPERSONATION_PURPOSE,
        "jti": jti,
        "iat": now,
        "exp": int(expires_at),
        IMPERSONATION_CLAIM: {
            "sid": session_id,
            "by": int(impersonator_id),
            "org": int(org_id),
            "tgt": int(target_user_id),
            "mode": mode,
            "kind": kind,
            "role": role_id,
            "msg": bool(allow_messaging),
        },
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _unverified_purpose(token: str) -> Optional[str]:
    try:
        claims = jwt.decode(token, options={"verify_signature": False})
    except PyJWTError:
        return None
    purpose = claims.get("purpose") if isinstance(claims, dict) else None
    return purpose if isinstance(purpose, str) else None


def decode_impersonation_token(token: Optional[str]) -> tuple[str, Optional[dict]]:
    """Classify a bearer/cookie token.

    Returns ``("none", None)`` for anything that is not an impersonation token
    (normal sessions, garbage), ``("expired", None)`` / ``("invalid", None)``
    for an impersonation token that can't be used, and ``("ok", payload)``.
    """
    if not token or token.count(".") != 2:
        return "none", None
    try:
        payload = jwt.decode(
            token, SECRET_KEY, algorithms=[ALGORITHM], options={"require": ["exp", "sub"]}
        )
    except ExpiredSignatureError:
        return ("expired", None) if _unverified_purpose(token) == IMPERSONATION_PURPOSE else ("none", None)
    except PyJWTError:
        return ("invalid", None) if _unverified_purpose(token) == IMPERSONATION_PURPOSE else ("none", None)
    if payload.get("purpose") != IMPERSONATION_PURPOSE:
        return "none", None
    return "ok", payload


def context_from_claims(payload: Optional[dict]) -> Optional[ImpersonationContext]:
    """The context a verified payload describes, or None if it is malformed."""
    if not isinstance(payload, dict):
        return None
    imp = payload.get(IMPERSONATION_CLAIM)
    if not isinstance(imp, dict):
        return None
    try:
        sid = imp["sid"]
        mode = imp["mode"]
        kind = imp["kind"]
        role = imp.get("role")
        jti = payload["jti"]
        if not isinstance(sid, str) or not sid or not isinstance(jti, str) or not jti:
            return None
        if mode not in MODES or kind not in KINDS:
            return None
        return ImpersonationContext(
            session_id=sid,
            impersonator_id=int(imp["by"]),
            org_id=int(imp["org"]),
            target_user_id=int(imp["tgt"]),
            mode=mode,
            kind=kind,
            role_id=int(role) if role is not None else None,
            allow_messaging=imp.get("msg") is True,
            expires_at=int(payload["exp"]),
            jti=jti,
        )
    except (KeyError, TypeError, ValueError):
        return None


# Where a request's session token came from. Impersonation tokens are only
# ever honoured from the impersonation cookie or an explicit Bearer header
# (the web app's Bearer-based client and its server-side renders); one found in
# the superadmin's own LH_access cookie is refused outright, and anything that
# isn't an impersonation token in LH_imp is refused too. The gate middleware
# and get_current_user both go through resolve_credential, so they always agree
# on who the request is.
ACCESS_COOKIE = "LH_access"
SOURCE_BEARER = "bearer"
SOURCE_IMP_COOKIE = "imp_cookie"
SOURCE_ACCESS_COOKIE = "access_cookie"


@dataclass(frozen=True)
class SessionCredential:
    """The one token a request authenticates a session with, and what it is.

    ``status``: ``none`` (no session token), ``session`` (a non-impersonation
    token, for the normal JWT path), ``ok`` (a usable impersonation token,
    ``payload`` set), or a refusal: ``expired`` / ``invalid`` (a spent or forged
    impersonation token), ``misplaced`` (an impersonation token outside LH_imp /
    Bearer) and ``foreign`` (LH_imp holding something else).
    """

    token: Optional[str]
    source: Optional[str]
    status: str
    payload: Optional[dict] = None

    @property
    def refused(self) -> bool:
        return self.status in ("expired", "invalid", "misplaced", "foreign")


def resolve_credential(headers, cookies) -> SessionCredential:
    """Pick and classify the session token of a request (headers may be a
    Starlette ``Headers`` or a lower-cased dict).

    An explicit ``Authorization: Bearer <jwt>`` wins (the admin console sends
    the superadmin's own token that way while an impersonation runs in another
    tab). Without one, LH_imp wins over LH_access: on an org page a cookie-only
    request (a download link, an EventSource) must run as the target, never
    fall back to the superadmin. ``Bearer lh_…`` is an API token, handled
    elsewhere: no session credential here.
    """
    auth = (headers.get("authorization") or headers.get("Authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        value = auth[7:].strip()
        if value.lower().startswith("lh_"):
            return SessionCredential(None, None, "none")
        # Never empty: the header is stripped before the "bearer " check.
        token, source = value, SOURCE_BEARER
    elif cookies.get(IMPERSONATION_COOKIE):
        token, source = cookies.get(IMPERSONATION_COOKIE), SOURCE_IMP_COOKIE
    elif cookies.get(ACCESS_COOKIE):
        token, source = cookies.get(ACCESS_COOKIE), SOURCE_ACCESS_COOKIE
    else:
        return SessionCredential(None, None, "none")
    status, payload = decode_impersonation_token(token)
    if status == "none":
        # LH_imp only ever carries an impersonation token.
        return SessionCredential(token, source, "foreign" if source == SOURCE_IMP_COOKIE else "session")
    if source == SOURCE_ACCESS_COOKIE:
        return SessionCredential(token, source, "misplaced", payload)
    return SessionCredential(token, source, status, payload)


# ── request policy ──────────────────────────────────────────────────────

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_ALL = None
_WRITES = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# The session's own controls, reachable in every mode.
_ALWAYS_ALLOWED = re.compile(r"^/api/v1/auth/impersonation/(status|end|switch|targets)/?$")

# Browser analytics ingest: answered 202 and dropped, so impersonated page views
# and clicks never land in the org's analytics, the demo tracker or the CRM.
_SWALLOWED = re.compile(r"^/api/v1/(signals/batch|analytics/events|demo-instance/track)/?$")

# Reads under /auth that pages make on every load and that hold no secret
# (the org's 2FA policy banner); everything else under /auth stays refused.
_AUTH_READS = (
    re.compile(r"^/api/v1/auth/mfa/org-policy/\d+/?$"),
)

# POSTs that only read (batch lookups); allowed in read-only mode.
_READ_POSTS = (
    re.compile(r"^/api/v1/discussions/votes/batch/?$"),
)

# Never, in any mode: account security, credentials, secrets, billing,
# destruction of the org, minting sessions for anyone, and the platform console
# itself (which is how another impersonation would be started).
_DENIED: tuple[tuple[Optional[frozenset], re.Pattern], ...] = (
    (_ALL, re.compile(r"^/api/v1/auth(/|$)")),
    (_ALL, re.compile(r"^/api/v1/users/(change_password|reset_password|update_email)(/|$)")),
    (frozenset({"PUT", "PATCH"}), re.compile(r"^/api/v1/users/\d+/?$")),
    (frozenset({"DELETE"}), re.compile(r"^/api/v1/users(/|$)")),
    (frozenset({"DELETE"}), re.compile(r"^/api/v1/orgs/\d+/?$")),
    (frozenset({"DELETE"}), re.compile(r"^/api/v1/orgs/\d+/(leave|content|users/all)/?$")),
    (_ALL, re.compile(r"^/api/v1/orgs/\d+/(api-tokens|api_tokens|webhooks)(/|$)")),
    (_ALL, re.compile(r"^/api/v1/orgs/\d+/ai-credits/(add|reset|set)(/|$)")),
    (_WRITES, re.compile(r"^/api/v1/orgs/\d+/(domains|config/payments|signup_mechanism|config/auth_branding|config/email_sender_name)(/|$)")),
    (_ALL, re.compile(r"^/api/v1/payments(/|$)")),
    (_ALL, re.compile(r"^/api/v1/scim(/|$)")),
    (_ALL, re.compile(r"^/api/v1/lti/(admin|link)(/|$)")),
    (_ALL, re.compile(r"^/api/v1/admin/[^/]+/auth/")),
    (_ALL, re.compile(r"^/api/v1/(admin/[^/]+/users/[^/]+|orgs/\d+/users)/export")),
    (_ALL, re.compile(r"^/api/v1/(audit|ee/audit_logs)(/.*)?/export")),
    (_ALL, re.compile(r"^/api/v1/ee/superadmin(/|$)")),
    (_WRITES, re.compile(r"^/api/v1/ee/license(/|$)")),
    (_ALL, re.compile(r"^/api/v1/mcp(/|$)")),
    (_ALL, re.compile(r"^/mcp(/|$)")),
    (_ALL, re.compile(r"^/api/v1/integrations(/|$)")),
    (_ALL, re.compile(r"^/api/v1/tools(/|$)")),
    (_ALL, re.compile(r"^/api/v1/(dev|demo-control|cloud_internal|internal)(/|$)")),
    (_ALL, re.compile(r"^/api/v1/notifications/devices(/|$)")),
    # Holding the stream open is what shows a member as online.
    (_ALL, re.compile(r"^/api/v1/messaging/stream/?$")),
)

# Speaking as the user to other people: blocked in full mode unless the session
# was started with messaging allowed (read-only blocks every write anyway).
_MESSAGING = (
    re.compile(r"^/api/v1/messaging(/|$)"),
    re.compile(r"^/api/v1/communities/[^/]+/discussions(/|$)"),
    re.compile(r"^/api/v1/discussions(/|$)"),
    re.compile(r"^/api/v1/activities/[^/]+/comments(/|$)"),
    re.compile(r"^/api/v1/newsletter(/|$)"),
    re.compile(r"^/api/v1/usergroups/[^/]+/(email|emails|message|messages)(/|$)"),
    re.compile(r"^/api/v1/live_sessions/[^/]+/(join|pulse|meet)(/|$)"),
    re.compile(r"^/api/v1/boards/[^/]+/meet(/|$)"),
    re.compile(r"^/api/v1/emails(/|$)"),
)

_MESSAGES = {
    CODE_READ_ONLY: "You're impersonating in read-only mode: nothing was changed.",
    CODE_DENIED: "This action is not available while impersonating.",
    CODE_MESSAGING: "Messaging as this member is off. Turn it on from the impersonation badge.",
    CODE_ENDED: "This impersonation has ended.",
    CODE_WRONG_ORG: "This impersonation only works in the organization it was started for.",
}


def error_detail(code: str) -> dict:
    return {"code": code, "message": _MESSAGES[code]}


def request_policy(method: str, path: str, ctx: ImpersonationContext) -> Optional[str]:
    """The refusal code for an impersonated request, or None when it may run.

    ``"swallow"`` means "answer 202 and drop it" (analytics ingest).
    """
    method = (method or "GET").upper()
    if _ALWAYS_ALLOWED.match(path):
        return None
    if _SWALLOWED.match(path):
        return "swallow"
    if method in SAFE_METHODS and any(p.match(path) for p in _AUTH_READS):
        return None
    for methods, pattern in _DENIED:
        if (methods is None or method in methods) and pattern.match(path):
            return CODE_DENIED
    if method in SAFE_METHODS:
        return None
    if ctx.read_only:
        if method == "POST" and any(p.match(path) for p in _READ_POSTS):
            return None
        return CODE_READ_ONLY
    if not ctx.allow_messaging and any(p.match(path) for p in _MESSAGING):
        return CODE_MESSAGING
    return None


def refuse_under_impersonation(code: str = CODE_DENIED) -> None:
    """Raise 403 when the current request is impersonated (for in-route
    checks the path-level gate can't express)."""
    if is_impersonating():
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail=error_detail(code))


def refuse_writes_under_read_only() -> None:
    ctx = current_impersonation()
    if ctx is not None and ctx.read_only:
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail=error_detail(CODE_READ_ONLY))


# ── hooks into EE ───────────────────────────────────────────────────────


def _ee_hook(name: str):
    from src.core.ee_hooks import get_ee_hooks

    hooks = get_ee_hooks()
    return getattr(hooks, name, None) if hooks else None


def report_denied(ctx: ImpersonationContext, method: str, path: str, code: str) -> None:
    """Hand a refused request to the platform audit trail. Never raises."""
    hook = _ee_hook("record_impersonation_denied")
    if hook is None:
        return
    try:
        hook(ctx, method, path, code)
    except Exception:
        logger.exception("impersonation: could not record a refused request")


def report_misplaced(credential: "SessionCredential", method: str, path: str) -> None:
    """Audit an impersonation token presented where it is never accepted."""
    ctx = context_from_claims(credential.payload)
    if ctx is not None:
        report_denied(ctx, method, path, CODE_MISPLACED)


async def end_impersonations_started_by(db_session, user_id: int, reason: str = "logout") -> int:
    """End every open impersonation ``user_id`` started (they signed out, or
    lost their sessions). Returns how many ended; never raises."""
    hook = _ee_hook("end_impersonations_started_by")
    if hook is None:
        return 0
    try:
        return int(await hook(db_session, user_id, reason) or 0)
    except Exception:
        logger.exception("impersonation: could not end the sessions of user %s", user_id)
        return 0


# ── ORM org scope ───────────────────────────────────────────────────────

_orm_scope_installed = False


def install_orm_scope() -> None:
    """While a request is impersonated, hide the target's memberships in every
    org other than the impersonated one from ORM selects.

    One listener on every Session: code all over the codebase checks
    membership with its own ``select(UserOrganization)``, and this makes each
    of them see the target as a member of the impersonated org only.
    """
    global _orm_scope_installed
    if _orm_scope_installed:
        return
    from sqlalchemy import event, or_
    from sqlalchemy.orm import Session, with_loader_criteria

    from src.db.user_organizations import UserOrganization

    @event.listens_for(Session, "do_orm_execute")
    def _scope_memberships(state):  # pragma: no cover - exercised through the ORM, see tests
        ctx = _current.get()
        if ctx is None or not state.is_select:
            return
        state.statement = state.statement.options(
            with_loader_criteria(
                UserOrganization,
                or_(
                    UserOrganization.user_id != ctx.target_user_id,
                    UserOrganization.org_id == ctx.org_id,
                ),
                include_aliases=True,
            )
        )

    _orm_scope_installed = True


# ── middleware ──────────────────────────────────────────────────────────


def _parse_headers(scope) -> tuple[dict[str, str], dict[str, str]]:
    from starlette.requests import cookie_parser

    headers: dict[str, str] = {}
    for key, value in scope.get("headers") or []:
        name = key.decode("latin-1").lower()
        # The first value wins, as Starlette's Headers.get does.
        headers.setdefault(name, value.decode("latin-1"))
    cookies = cookie_parser(headers.get("cookie", "")) if headers.get("cookie") else {}
    return headers, cookies


async def _send_json(send, status_code: int, body: Any) -> None:
    raw = json.dumps(body).encode("utf-8")
    await send({
        "type": "http.response.start",
        "status": status_code,
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(raw)).encode("ascii")),
            (b"cache-control", b"no-store"),
        ],
    })
    await send({"type": "http.response.body", "body": raw})


class ImpersonationGateMiddleware:
    """Pure ASGI gate for impersonated requests (see the module docstring).

    Runs on the token's signed claims only (no database): the server-side
    record is checked by ``get_current_user``, which every authenticated route
    goes through. Refusing on claims first means a read-only session can't
    write even through a route that never resolves the user.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        headers, cookies = _parse_headers(scope)
        credential = resolve_credential(headers, cookies)
        if credential.status in ("none", "session"):
            await self.app(scope, receive, send)
            return
        path = scope.get("path") or ""
        if credential.refused:
            if credential.status == "misplaced":
                report_misplaced(credential, scope.get("method") or "GET", path)
            await self._refuse(scope, send, 401, CODE_ENDED)
            return
        ctx = context_from_claims(credential.payload)
        if ctx is None:
            await self._refuse(scope, send, 401, CODE_ENDED)
            return
        scope.setdefault("state", {})["impersonation"] = ctx
        reset = set_impersonation(ctx)
        try:
            if scope["type"] == "websocket":
                # No API route speaks websocket today; refuse rather than guess.
                await self._refuse(scope, send, 403, CODE_DENIED)
                return
            method = scope.get("method") or "GET"
            decision = request_policy(method, path, ctx)
            if decision == "swallow":
                await _send_json(send, 202, {"dropped": True})
                return
            if decision is not None:
                report_denied(ctx, method, path, decision)
                await self._refuse(scope, send, 403, decision)
                return
            await self.app(scope, receive, send)
        finally:
            reset_impersonation(reset)

    @staticmethod
    async def _refuse(scope, send, status_code: int, code: str) -> None:
        if scope.get("type") == "websocket":
            await send({"type": "websocket.close", "code": 4403 if status_code == 403 else 4401})
            return
        await _send_json(send, status_code, {"detail": error_detail(code)})
