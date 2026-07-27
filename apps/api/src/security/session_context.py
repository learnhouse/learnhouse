"""Request-scoped session provenance.

A session JWT records *how* the user authenticated (``amr``) and *which org the
session was minted for* (``sorg``). The per-org authorization gates
(``src.security.org_auth``, ``src.services.orgs.auth_policy``) need those facts,
but they are called from ~20 sites with only ``(user_id, org_id, db_session)`` —
threading the token through every signature would be a large, error-prone change.

Instead :func:`src.security.auth.get_current_user` publishes the decoded
provenance on a :class:`contextvars.ContextVar` for the lifetime of the request
(FastAPI runs each request in its own task context, so this is request-scoped and
never leaks across requests). The gates read it back with
:func:`get_session_provenance`.

Legacy sessions minted before this feature carry no ``amr``/``sorg`` claims; they
resolve to ``SessionProvenance(amr=None, org_id=None)``. Policy evaluation treats
an unknown method as *unknown*, not as a violation, and lets it through: the
enforcing gate is sign-in time, and failing closed here would lock out every
member holding a pre-feature session as soon as an org narrowed its method list.
A session that positively names a disallowed method is still rejected.

Claim keys are defined here so the mint side and the read side cannot drift.
"""

import contextvars
from dataclasses import dataclass
from typing import Optional

# JWT claim names carried on session tokens.
AMR_CLAIM = "amr"       # authentication method: password | magic_login | google | sso | api_token
SORG_CLAIM = "sorg"     # id of the org the session was established for (int), or absent

# Recognised authentication methods. "api_token" is internal — a machine
# credential that already carries its own org boundary and is exempt from the
# human auth-method policy.
AUTH_METHOD_PASSWORD = "password"
AUTH_METHOD_MAGIC_LOGIN = "magic_login"
AUTH_METHOD_GOOGLE = "google"
AUTH_METHOD_SSO = "sso"
AUTH_METHOD_API_TOKEN = "api_token"

# The methods an org admin can allow/disallow (api_token is never in this set).
POLICY_AUTH_METHODS = (
    AUTH_METHOD_PASSWORD,
    AUTH_METHOD_MAGIC_LOGIN,
    AUTH_METHOD_GOOGLE,
    AUTH_METHOD_SSO,
)


@dataclass(frozen=True)
class SessionProvenance:
    amr: Optional[str] = None
    org_id: Optional[int] = None


_current: contextvars.ContextVar[Optional[SessionProvenance]] = contextvars.ContextVar(
    "session_provenance", default=None
)


def set_session_provenance(provenance: Optional[SessionProvenance]) -> None:
    _current.set(provenance)


def get_session_provenance() -> Optional[SessionProvenance]:
    return _current.get()


def session_claims(amr: Optional[str], org_id: Optional[int]) -> dict:
    """Build the provenance claims to merge into a token's ``data`` dict.

    Omits keys that are ``None`` so a central (org-less) or method-less token
    stays as small as it was before this feature.
    """
    claims: dict = {}
    if amr is not None:
        claims[AMR_CLAIM] = amr
    if org_id is not None:
        claims[SORG_CLAIM] = org_id
    return claims
