import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional
from urllib.parse import urlparse

from pydantic import EmailStr
from fastapi import Request
import resend
from config.config import get_learnhouse_config

logger = logging.getLogger(__name__)


def _is_allowed_base_url(url: str) -> bool:
    """Validate that a URL is an allowed origin for email links."""
    config = get_learnhouse_config()
    url_stripped = url.rstrip("/")

    if config.hosting_config.tenancy == "single":
        parsed = urlparse(url_stripped)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False

        req_host = parsed.hostname.removeprefix("www.").lower()

        configured_hosts = set()
        for cfg_value in (
            config.hosting_config.frontend_domain,
            config.hosting_config.domain,
        ):
            cfg_value = (cfg_value or "").strip().rstrip("/")
            if not cfg_value:
                continue
            # frontend_domain/domain may be a bare host or "host:port" with no
            # scheme (the shipped default is "localhost:3000"). urlparse only
            # populates .hostname when a scheme or leading "//" is present, so
            # prefix "//" for schemeless values; otherwise the port would leak
            # into the host and never match req_host (which is always port-less).
            cfg_parsed = urlparse(cfg_value if "://" in cfg_value else f"//{cfg_value}")
            cfg_host = cfg_parsed.hostname or cfg_value
            cfg_host = cfg_host.removeprefix("www.").lower()
            if cfg_host:
                configured_hosts.add(cfg_host)

        if req_host in configured_hosts:
            return True

        if config.general_config.development_mode and req_host in ("localhost", "127.0.0.1"):
            return True

        return False

    allowed_origins = config.hosting_config.allowed_origins

    # Check against configured allowed origins
    for allowed in allowed_origins:
        if url_stripped == allowed.rstrip("/"):
            return True

    # Check against allowed_regexp if configured
    import re
    allowed_regexp = config.hosting_config.allowed_regexp
    if allowed_regexp:
        try:
            if re.fullmatch(allowed_regexp, url_stripped):
                return True
        except re.error:
            pass

    # Check against LEARNHOUSE_PLATFORM_URL (the main platform, e.g. https://www.learnhouse.app)
    platform_url = os.environ.get("LEARNHOUSE_PLATFORM_URL", "").rstrip("/")
    if platform_url:
        parsed_url = urlparse(url_stripped)
        parsed_platform = urlparse(platform_url)
        # Normalize: strip www. from both hostnames for comparison
        url_host = (parsed_url.hostname or "").removeprefix("www.")
        platform_host = (parsed_platform.hostname or "").removeprefix("www.")
        if url_host and url_host == platform_host and parsed_url.scheme == "https":
            return True

    # In development mode, allow localhost
    if config.general_config.development_mode:
        parsed = urlparse(url_stripped)
        if parsed.hostname in ("localhost", "127.0.0.1"):
            return True

    return False


async def get_org_signup_base_url(
    org_slug: str,
    request: Request,
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
    """
    config = get_learnhouse_config()

    if config.hosting_config.tenancy == "single":
        return get_base_url_from_request(request)

    scheme = "https" if config.hosting_config.ssl else "http"

    if db_session is not None and org_id is not None:
        custom_domain = await _get_primary_verified_custom_domain(db_session, org_id)
        if custom_domain:
            return f"{scheme}://{custom_domain}"

    base_domain = (config.hosting_config.domain or "").strip().rstrip("/")
    if not base_domain or "localhost" in base_domain:
        return get_base_url_from_request(request)

    return f"{scheme}://{org_slug}.{base_domain}"


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


def send_email(to: EmailStr, subject: str, body: str):
    from fastapi import HTTPException

    lh_config = get_learnhouse_config()
    mailing = lh_config.mailing_config
    sender = f"LearnHouse <{mailing.system_email_address}>"

    # Resend (and most providers) require a plain `email@example.com` string.
    # Pydantic's EmailStr is a str subclass, but third-party JSON serializers
    # can mis-handle it — coerce to a stripped plain str and validate shape
    # so a malformed stored email surfaces here rather than as an opaque
    # provider 4xx.
    to_addr = str(to).strip()
    if not to_addr or "@" not in to_addr:
        logger.error("Refusing to send email: invalid recipient %r", to)
        raise HTTPException(status_code=400, detail="Invalid recipient email address")

    if mailing.email_provider == "smtp":
        return _send_email_smtp(sender, to_addr, subject, body, mailing)
    else:
        return _send_email_resend(sender, to_addr, subject, body, mailing)


def _send_email_resend(sender: str, to: str, subject: str, body: str, mailing):
    from fastapi import HTTPException
    resend.api_key = mailing.resend_api_key
    try:
        return resend.Emails.send({
            "from": sender,
            "to": [to],
            "subject": subject,
            "html": body,
        })
    except Exception as e:
        logger.error("Resend email failed to %s: %s", to, e, exc_info=True)
        raise HTTPException(status_code=503, detail="Email service temporarily unavailable")


_SMTP_TIMEOUT = 15


def _send_email_smtp(sender: str, to: str, subject: str, body: str, mailing):
    from fastapi import HTTPException
    msg = MIMEMultipart("alternative")
    msg["From"] = sender
    msg["To"] = to
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "html"))

    server = None
    try:
        if mailing.smtp_use_tls:
            server = smtplib.SMTP(mailing.smtp_host, mailing.smtp_port, timeout=_SMTP_TIMEOUT)
            server.starttls()
        else:
            server = smtplib.SMTP(mailing.smtp_host, mailing.smtp_port, timeout=_SMTP_TIMEOUT)

        if mailing.smtp_username and mailing.smtp_password:
            server.login(mailing.smtp_username, mailing.smtp_password)

        server.sendmail(mailing.system_email_address, to, msg.as_string())
        return {"id": None, "to": to}
    except smtplib.SMTPException as e:
        logger.error("SMTP error sending to %s: %s", to, e, exc_info=True)
        raise HTTPException(status_code=503, detail="Email service error")
    except OSError as e:
        logger.error("SMTP connection error to %s:%s: %s", mailing.smtp_host, mailing.smtp_port, e, exc_info=True)
        raise HTTPException(status_code=503, detail="Email service unavailable")
    finally:
        if server is not None:
            try:
                server.quit()
            except Exception:
                pass

