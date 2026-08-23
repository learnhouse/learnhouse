"""
CTA and unsubscribe URLs for lifecycle email.

Every link a nudge can contain is built here, for one reason: a warm email that
lands on a 404 is worse than no email at all, and the failure is invisible from
the sending side. Centralising the construction means the route shapes are
asserted in one test file rather than scattered across thirty templates.

The trap worth knowing about: the frontend addresses a course by its *bare*
uuid, while the database column stores it with a ``course_`` prefix
(``removeCoursePrefix`` in ``apps/web/components/Objects/Thumbnails/
CourseThumbnail.tsx``). Passing the stored value straight into a URL yields a
dead link.
"""

from typing import Optional
from urllib.parse import quote

from src.services.email.utils import get_org_signup_base_url
from src.services.nudges.tokens import make_unsubscribe_token

# The `[subpage]` segment of the course editor route is a closed set; anything
# else renders a broken tab rather than 404ing, which is harder to notice.
COURSE_SUBPAGES = frozenset(
    {"general", "content", "access", "contributors", "seo", "certification", "analytics"}
)


def strip_course_prefix(course_uuid: str) -> str:
    """``course_abc123`` -> ``abc123``, matching the frontend's URL shape."""
    return (course_uuid or "").replace("course_", "", 1)


async def org_base_url(org_slug: str, db_session=None, org_id: Optional[int] = None) -> str:
    """Frontend base URL for an org, honouring its verified custom domain.

    Preferring the custom domain is not cosmetic: an org that has one keeps its
    session there, so a link to the generic ``{slug}.{domain}`` subdomain would
    land the reader cross-origin and bounce them to a login screen.
    """
    return (await get_org_signup_base_url(org_slug, None, db_session, org_id)).rstrip("/")


def dashboard_url(base: str) -> str:
    return f"{base}/dash"


def courses_url(base: str) -> str:
    return f"{base}/dash/courses"


def course_migrate_url(base: str) -> str:
    return f"{base}/dash/courses/migrate"


def onboarding_url(base: str) -> str:
    return f"{base}/dash/onboarding"


def members_url(base: str) -> str:
    return f"{base}/dash/users"


def org_settings_url(base: str, subpage: str = "general") -> str:
    return f"{base}/dash/org/settings/{quote(subpage, safe='')}"


def course_editor_url(base: str, course_uuid: str, subpage: str = "content") -> str:
    """Deep link into one course's editor.

    Falls back to ``content`` on an unknown subpage rather than emitting a URL
    that renders an empty tab.
    """
    if subpage not in COURSE_SUBPAGES:
        subpage = "content"
    bare = quote(strip_course_prefix(course_uuid), safe="")
    return f"{base}/dash/courses/course/{bare}/{subpage}"


def public_course_url(base: str, course_uuid: str) -> str:
    """The shareable, learner-facing course page."""
    bare = quote(strip_course_prefix(course_uuid), safe="")
    return f"{base}/course/{bare}"


def unsubscribe_url(api_base_url: str, user_uuid: str) -> str:
    """One-click unsubscribe link, also used for the List-Unsubscribe header.

    Points at the API rather than the frontend: the endpoint is the action
    target for RFC 8058 one-click, which posts directly without loading a page.
    """
    token = make_unsubscribe_token(user_uuid)
    return f"{api_base_url.rstrip('/')}/api/v1/emails/unsubscribe?token={quote(token, safe='')}"
