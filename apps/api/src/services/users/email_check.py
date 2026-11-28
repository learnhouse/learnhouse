"""Fake email check for self-service signups.

An address is refused when its domain:

- is malformed, an IP literal or a reserved name (``.test``, ``example.com``...);
- is a known throwaway domain (``mailchecker``'s list, the same one the web
  signup uses) or listed in ``LEARNHOUSE_BLOCKED_EMAIL_DOMAINS``;
- does not exist in DNS (NXDOMAIN);
- has no MX record, or a null MX (RFC 7505: "this domain takes no mail");
- hands its mail to a throwaway provider's servers (a fresh domain pointing
  its MX at a temp-mail service is still temp mail) or to localhost.

Big personal providers (Gmail, Outlook...) are real inboxes and skip the DNS
lookup. ``LEARNHOUSE_ALLOWED_EMAIL_DOMAINS`` skips every check for a domain.

DNS trouble (timeout, SERVFAIL, no nameserver answering) fails open: a
resolver outage must never lock real people out. Verdicts are cached per
domain in Redis (and in process when Redis is down).

On by default on SaaS only. ``LEARNHOUSE_FAKE_EMAIL_CHECK=1`` turns it on for
a self-hosted install, ``=0`` turns it off everywhere (an intranet whose mail
domains don't resolve publicly).
"""

import ipaddress
import logging
import os
import re
import time
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)

REJECT_MESSAGE = (
    "Please sign up with a real, permanent email address. Temporary, disposable "
    "or non-existent email domains are not accepted."
)

DNS_TIMEOUT_SECONDS = 3.0
CACHE_TTL_OK = 24 * 3600
CACHE_TTL_BAD = 6 * 3600
_CACHE_PREFIX = "learnhouse:email_domain_check:v1:"
_LOCAL_CACHE: dict[str, tuple[float, Optional[str]]] = {}
_LOCAL_CACHE_MAX = 5000

# Real inboxes at scale: no DNS round trip needed.
KNOWN_PROVIDERS = frozenset({
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com",
    "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "yahoo.com", "ymail.com", "zoho.com",
    "gmx.com", "gmx.net", "gmx.de", "web.de", "yandex.com", "yandex.ru", "mail.ru", "qq.com", "163.com",
    "126.com", "fastmail.com", "hey.com", "tutanota.com", "orange.fr", "free.fr", "laposte.net", "libero.it",
})

RESERVED_SUFFIXES = (".test", ".example", ".invalid", ".localhost", ".local", ".internal", ".lan", ".home.arpa")
RESERVED_DOMAINS = frozenset({"example.com", "example.net", "example.org", "localhost"})

# Mail hosts of temp-mail services. A domain whose MX points here is temp
# mail whatever its name. Matched as a suffix of the MX host.
DISPOSABLE_MX_SUFFIXES = (
    "mailinator.com", "yopmail.com", "guerrillamail.com", "sharklasers.com", "temp-mail.org", "tempmail.net",
    "10minutemail.com", "trashmail.com", "mailnesia.com", "maildrop.cc", "getnada.com", "nada.email",
    "mohmal.com", "dispostable.com", "emailondeck.com", "mail.tm", "mail.gw", "tempmailo.com", "minuteinbox.com",
    "emailfake.com", "fakemail.net", "throwawaymail.com", "mytemp.email", "inboxkitten.com", "burnermail.io",
    "tempm.com", "1secmail.com", "harakirimail.com", "spamgourmet.com", "mailcatch.com",
)

_LABEL = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)$")


@dataclass(frozen=True)
class EmailVerdict:
    ok: bool
    reason: Optional[str] = None  # machine code when refused


def check_enabled() -> bool:
    raw = os.environ.get("LEARNHOUSE_FAKE_EMAIL_CHECK", "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    from src.core.deployment_mode import get_deployment_mode

    return get_deployment_mode() == "saas"


def _env_domains(name: str) -> set[str]:
    return {d.strip().lower().lstrip("@") for d in os.environ.get(name, "").split(",") if d.strip()}


def _matches(domain: str, domains: set[str]) -> bool:
    """``domain`` is one of ``domains`` or a subdomain of one."""
    return any(domain == d or domain.endswith("." + d) for d in domains)


def domain_of(email: str) -> str:
    if not email or email.count("@") != 1:
        return ""
    return email.rsplit("@", 1)[1].strip().rstrip(".").lower()


def _syntax_reason(email: str, domain: str) -> Optional[str]:
    local = email.rsplit("@", 1)[0] if "@" in email else ""
    if not local or not domain or len(domain) > 253:
        return "malformed"
    try:
        ipaddress.ip_address(domain.strip("[]"))
        return "ip_literal"
    except ValueError:
        pass
    labels = domain.split(".")
    if len(labels) < 2 or not all(_LABEL.match(label) for label in labels):
        return "malformed"
    tld = labels[-1]
    if not (tld.isalpha() or tld.startswith("xn--")) or len(tld) < 2:
        return "malformed"
    if domain in RESERVED_DOMAINS or domain.endswith(RESERVED_SUFFIXES):
        return "reserved_domain"
    return None


def is_disposable_domain(domain: str) -> bool:
    if _matches(domain, _env_domains("LEARNHOUSE_BLOCKED_EMAIL_DOMAINS")):
        return True
    try:
        from MailChecker import MailChecker

        # mailchecker: False = invalid or a known temp-mail domain.
        return not MailChecker.is_valid(f"check@{domain}")
    except Exception:  # pragma: no cover - package missing
        return False


def _mx_reason(hosts: list[str]) -> Optional[str]:
    """Why these MX hosts can't be a real mailbox (None when they can)."""
    clean = [h.rstrip(".").lower() for h in hosts]
    if not clean or all(h == "" for h in clean):
        return "null_mx"
    for host in clean:
        if host in ("localhost", "localhost.localdomain") or host.endswith(".localhost"):
            return "mx_localhost"
        try:
            ip = ipaddress.ip_address(host)
            if ip.is_private or ip.is_loopback or ip.is_unspecified:
                return "mx_localhost"
        except ValueError:
            pass
        if any(host == s or host.endswith("." + s) for s in DISPOSABLE_MX_SUFFIXES):
            return "disposable_mx"
        parts = host.split(".")
        if len(parts) >= 2 and is_disposable_domain(".".join(parts[-2:])):
            return "disposable_mx"
    return None


async def _dns_reason(domain: str) -> tuple[Optional[str], bool]:
    """(reason, cacheable). Fails open on resolver trouble (not cacheable)."""
    import dns.asyncresolver
    import dns.exception
    import dns.resolver

    resolver = dns.asyncresolver.Resolver()
    resolver.lifetime = DNS_TIMEOUT_SECONDS
    resolver.timeout = DNS_TIMEOUT_SECONDS
    try:
        answer = await resolver.resolve(domain, "MX")
    except dns.resolver.NXDOMAIN:
        return "domain_not_found", True
    except dns.resolver.NoAnswer:
        return "no_mx", True
    except (dns.exception.Timeout, dns.resolver.NoNameservers, dns.resolver.LifetimeTimeout):
        logger.info("email domain check: DNS unavailable for %s, allowing", domain)
        return None, False
    except Exception:
        logger.warning("email domain check: DNS lookup failed for %s, allowing", domain, exc_info=True)
        return None, False
    hosts = [str(r.exchange) for r in answer]
    # RFC 7505 null MX: a single record whose exchange is the root ".".
    if all(h.rstrip(".") == "" for h in hosts):
        return "null_mx", True
    return _mx_reason(hosts), True


def _cache_get(domain: str) -> tuple[bool, Optional[str]]:
    """(hit, reason)."""
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is not None:
            raw = client.get(_CACHE_PREFIX + domain)
            if raw is not None:
                value = raw.decode() if isinstance(raw, bytes) else str(raw)
                return True, (value or None)
    except Exception:
        logger.debug("email domain check: Redis read failed", exc_info=True)
    hit = _LOCAL_CACHE.get(domain)
    if hit and hit[0] > time.monotonic():
        return True, hit[1]
    return False, None


def _cache_set(domain: str, reason: Optional[str]) -> None:
    ttl = CACHE_TTL_BAD if reason else CACHE_TTL_OK
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is not None:
            client.setex(_CACHE_PREFIX + domain, ttl, reason or "")
    except Exception:
        logger.debug("email domain check: Redis write failed", exc_info=True)
    if len(_LOCAL_CACHE) >= _LOCAL_CACHE_MAX:
        _LOCAL_CACHE.clear()
    _LOCAL_CACHE[domain] = (time.monotonic() + ttl, reason)


async def check_email(email: str) -> EmailVerdict:
    """Is ``email`` a real, permanent address? Runs whether or not the check
    is enabled (``ensure_real_email`` is the gate)."""
    email = (email or "").strip()
    domain = domain_of(email)
    reason = _syntax_reason(email, domain)
    if reason:
        return EmailVerdict(False, reason)
    if _matches(domain, _env_domains("LEARNHOUSE_ALLOWED_EMAIL_DOMAINS")):
        return EmailVerdict(True)
    if is_disposable_domain(domain):
        return EmailVerdict(False, "disposable")
    if domain in KNOWN_PROVIDERS:
        return EmailVerdict(True)
    hit, reason = _cache_get(domain)
    if not hit:
        reason, cacheable = await _dns_reason(domain)
        if cacheable:
            _cache_set(domain, reason)
    return EmailVerdict(reason is None, reason)


async def ensure_real_email(email: str) -> None:
    """Signup gate: 400 with a readable message for a fake address."""
    if not check_enabled():
        return
    verdict = await check_email(email)
    if not verdict.ok:
        logger.info("signup refused: fake email domain (%s) %s", verdict.reason, domain_of(email))
        raise HTTPException(status_code=400, detail=REJECT_MESSAGE)
