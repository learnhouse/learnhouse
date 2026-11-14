"""Organization addresses: a good default from the name, and whether it's free.

The address is the org's subdomain, so a new admin should never have to invent
one: we derive it from the name and, when that's taken, offer the nearest free
variant instead of a red error.
"""

import re
import secrets
import unicodedata
from typing import Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization
from src.services.email.utils import ORG_SLUG_LABEL

MAX_SLUG_LENGTH = 40

# Hostnames the platform itself answers on, or that would read as the
# platform's own pages. Checked here and refused by the onboarding create
# endpoint (the older POST /orgs/ keeps its own rules).
RESERVED_SLUGS = frozenset({
    "admin", "api", "app", "apps", "auth", "billing", "blog", "cdn", "cname",
    "dashboard", "dev", "docs", "help", "home", "learnhouse", "login", "mail",
    "media", "new", "oauth", "signup", "static", "status", "support", "www",
})


def slugify(value: str) -> str:
    """Lower-case ASCII, words joined by single dashes, at most MAX_SLUG_LENGTH."""
    text = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return text[:MAX_SLUG_LENGTH].strip("-")


def _demo_slug() -> Optional[str]:
    from src.services.demo.flags import demo_enabled, demo_slug

    return demo_slug() if demo_enabled() else None


def slug_problem(slug: str) -> Optional[str]:
    """Why a slug can't be used regardless of who holds it, or None."""
    if not slug or len(slug) > MAX_SLUG_LENGTH or not ORG_SLUG_LABEL.fullmatch(slug):
        return "invalid"
    if slug in RESERVED_SLUGS or slug == _demo_slug():
        return "reserved"
    return None


async def is_taken(slug: str, db_session: AsyncSession) -> bool:
    row = (await db_session.execute(select(Organization.id).where(Organization.slug == slug))).first()
    return row is not None


async def suggest_slug(base: str, db_session: AsyncSession) -> str:
    """The first free address close to ``base``: base, base-2 … base-9, then a random tail."""
    root = slugify(base) or "academy"
    if slug_problem(root) == "reserved":
        root = f"{root}-academy"
    candidates = [root] + [f"{root[:MAX_SLUG_LENGTH - 2]}-{n}" for n in range(2, 10)]
    for candidate in candidates:
        if slug_problem(candidate) is None and not await is_taken(candidate, db_session):
            return candidate
    while True:
        candidate = f"{root[:MAX_SLUG_LENGTH - 5]}-{secrets.token_hex(2)}"
        if not await is_taken(candidate, db_session):
            return candidate


async def check_slug(name: str, slug: Optional[str], db_session: AsyncSession) -> dict:
    """Availability of ``slug`` (or the default derived from ``name``) and a free alternative."""
    wanted = (slug or "").strip().lower() if slug else slugify(name)
    problem = slug_problem(wanted)
    if problem is None and await is_taken(wanted, db_session):
        problem = "taken"
    suggestion = wanted if problem is None else await suggest_slug(wanted or name, db_session)
    return {"slug": wanted, "available": problem is None, "reason": problem, "suggestion": suggestion}
