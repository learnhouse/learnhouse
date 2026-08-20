import logging
import os
import re
import smtplib
import ssl
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional
from urllib.parse import urlparse

from pydantic import EmailStr
from fastapi import Request
import resend
from config.config import get_learnhouse_config
from src.services.email.sender import DEFAULT_SENDER_NAME, format_sender

logger = logging.getLogger(__name__)


def _configured_host(cfg_value: Optional[str]) -> str:
    """Bare, lowercase hostname of a configured domain value, "" when unset.

    frontend_domain/domain may be a full URL, a bare host, or a "host:port" with
    no scheme (the shipped default is "localhost:3000"). urlparse only populates
    .hostname when a scheme or leading "//" is present, so prefix "//" for
    schemeless values; otherwise the port would leak into the host and never
    match a request host (which is always port-less).
    """
    cfg_value = (cfg_value or "").strip().rstrip("/")
    if not cfg_value:
        return ""
    parsed = urlparse(cfg_value if "://" in cfg_value else f"//{cfg_value}")
    host = parsed.hostname or cfg_value
    return host.removeprefix("www.").lower()


# A regexp that matches an unrelated, randomly-named host is a catch-all, not an
# allowlist — and `re.fullmatch` accepted the historical shipped default
# (`\b((?:https?://)[^\s/$.?#].[^\s]*)\b`) for *any* http(s) URL, which let an
# attacker's Origin header become the base URL of an emailed magic-login link.
# Probe every configured regexp with a canary host before trusting it.
_ORIGIN_REGEXP_CANARIES = (
    "https://not-an-allowed-origin-canary.invalid",
    "http://not-an-allowed-origin-canary.invalid:8443",
)


def _is_scoped_origin_regexp(pattern: str) -> bool:
    """True when ``pattern`` is a usable origin allowlist rather than a catch-all."""
    try:
        compiled = re.compile(pattern)
    except re.error:
        logger.error("Ignoring unparsable allowed_regexp for email URLs: %r", pattern)
        return False
    if any(compiled.fullmatch(canary) for canary in _ORIGIN_REGEXP_CANARIES):
        logger.error(
            "Ignoring catch-all allowed_regexp %r for email URLs: it matches "
            "arbitrary hosts. Configure an anchored, domain-scoped pattern.",
            pattern,
        )
        return False
    return True


def _is_verified_custom_domain(host: str) -> bool:
    """True when ``host`` is a VERIFIED org custom domain for this deployment.

    Multi-tenant orgs legitimately reach the API from their own domain, so a
    check pinned to the platform domain alone would send their users links on
    the wrong host. The CSRF middleware already resolves the request's Origin
    against the ``custom_domains`` table (verified rows only) before the handler
    runs and memoizes the answer for a short TTL — read that, because this
    helper is synchronous and cannot await a DB session. On a miss the caller
    falls back to the configured canonical base URL: correct-by-default and
    never attacker-controlled.
    """
    if not host:
        return False
    try:
        from src.security.csrf import _CUSTOM_DOMAIN_CACHE
    except Exception:  # pragma: no cover - defensive, csrf has no heavy imports
        return False
    cached = _CUSTOM_DOMAIN_CACHE.get(host)
    if not cached:
        return False
    allowed, expires_at = cached
    return bool(allowed) and expires_at > time.monotonic()


def _is_allowed_base_url(url: str) -> bool:
    """Validate that a URL is an allowed origin for email links."""
    config = get_learnhouse_config()
    url_stripped = url.rstrip("/")

    parsed = urlparse(url_stripped)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False

    req_host = parsed.hostname.removeprefix("www.").lower()
    base_domain = _configured_host(config.hosting_config.domain)
    frontend_host = _configured_host(config.hosting_config.frontend_domain)
    configured_hosts = {host for host in (base_domain, frontend_host) if host}

    if config.hosting_config.tenancy == "single":
        if req_host in configured_hosts:
            return True

        if config.general_config.development_mode and req_host in ("localhost", "127.0.0.1"):
            return True

        return False

    # Multi-tenancy. `url` comes from an attacker-controllable Origin/Referer
    # header and ends up as the base of an emailed login link, so every branch
    # below has to name a host the operator actually vouched for.

    # Check against configured allowed origins
    for allowed in config.hosting_config.allowed_origins:
        if url_stripped == allowed.rstrip("/"):
            return True

    # The platform domain and any org subdomain of it (slug.learnhouse.io).
    if req_host in configured_hosts:
        return True
    if base_domain and req_host.endswith(f".{base_domain}"):
        return True

    # Check against allowed_regexp, but only when it is actually scoped
    allowed_regexp = config.hosting_config.allowed_regexp
    if allowed_regexp and _is_scoped_origin_regexp(allowed_regexp):
        if re.fullmatch(allowed_regexp, url_stripped):
            return True

    # Orgs on a verified custom domain must keep getting links on their own host
    if _is_verified_custom_domain(parsed.hostname.lower()):
        return True

    # Check against LEARNHOUSE_PLATFORM_URL (the main platform, e.g. https://www.learnhouse.app)
    platform_url = os.environ.get("LEARNHOUSE_PLATFORM_URL", "").rstrip("/")
    if platform_url:
        platform_host = (
            (urlparse(platform_url).hostname or "").removeprefix("www.").lower()
        )
        if platform_host and req_host == platform_host and parsed.scheme == "https":
            return True

    # In development mode, allow localhost
    if config.general_config.development_mode and parsed.hostname in (
        "localhost",
        "127.0.0.1",
    ):
        return True

    return False


def _configured_frontend_base_url() -> Optional[str]:
    """Request-free frontend base URL, for callers with no HTTP request.

    Background jobs (cron-invoked lifecycle mail) build links outside any
    request, so the request-derived fallbacks below are unavailable to them.
    Resolve from explicit config instead; returns None when nothing usable is
    configured, so callers can decide whether that is fatal.
    """
    platform_url = os.environ.get("LEARNHOUSE_PLATFORM_URL")
    if platform_url:
        return platform_url.rstrip("/")

    config = get_learnhouse_config()
    scheme = "https" if config.hosting_config.ssl else "http"
    frontend_domain = (config.hosting_config.frontend_domain or "").strip().rstrip("/")
    if frontend_domain and "localhost" not in frontend_domain:
        return f"{scheme}://{frontend_domain}"

    base_domain = (config.hosting_config.domain or "").strip().rstrip("/")
    if base_domain and "localhost" not in base_domain:
        return f"{scheme}://{base_domain}"

    return None


async def get_org_signup_base_url(
    org_slug: str,
    request: Optional[Request] = None,
    db_session=None,
    org_id: Optional[int] = None,
) -> str:
    """
    Return the org-scoped frontend base URL for invitation / signup links.

    Branches on tenancy:

    - tenancy == "single": always use the URL the request came in on. Same
      code path serves localhost dev and self-hosted VPS deployments — there
      is no subdomain concept and no custom-domain table to consult.
    - tenancy == "multi":
        1. If ``db_session`` and ``org_id`` are supplied, prefer the org's
           verified custom domain (primary first). Using the generic
           subdomain for orgs that have a custom domain would be cross-origin
           to the user's existing session on the custom domain.
        2. Else fall back to ``{slug}.{hosting_config.domain}``.
        3. Misconfigured (no domain or localhost) → request-derived URL.

    ``request`` is optional so background jobs can build links too; without
    one, the request-derived fallbacks resolve from config instead.
    """
    config = get_learnhouse_config()

    if config.hosting_config.tenancy == "single":
        if request is not None:
            return get_base_url_from_request(request)
        return _configured_frontend_base_url() or ""

    scheme = "https" if config.hosting_config.ssl else "http"

    if db_session is not None and org_id is not None:
        custom_domain = await _get_primary_verified_custom_domain(db_session, org_id)
        if custom_domain:
            return f"{scheme}://{custom_domain}"

    base_domain = (config.hosting_config.domain or "").strip().rstrip("/")
    if not base_domain or "localhost" in base_domain:
        if request is not None:
            return get_base_url_from_request(request)
        return _configured_frontend_base_url() or ""

    return f"{scheme}://{org_slug}.{base_domain}"


def get_media_base_url(request: Optional[Request] = None) -> str:
    """Public base URL that serves ``/content/...`` files (org logos, etc.).

    Email HTML can't reference local assets, so an embedded org logo needs an
    absolute, publicly reachable URL. The host that serves ``/content`` is the
    backend/media host — which is normally configured only on the FRONTEND
    (``NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL`` / ``..._MEDIA_URL``). The backend
    doesn't have that value, so resolve it in order:

    1. An explicit backend override (``LEARNHOUSE_MEDIA_URL`` /
       ``LEARNHOUSE_BACKEND_URL``) — set this if the media host isn't ``api.``.
    2. The SaaS convention ``{scheme}://api.{domain}`` (e.g. api.learnhouse.io)
       when a real domain is configured.
    3. The request's own host as a last resort (correct for single-tenant /
       self-hosted where API and content share the request origin).

    ``request`` is optional so background jobs can resolve a logo URL; without
    one, step 3 is unavailable and this returns "" rather than guessing.
    """
    override = os.environ.get("LEARNHOUSE_MEDIA_URL") or os.environ.get(
        "LEARNHOUSE_BACKEND_URL"
    )
    if override:
        return override.rstrip("/")

    config = get_learnhouse_config()
    base_domain = (config.hosting_config.domain or "").strip().rstrip("/")
    if base_domain and "localhost" not in base_domain:
        scheme = "https" if config.hosting_config.ssl else "http"
        return f"{scheme}://api.{base_domain}"

    # Single-tenant / dev: the API answering this request also serves /content.
    if request is None:
        return ""
    return str(request.base_url).rstrip("/")


def get_org_logo_url(org, request: Optional[Request] = None) -> Optional[str]:
    """Absolute URL of an org's uploaded logo, or None when it has none.

    Mirrors the frontend's ``getOrgLogoMediaDirectory`` path shape
    (``content/orgs/{uuid}/logos/{file}``). Returns None so callers fall back
    to the default LearnHouse mark.
    """
    logo_image = getattr(org, "logo_image", None)
    org_uuid = getattr(org, "org_uuid", None)
    if not org or not logo_image or not org_uuid:
        return None
    base = get_media_base_url(request)
    if not base:
        # No absolute media host resolvable (no request, nothing configured).
        # A relative src would render broken in every mail client, so fall
        # back to the default LearnHouse mark instead.
        return None
    return f"{base}/content/orgs/{org_uuid}/logos/{logo_image}"


async def _get_primary_verified_custom_domain(db_session, org_id: int) -> Optional[str]:
    """Return the org's primary verified custom domain, or any verified one."""
    try:
        from sqlmodel import select
        from src.db.custom_domains import CustomDomain

        primary = (await db_session.execute(
            select(CustomDomain).where(
                CustomDomain.org_id == org_id,
                CustomDomain.status == "verified",
                CustomDomain.primary == True,  # noqa: E712
            )
        )).scalars().first()
        if primary:
            return primary.domain

        any_verified = (await db_session.execute(
            select(CustomDomain).where(
                CustomDomain.org_id == org_id,
                CustomDomain.status == "verified",
            )
        )).scalars().first()
        return any_verified.domain if any_verified else None
    except Exception:
        logger.exception("Failed to look up custom domain for org %s", org_id)
        return None


def get_trusted_base_url_from_request(request: Request) -> Optional[str]:
    """
    Return the request's Origin/Referer base URL **only if** it is an allowed
    origin, otherwise None.

    This is the "we actually know where the request came from" part of
    ``get_base_url_from_request`` — callers that need to distinguish a trusted,
    request-derived URL from the configured fallback (e.g. platform signups that
    prefer the platform URL over ``frontend_domain``) use this directly.
    """
    # Try Origin header first
    origin = request.headers.get("origin")
    if origin:
        candidate = origin.rstrip("/")
        if _is_allowed_base_url(candidate):
            return candidate
        logger.warning("Rejected untrusted Origin header for email URL: %s", candidate)

    # Try Referer header as fallback
    referer = request.headers.get("referer")
    if referer:
        parsed = urlparse(referer)
        candidate = f"{parsed.scheme}://{parsed.netloc}"
        if _is_allowed_base_url(candidate):
            return candidate
        logger.warning("Rejected untrusted Referer header for email URL: %s", candidate)

    return None


def get_base_url_from_request(request: Request) -> str:
    """
    Extract the base URL from a FastAPI request.

    Uses the Origin or Referer header to determine the frontend URL,
    but validates against allowed origins to prevent open redirect.

    Args:
        request: FastAPI Request object

    Returns:
        Base URL string (e.g., "https://myorg.example.com")
    """
    trusted = get_trusted_base_url_from_request(request)
    if trusted:
        return trusted

    # Fall back to configured frontend_domain (preferred over raw request URL
    # which would point to the API server, not the frontend)
    config = get_learnhouse_config()
    frontend_domain = config.hosting_config.frontend_domain
    if frontend_domain:
        scheme = "https" if config.hosting_config.ssl else "http"
        return f"{scheme}://{frontend_domain}"

    # Last resort: construct from request URL
    return f"{request.url.scheme}://{request.url.netloc}"


def send_email(
    to: EmailStr,
    subject: str,
    body: str,
    headers: Optional[dict[str, str]] = None,
    sender_name: Optional[str] = None,
):
    """Send one HTML email.

    ``headers`` carries extra SMTP headers through to the provider. Bulk
    lifecycle mail needs ``List-Unsubscribe`` / ``List-Unsubscribe-Post``;
    Gmail and Outlook penalise bulk senders that omit them. Transactional
    callers pass nothing and are unaffected.

    ``sender_name`` is the DISPLAY NAME only — an organization's own name on
    org-scoped mail, ``None`` on platform mail so it falls back to the
    deployment default. The From ADDRESS is always
    ``mailing.system_email_address`` and is deliberately not configurable: it
    is the domain holding the verified SPF/DKIM records, and an org-chosen
    address would fail DKIM alignment on every message while damaging a
    sending reputation shared across tenants. The name is admin-supplied text
    landing in an RFC 5322 header, so it is sanitized in ``format_sender``
    before it gets anywhere near one.
    """
    from fastapi import HTTPException

    lh_config = get_learnhouse_config()
    mailing = lh_config.mailing_config
    sender = format_sender(
        sender_name,
        mailing.system_email_address,
        getattr(mailing, "system_email_sender_name", DEFAULT_SENDER_NAME),
    )

    # Resend (and most providers) require a plain `email@example.com` string.
    # Pydantic's EmailStr is a str subclass, but third-party JSON serializers
    # can mis-handle it — coerce to a stripped plain str and validate shape
    # so a malformed stored email surfaces here rather than as an opaque
    # provider 4xx.
    to_addr = str(to).strip()
    if not to_addr or "@" not in to_addr:
        logger.error("Refusing to send email: invalid recipient %r", to)
        raise HTTPException(status_code=400, detail="Invalid recipient email address")

    # The demo organization's fake students hold addresses on a reserved
    # `.invalid` domain, which by RFC 2606 can never resolve. Dropping them here
    # rather than trusting every caller to filter makes "a demo student cannot
    # receive mail" a property of the system instead of a convention: no code
    # path added later can accidentally mail forty fictional people, and the
    # provider is never handed an address it will bounce (which costs sender
    # reputation on a shared domain).
    from src.services.demo.flags import is_demo_email

    if is_demo_email(to_addr):
        logger.warning(
            "Dropping email to demo address %s (subject=%r)", to_addr, subject
        )
        return None

    if mailing.email_provider == "smtp":
        return _send_email_smtp(sender, to_addr, subject, body, mailing, headers)
    else:
        return _send_email_resend(sender, to_addr, subject, body, mailing, headers)


# Transient provider hiccups (read timeouts, connection resets, 5xx) usually
# clear within a second; a single quick retry turns most of them into a
# delivered email instead of a 503 on a password-reset request.
_RESEND_RETRIES = 1
_RESEND_RETRY_DELAY_SECONDS = 1.0


def _is_transient_email_error(exc: BaseException) -> bool:
    message = str(exc).lower()
    if "quota" in message or "rate limit" in message:
        return False
    return any(
        marker in message
        for marker in ("timed out", "timeout", "connection", "temporarily", "502", "503", "504")
    )


def _is_recipient_rejected(exc: BaseException) -> bool:
    """True only when the provider rejected the RECIPIENT address itself.

    A bad address supplied by a caller (a provisioning integration creating
    accounts on example.com, a typo in an admin-entered email) is a property of
    that address: retrying cannot help, and it is not an incident worth paging
    on. Everything else stays at error level, because it means mail is broken
    for everyone — an unverified sending domain (invalid_from_address), an empty
    subject or body from a template regression (missing_required_field), an
    auth failure, a rate limit, a 5xx, or a non-JSON body from an intermediary
    (application_error). Classifying on the bare 4xx status would sweep all of
    those into silence, so we require positive evidence: a validation error that
    names the `to` field.
    """
    if str(getattr(exc, "error_type", "")).lower() != "validation_error":
        return False
    message = str(exc).lower()
    return "`to`" in message or "to field" in message


def _send_email_resend(
    sender: str,
    to: str,
    subject: str,
    body: str,
    mailing,
    headers: Optional[dict[str, str]] = None,
):
    from fastapi import HTTPException
    resend.api_key = mailing.resend_api_key
    payload = {
        "from": sender,
        "to": [to],
        "subject": subject,
        "html": body,
    }
    if headers:
        payload["headers"] = dict(headers)
    for attempt in range(_RESEND_RETRIES + 1):
        try:
            return resend.Emails.send(payload)
        except Exception as e:
            if attempt < _RESEND_RETRIES and _is_transient_email_error(e):
                logger.warning("Resend email to %s failed (%s), retrying once", to, e)
                time.sleep(_RESEND_RETRY_DELAY_SECONDS)
                continue
            if _is_recipient_rejected(e):
                logger.warning("Resend rejected the recipient address %s: %s", to, e)
            else:
                logger.error("Resend email failed to %s: %s", to, e, exc_info=True)
            raise HTTPException(status_code=503, detail="Email service temporarily unavailable")


_SMTP_TIMEOUT = 15
# Implicit-TLS SMTP port: the session is encrypted from the first byte, so there
# is no STARTTLS upgrade to perform.
_SMTP_IMPLICIT_TLS_PORT = 465


def _smtp_port_number(port) -> int:
    """Configured SMTP port as an int; 0 when it is unset or non-numeric."""
    try:
        return int(port)
    except (TypeError, ValueError):
        return 0


def _smtp_tls_context() -> ssl.SSLContext:
    """Certificate-verifying TLS context for outbound SMTP.

    ``starttls()``/``SMTP_SSL`` with no ``context`` fall back to
    ``ssl._create_stdlib_context()``, which is the *unverified* context
    (``CERT_NONE``, ``check_hostname=False``). An on-path attacker answering the
    connection with any self-signed certificate would then collect the SMTP
    credentials and the plaintext of every password-reset, verification and
    magic-login email.
    """
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.check_hostname = True
    context.verify_mode = ssl.CERT_REQUIRED
    return context


def _send_email_smtp(
    sender: str,
    to: str,
    subject: str,
    body: str,
    mailing,
    headers: Optional[dict[str, str]] = None,
):
    from fastapi import HTTPException
    msg = MIMEMultipart("alternative")
    msg["From"] = sender
    msg["To"] = to
    msg["Subject"] = subject
    for header_name, header_value in (headers or {}).items():
        msg[header_name] = header_value
    msg.attach(MIMEText(body, "html"))

    server = None
    try:
        if mailing.smtp_use_tls:
            context = _smtp_tls_context()
            if _smtp_port_number(mailing.smtp_port) == _SMTP_IMPLICIT_TLS_PORT:
                server = smtplib.SMTP_SSL(
                    mailing.smtp_host,
                    mailing.smtp_port,
                    timeout=_SMTP_TIMEOUT,
                    context=context,
                )
            else:
                server = smtplib.SMTP(mailing.smtp_host, mailing.smtp_port, timeout=_SMTP_TIMEOUT)
                server.starttls(context=context)
        else:
            server = smtplib.SMTP(mailing.smtp_host, mailing.smtp_port, timeout=_SMTP_TIMEOUT)

        if mailing.smtp_username and mailing.smtp_password:
            # AUTH on a cleartext session hands the relay credentials to anyone
            # on the path. Refuse rather than send them.
            if not mailing.smtp_use_tls:
                logger.error(
                    "Refusing SMTP login to %s:%s: smtp_use_tls is false, so the "
                    "credentials would be sent in cleartext. Enable smtp_use_tls "
                    "or clear smtp_username/smtp_password.",
                    mailing.smtp_host,
                    mailing.smtp_port,
                )
                raise HTTPException(
                    status_code=503,
                    detail="Email service misconfigured: SMTP credentials require TLS",
                )
            server.login(mailing.smtp_username, mailing.smtp_password)

        server.sendmail(mailing.system_email_address, to, msg.as_string())
        return {"id": None, "to": to}
    except smtplib.SMTPException as e:
        logger.error("SMTP error sending to %s: %s", to, e, exc_info=True)
        raise HTTPException(status_code=503, detail="Email service error")
    except ssl.SSLError as e:
        # SSLError subclasses OSError, so this must stay above the OSError arm.
        logger.error(
            "SMTP TLS verification failed for %s:%s: %s. The relay's certificate "
            "is not trusted or does not match its hostname — fix the relay's "
            "certificate or point smtp_host at the name the certificate covers.",
            mailing.smtp_host,
            mailing.smtp_port,
            e,
            exc_info=True,
        )
        raise HTTPException(
            status_code=503, detail="Email service TLS verification failed"
        )
    except OSError as e:
        logger.error("SMTP connection error to %s:%s: %s", mailing.smtp_host, mailing.smtp_port, e, exc_info=True)
        raise HTTPException(status_code=503, detail="Email service unavailable")
    finally:
        if server is not None:
            try:
                server.quit()
            except Exception:
                pass

