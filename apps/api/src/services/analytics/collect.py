"""Turning browser beacons into clean analytics rows.

Privacy model, in short:

* No cookies and no stored IPs. A visitor who isn't signed in is counted with
  a hash of (secret, day, org, IP, user agent). The day is part of the hash,
  so the same person gets a new id every day and can't be followed across
  days or across orgs; the IP itself never reaches storage.
* Country comes from the edge's geo header (Cloudflare and friends), never
  from looking the IP up, and only when the org allows it.
* Signed-in users who aren't members of the org are counted like anonymous
  visitors, so an org's dashboards never name people outside the org.
"""

import hashlib
import hmac
import ipaddress
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlsplit

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization
from src.db.roles import Role
from src.db.user_organizations import UserOrganization
from src.services.analytics.analytics import build_row
from src.services.analytics.events import CATALOG, STAFF_EXCLUDABLE_EVENTS
from src.services.analytics.settings import get_settings

MAX_EVENTS_PER_BATCH = 25
CACHE_TTL_SECONDS = 300

_BOT_UA = re.compile(
    r"bot|crawl|spider|slurp|headless|lighthouse|pagespeed|prerender|preview|"
    r"facebookexternalhit|embedly|curl|wget|python-|httpx|aiohttp|axios|go-http|"
    r"java/|okhttp|node-fetch|scrapy|phantomjs|selenium|puppeteer|playwright",
    re.IGNORECASE,
)
_GEO_HEADERS = ("cf-ipcountry", "x-vercel-ip-country", "cloudfront-viewer-country", "x-country-code")
_COUNTRY = re.compile(r"^[A-Z]{2}$")

# (user_id, org_id) -> (expires_at, is_member, is_staff)
_membership_cache: dict[tuple[int, int], tuple[float, bool, bool]] = {}
# org_id -> (expires_at, exists)
_org_cache: dict[int, tuple[float, bool]] = {}


def is_bot(user_agent: str) -> bool:
    return not user_agent or bool(_BOT_UA.search(user_agent))


def device_type(user_agent: str) -> str:
    if re.search(r"iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)", user_agent, re.IGNORECASE):
        return "tablet"
    if re.search(r"Mobi|iPhone|iPod|Android", user_agent, re.IGNORECASE):
        return "mobile"
    return "desktop"


def country_from_headers(headers) -> str | None:
    for header in _GEO_HEADERS:
        value = (headers.get(header) or "").strip().upper()
        if _COUNTRY.match(value) and value not in ("XX", "T1"):
            return value
    return None


def visitor_key(secret: str, org_id: int, ip: str, user_agent: str, now: datetime | None = None) -> str:
    """Daily-rotating anonymous visitor id. The IP is truncated before hashing
    (last octet / last 80 bits) so even the hash input isn't a full address."""
    day = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%d")
    message = f"{day}|{org_id}|{_truncate_ip(ip)}|{user_agent}".encode()
    digest = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return f"v:{digest[:20]}"


def _truncate_ip(ip: str) -> str:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    prefix = 24 if addr.version == 4 else 48
    return str(ipaddress.ip_network(f"{addr}/{prefix}", strict=False).network_address)


def referrer_domain(value: object, own_hosts: set[str]) -> str | None:
    """Bare host of an external referrer; None for empty or self-referrals."""
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip().lower()
    host = urlsplit(raw if "//" in raw else f"//{raw}").hostname or ""
    host = host.removeprefix("www.")
    if not host or host in own_hosts:
        return None
    return host[:255]


def own_hosts(headers) -> set[str]:
    """Hosts that count as the site itself (the page the beacon came from)."""
    hosts = set()
    for header in ("origin", "referer", "host", "x-forwarded-host"):
        value = (headers.get(header) or "").strip().lower()
        if not value:
            continue
        host = urlsplit(value if "//" in value else f"//{value}").hostname
        if host:
            hosts.add(host.removeprefix("www."))
    return hosts


async def org_exists(org_id: int, db_session: AsyncSession) -> bool:
    cached = _org_cache.get(org_id)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    found = (
        await db_session.execute(select(Organization.id).where(Organization.id == org_id))
    ).first() is not None
    _org_cache[org_id] = (time.monotonic() + (CACHE_TTL_SECONDS if found else 60), found)
    return found


async def membership(user_id: int, org_id: int, db_session: AsyncSession) -> tuple[bool, bool]:
    """(is_member, is_staff) for a user in an org. Staff = can manage the org."""
    key = (user_id, org_id)
    cached = _membership_cache.get(key)
    if cached and cached[0] > time.monotonic():
        return cached[1], cached[2]
    row = (
        await db_session.execute(
            select(Role)
            .join(UserOrganization, UserOrganization.role_id == Role.id)
            .where(UserOrganization.user_id == user_id, UserOrganization.org_id == org_id)
        )
    ).scalars().first()
    is_member = row is not None
    is_staff = False
    if row is not None:
        rights = row.rights if isinstance(row.rights, dict) else (row.rights.model_dump() if row.rights else {})
        is_staff = bool((rights.get("organizations") or {}).get("action_update"))
    _membership_cache[key] = (time.monotonic() + CACHE_TTL_SECONDS, is_member, is_staff)
    return is_member, is_staff


@dataclass
class BeaconContext:
    org_id: int
    user_id: int  # 0 when anonymous or not a member of the org
    session_id: str
    ip: str
    user_agent: str
    headers: object
    secret: str


async def build_web_rows(ctx: BeaconContext, events: list[tuple[str, dict]], db_session: AsyncSession) -> list[dict]:
    """Validate a beacon's events and return the rows to store."""
    if is_bot(ctx.user_agent) or not await org_exists(ctx.org_id, db_session):
        return []

    settings = await get_settings(ctx.org_id, db_session)
    user_id, is_staff = 0, False
    if ctx.user_id:
        is_member, is_staff = await membership(ctx.user_id, ctx.org_id, db_session)
        user_id = ctx.user_id if is_member else 0
    if not user_id and not settings.track_anonymous:
        return []

    actor = f"u:{user_id}" if user_id else visitor_key(ctx.secret, ctx.org_id, ctx.ip, ctx.user_agent)
    country = country_from_headers(ctx.headers) if settings.collect_location else None
    device = device_type(ctx.user_agent)
    hosts = own_hosts(ctx.headers)

    rows = []
    for name, props in events[:MAX_EVENTS_PER_BATCH]:
        spec = CATALOG.get(name)
        if spec is None or not spec.web or (not user_id and not spec.public):
            continue
        if is_staff and settings.exclude_staff and name in STAFF_EXCLUDABLE_EVENTS:
            continue
        props = dict(props) if isinstance(props, dict) else {}
        props["referrer_domain"] = referrer_domain(props.get("referrer_domain") or props.get("referrer"), hosts)
        row = build_row(
            name, ctx.org_id, user_id, ctx.session_id, props,
            source="web", actor_key=actor, country=country, device=device,
        )
        if row is not None:
            rows.append(row)
    return rows
