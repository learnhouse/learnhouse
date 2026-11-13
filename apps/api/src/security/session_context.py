"""Request-scoped session provenance.

A session JWT records *how* the user authenticated (``amr``) and *which org the
session was minted for* (``sorg``). The per-org authorization gates
(``src.security.org_auth``, ``src.services.orgs.auth_policy``) need those facts,
but they are called from ~20 sites with only ``(user_id, org_id, db_session)``, and
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
import os
import time
from dataclasses import dataclass
from datetime import timedelta
from typing import Optional


def _legacy_session_grace() -> timedelta:
    """How long a method-less session keeps working once it is first rotated.

    Defaults to the refresh-token lifetime (the longest a member can go without
    re-authenticating) so everyone gets a full cycle to sign in again before the
    policy applies to them.
    """
    raw = os.environ.get("LEARNHOUSE_AUTH_LEGACY_SESSION_GRACE_DAYS")
    if raw:
        try:
            return timedelta(days=max(int(raw), 0))
        except (TypeError, ValueError):
            pass
    return timedelta(days=30)


LEGACY_SESSION_GRACE = _legacy_session_grace()

# JWT claim names carried on session tokens.
AMR_CLAIM = "amr"       # authentication method: password | magic_login | google | sso | lti | embed | api_token
SORG_CLAIM = "sorg"     # id of the org the session was established for (int), or absent
LEGACY_GRACE_CLAIM = "lgc"  # unix seconds after which a method-less session stops being admitted
# Present (true) on a session signed in on an org's own custom domain. The org
# controls that host (its DNS, and scripts on its pages), so such a session is
# only ever honoured for the org in ``sorg``, whatever the org's sharing setting.
CUSTOM_DOMAIN_CLAIM = "cdm"

# Recognised authentication methods. "api_token" is internal: a machine
# credential that already carries its own org boundary and is exempt from the
# human auth-method policy.
AUTH_METHOD_PASSWORD = "password"
AUTH_METHOD_MAGIC_LOGIN = "magic_login"
AUTH_METHOD_GOOGLE = "google"
AUTH_METHOD_SSO = "sso"
AUTH_METHOD_API_TOKEN = "api_token"
# A launch from an LMS the org registered as an LTI platform. Not an
# admin-selectable method: the org opts in by registering the platform, and
# the session is only exempt from the method policy inside that org.
AUTH_METHOD_LTI = "lti"
# A short-lived session a host app minted with an org API token for one of
# the org's learners, to sign the embed components (@learnhouse/react, vue) in
# as that learner. The org opts in by holding the token; the session is held
# to that org, limited to the embed routes (src.security.embed_session) and can
# never touch the account itself.
AUTH_METHOD_EMBED = "embed"
# Sessions another system started on the org's behalf. They count only inside
# the org in ``sorg`` and are refused on account-security routes.
ORG_HELD_AUTH_METHODS = (AUTH_METHOD_LTI, AUTH_METHOD_EMBED)

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
    legacy_grace_expires: Optional[int] = None
    custom_domain: bool = False


_current: contextvars.ContextVar[Optional[SessionProvenance]] = contextvars.ContextVar(
    "session_provenance", default=None
)


def set_session_provenance(provenance: Optional[SessionProvenance]) -> None:
    _current.set(provenance)


def get_session_provenance() -> Optional[SessionProvenance]:
    return _current.get()


def session_claims(
    amr: Optional[str],
    org_id: Optional[int],
    legacy_grace_expires: Optional[int] = None,
    custom_domain: bool = False,
) -> dict:
    """Build the provenance claims to merge into a token's ``data`` dict.

    Omits keys that are ``None`` so a central (org-less) or method-less token
    stays as small as it was before this feature. The custom-domain mark only
    means something next to the org it binds the session to.
    """
    claims: dict = {}
    if amr is not None:
        claims[AMR_CLAIM] = amr
    if org_id is not None:
        claims[SORG_CLAIM] = org_id
    if legacy_grace_expires is not None:
        claims[LEGACY_GRACE_CLAIM] = legacy_grace_expires
    if custom_domain and org_id is not None:
        claims[CUSTOM_DOMAIN_CLAIM] = True
    return claims


def carry_session_claims(payload: dict) -> dict:
    """Carry a session's provenance across a token rotation.

    A session that records no auth method gets a grace deadline stamped on the
    first rotation after this shipped, and keeps it from then on. Without a
    deadline such a session would sit outside the org auth-method policy
    forever: rotation copies the missing method claim forward, so it never ages
    out on its own. Stamping here needs no stored state and no backfill: the
    deadline travels in the token, and a real sign-in replaces the whole thing
    with a method-bearing session.
    """
    amr = payload.get(AMR_CLAIM)
    grace = payload.get(LEGACY_GRACE_CLAIM)
    if amr is None and grace is None:
        grace = int(time.time()) + int(LEGACY_SESSION_GRACE.total_seconds())
    if amr is not None:
        grace = None
    return session_claims(
        amr, payload.get(SORG_CLAIM), grace, payload.get(CUSTOM_DOMAIN_CLAIM) is True
    )


def refuse_lms_session() -> None:
    """Refuse account-security changes from a session an LMS launch started.

    Such a session is held to the org that registered the LMS, and that org
    runs the LMS: it may act inside the org, never on the account itself
    (deleting it, its second factor, its email or password).
    """
    from fastapi import HTTPException

    provenance = get_session_provenance()
    if provenance is not None and provenance.amr == AUTH_METHOD_LTI:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "LMS_SESSION_NOT_ALLOWED",
                "message": "Sign in to LearnHouse directly to change your account settings.",
            },
        )
    # An embed session is the same kind of delegated sign-in (a host app vouched
    # for the learner), so it never reaches the account either. The embed route
    # allowlist already keeps it off these routes; this is the second wall.
    if provenance is not None and provenance.amr == AUTH_METHOD_EMBED:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "EMBED_SESSION_NOT_ALLOWED",
                "message": "Sign in to LearnHouse directly to change your account settings.",
            },
        )


def held_org_id() -> Optional[int]:
    """The org a session is held to, or None.

    Sessions an LMS launch or a host app's embed started, and sessions signed
    in on an org's custom domain, only count inside that org. Org-scoped routes enforce it through
    the org auth policy; routes that read "my things across orgs" narrow to
    this org instead.
    """
    provenance = get_session_provenance()
    if provenance is None or provenance.org_id is None:
        return None
    if provenance.amr in ORG_HELD_AUTH_METHODS or provenance.custom_domain:
        return provenance.org_id
    return None


def refuse_outside_held_org(org_id: int) -> None:
    """Refuse a request for another org than the one the session is held to."""
    from fastapi import HTTPException

    held = held_org_id()
    if held is not None and held != org_id:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "SESSION_NOT_BOUND_TO_ORG",
                "message": "This session only works in the organization it was started for.",
            },
        )

