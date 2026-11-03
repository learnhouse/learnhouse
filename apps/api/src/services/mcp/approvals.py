"""Human approval for sensitive MCP tool calls.

An AI app must not be able to approve its own actions: text a learner wrote
can end up in the model's context and ask it to delete a course or make
someone an admin. So for tools marked as needing approval, the yes has to
come from the person, through one of two channels:

* an approval link. The person opens it in LearnHouse, signed in as
  themselves, and approves or declines. The app then repeats the call with
  the `approval_id`, which only works once, for the same connection, member,
  organization, tool and arguments, within ten minutes. This is the only
  channel for deletions and admin changes, and the one API tokens use: the
  member who created the token approves;
* for other approvals, clients on the 2026-07-28 protocol that can show forms
  get a confirmation form. The retry carries a signed, single-use state bound
  to the exact call, so an answer cannot be replayed or moved to another
  call. Nothing proves a person answered a form rather than the app, which is
  why forms never stand in for the link where a mistake cannot be undone.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

import jwt
from jwt import PyJWTError

from src.core.redis import get_redis_client
from src.security.security import ALGORITHM, SECRET_KEY

logger = logging.getLogger(__name__)

APPROVAL_TTL = 10 * 60
FORM_STATE_TTL = 10 * 60
_KEY = "mcp:approval:{}"
_NONCE_KEY = "mcp:approval-nonce:{}"
_STATE_TYPE = "mcp_tool_approval"

# Argument names the approval channels add; never part of the call itself.
CONTROL_ARGS = ("confirm", "approval_id")


class ApprovalUnavailable(Exception):
    """No store to keep approvals in: refuse rather than skip the check."""


def call_args(arguments: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in (arguments or {}).items() if k not in CONTROL_ARGS}


def args_digest(tool: str, arguments: dict[str, Any]) -> str:
    canonical = json.dumps(
        {"tool": tool, "args": call_args(arguments)}, sort_keys=True, separators=(",", ":"), default=str
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _redis():
    client = get_redis_client()
    if client is None:
        raise ApprovalUnavailable("Approvals need Redis")
    return client


# ─── approval links ──────────────────────────────────────────────────────────


@dataclass
class Approval:
    id: str
    grant: str
    user_id: int
    org_id: int
    tool: str
    digest: str
    summary: str
    client_name: str = ""
    target: dict = field(default_factory=dict)
    status: str = "pending"  # pending | approved | declined | used
    created_at: int = 0
    expires_at: int = 0

    def public(self) -> dict[str, Any]:
        """What the approval page may show."""
        return {
            "id": self.id,
            "tool": self.tool,
            "summary": self.summary,
            "client_name": self.client_name,
            "target": self.target,
            "status": self.status,
            "expires_at": self.expires_at,
        }


def _save(approval: Approval, client=None) -> None:
    ttl = max(approval.expires_at - int(time.time()), 1)
    (client or _redis()).set(_KEY.format(approval.id), json.dumps(asdict(approval)), ex=ttl)


def approval_url(approval_id: str) -> str:
    from urllib.parse import urlencode

    from src.services.mcp.oauth import frontend_base

    return f"{frontend_base()}/oauth/approve?{urlencode({'id': approval_id})}"


def get(approval_id: str) -> Optional[Approval]:
    if not approval_id or not isinstance(approval_id, str) or len(approval_id) > 64:
        return None
    raw = _redis().get(_KEY.format(approval_id))
    if not raw:
        return None
    try:
        return Approval(**json.loads(raw))
    except (TypeError, ValueError):
        return None


def create(
    *,
    grant: str,
    user_id: int,
    org_id: int,
    tool: str,
    arguments: dict[str, Any],
    summary: str,
    client_name: str = "",
    target: Optional[dict] = None,
) -> Approval:
    now = int(time.time())
    approval = Approval(
        id=f"apr_{secrets.token_urlsafe(18)}",
        grant=grant,
        user_id=user_id,
        org_id=org_id,
        tool=tool,
        digest=args_digest(tool, arguments),
        summary=summary,
        client_name=client_name,
        target=target or {},
        created_at=now,
        expires_at=now + APPROVAL_TTL,
    )
    _save(approval)
    return approval


def decide(approval_id: str, user_id: int, approve: bool) -> Approval:
    """The person's answer. Only the member the call acts as may answer, and
    only once."""
    approval = get(approval_id)
    if approval is None or approval.user_id != user_id:
        raise LookupError("This approval request does not exist or has expired.")
    if approval.status != "pending":
        raise ValueError(f"This request was already {approval.status}.")
    approval.status = "approved" if approve else "declined"
    _save(approval)
    return approval


def consume(
    approval_id: str, *, grant: str, user_id: int, org_id: int, tool: str, arguments: dict[str, Any]
) -> str:
    """Use an approval for the call it was made for.

    Returns "approved" (and marks it used), or why it cannot be used:
    "pending", "declined", "used", "mismatch" or "missing"."""
    client = _redis()
    key = _KEY.format(approval_id or "")
    with client.pipeline() as pipe:
        for _ in range(5):
            try:
                pipe.watch(key)
                raw = pipe.get(key)
                if not raw:
                    return "missing"
                approval = Approval(**json.loads(raw))
                if (
                    approval.grant != grant
                    or approval.user_id != user_id
                    or approval.org_id != org_id
                    or approval.tool != tool
                ) or not hmac.compare_digest(
                    approval.digest, args_digest(tool, arguments)
                ):
                    return "mismatch"
                if approval.status != "approved":
                    return approval.status
                approval.status = "used"
                pipe.multi()
                ttl = max(approval.expires_at - int(time.time()), 1)
                pipe.set(key, json.dumps(asdict(approval)), ex=ttl)
                pipe.execute()
                return "approved"
            except Exception as e:  # WatchError: someone else touched it, retry
                if e.__class__.__name__ != "WatchError":
                    raise
    return "pending"


# ─── confirmation forms (2026-07-28 clients) ─────────────────────────────────


def _state_key() -> str:
    # Derived so this state can never verify as a session or another token.
    return hmac.new(SECRET_KEY.encode(), b"mcp-tool-approval-state", "sha256").hexdigest()


def form_state(*, grant: str, user_id: int, org_id: int, tool: str, arguments: dict[str, Any]) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "typ": _STATE_TYPE,
            "grant": grant,
            "user": user_id,
            "org": org_id,
            "tool": tool,
            "digest": args_digest(tool, arguments),
            "nonce": secrets.token_urlsafe(12),
            "iat": now,
            "exp": now + FORM_STATE_TTL,
        },
        _state_key(),
        algorithm=ALGORITHM,
    )


def redeem_form_state(
    state: Optional[str], *, grant: str, user_id: int, org_id: int, tool: str, arguments: dict[str, Any]
) -> bool:
    """True once for a valid state bound to this exact call."""
    if not state:
        return False
    try:
        data = jwt.decode(state, _state_key(), algorithms=[ALGORITHM], options={"require": ["exp", "iat"]})
    except PyJWTError:
        return False
    if (
        data.get("typ") != _STATE_TYPE
        or data.get("grant") != grant
        or data.get("user") != user_id
        or data.get("org") != org_id
        or data.get("tool") != tool
    ):
        return False
    if not hmac.compare_digest(str(data.get("digest", "")), args_digest(tool, arguments)):
        return False
    nonce = str(data.get("nonce") or "")
    ttl = max(int(data["exp"]) - int(time.time()), 1)
    # Single use: the first redeemer sets the nonce.
    return bool(_redis().set(_NONCE_KEY.format(nonce), "1", nx=True, ex=ttl))
