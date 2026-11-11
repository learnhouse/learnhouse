"""Embed sessions: short-lived learner sessions for the embed components.

A host app holding an org API token mints one for a learner of that org
(``POST /api/v1/admin/{org_slug}/auth/embed-session``) and hands it to
``@learnhouse/react`` / ``@learnhouse/vue`` in the browser. The token is an
ordinary access JWT (``purpose: session``) stamped ``amr: embed`` and
``sorg: <org id>``, so everything that trusts a session (RBAC, the collab
server) treats it as that learner. Three things keep it narrower than a real
sign-in, because it lives in someone else's web page:

* It is short-lived (15 minutes by default, one hour at most) and comes with
  no refresh token: the host mints a new one when it runs out.
* It is held to the org that minted it (``ORG_HELD_AUTH_METHODS`` in
  :mod:`src.security.session_context`) and refused on every account-security
  route, like an LTI launch session.
* It only reaches the routes the embed components call, listed below. Every
  other route answers 403, whatever the learner could do with a full session.
  Anything not listed is refused, so a new route stays closed to embeds until
  it is added here on purpose.
"""

import re
from datetime import timedelta
from typing import Optional

from fastapi import HTTPException, Request, status

EMBED_SESSION_DEFAULT_TTL = timedelta(minutes=15)
EMBED_SESSION_MIN_TTL = timedelta(minutes=1)
EMBED_SESSION_MAX_TTL = timedelta(hours=1)

_API_PREFIX = "/api/v1"

_SEG = r"[A-Za-z0-9_-]+"

# Reads the embed components make. RBAC still applies on each of them: the
# allowlist only decides which routes an embed token may reach at all.
_READ_ROUTES = tuple(
    re.compile(pattern)
    for pattern in (
        # Courses, chapters and activities the learner can see.
        rf"^/courses/{_SEG}(/meta)?$",
        r"^/courses/id/\d+$",
        rf"^/chapters/course/{_SEG}/meta$",
        rf"^/activities/{_SEG}(/state)?$",
        r"^/activities/id/\d+$",
        # Their own progress.
        r"^/trail/org/\d+/trail$",
        # Assignments: the assignment, its tasks and their own submissions.
        rf"^/assignments/activity/{_SEG}$",
        rf"^/assignments/{_SEG}$",
        rf"^/assignments/{_SEG}/tasks$",
        rf"^/assignments/task/{_SEG}$",
        rf"^/assignments/{_SEG}/submissions/me$",
        rf"^/assignments/{_SEG}/tasks/submissions/me$",
        rf"^/assignments/{_SEG}/tasks/{_SEG}/submissions/me$",
        rf"^/assignments/{_SEG}/submissions/\d+/grade$",
        # Media blocks, link previews and their own code submissions.
        r"^/blocks/(audio|image|pdf|video)$",
        rf"^/media/{_SEG}(/file)?$",
        r"^/utils/link-preview$",
        r"^/code/submissions/history$",
        # Who they are, and the people a user block shows.
        r"^/users/session$",
        rf"^/users/(id|uuid|username)/{_SEG}$",
        # The org the session belongs to.
        rf"^/orgs/(slug|uuid)/{_SEG}$",
        r"^/instance/info$",
        # Boards the learner is a member of (the collab server checks
        # membership with the same token before opening the room).
        rf"^/boards/{_SEG}(/membership)?$",
    )
)

# The only things an embed may change: its own progress, its own assignment
# work and its own code runs.
_WRITE_ROUTES = {
    "POST": tuple(
        re.compile(pattern)
        for pattern in (
            rf"^/trail/add_activity/{_SEG}$",
            rf"^/assignments/{_SEG}/tasks/{_SEG}/sub_file$",
            rf"^/assignments/{_SEG}/submissions$",
            rf"^/assignments/{_SEG}/submissions/me/retry$",
            r"^/code/(execute|execute-batch)$",
            r"^/code/submissions/save$",
        )
    ),
    "PUT": (re.compile(rf"^/assignments/{_SEG}/tasks/{_SEG}/submissions$"),),
    "DELETE": (re.compile(rf"^/trail/remove_activity/{_SEG}$"),),
}


def is_embed_route(method: str, path: str) -> bool:
    """Whether an embed session may call ``method path`` at all."""
    if not path.startswith(_API_PREFIX + "/"):
        return False
    route = path[len(_API_PREFIX):]
    if len(route) > 1 and route.endswith("/"):
        route = route[:-1]
    method = method.upper()
    if method in ("GET", "HEAD"):
        rules = _READ_ROUTES
    else:
        rules = _WRITE_ROUTES.get(method, ())
    return any(rule.match(route) for rule in rules)


def _org_param(request: Request) -> Optional[str]:
    raw = request.path_params.get("org_id")
    if raw is None:
        raw = request.query_params.get("org_id")
    return None if raw is None else str(raw)


def enforce_embed_scope(request: Request, org_id: Optional[int]) -> None:
    """Refuse an embed-session request outside the embed routes or its org.

    Called by :func:`src.security.auth.get_current_user` for every request an
    embed token authenticates, before any route logic runs.
    """
    if org_id is None:
        # Minting always stamps the org; a token without one was not made by
        # the embed endpoint and is not honoured.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not is_embed_route(request.method, request.url.path):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "EMBED_SESSION_ROUTE_NOT_ALLOWED",
                "message": "Embed sessions can only be used by the LearnHouse embed components.",
            },
        )
    requested_org = _org_param(request)
    if requested_org is not None and requested_org != str(org_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "SESSION_NOT_BOUND_TO_ORG",
                "message": "This session only works in the organization it was started for.",
            },
        )
