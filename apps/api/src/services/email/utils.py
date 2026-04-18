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
    allowed_origins = config.hosting_config.allowed_origins

    # Check against configured allowed origins
    url_stripped = url.rstrip("/")
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


def get_org_signup_base_url(
    org_slug: str,
    request: Request,
    db_session=None,
    org_id: Optional[int] = None,
) -> str:
    """
    Return the org-scoped frontend base URL for invitation / signup links.

    When ``db_session`` and ``org_id`` are supplied, prefers the org's verified
    custom domain (primary first). Otherwise falls back to
    ``{slug}.{hosting_config.domain}``. Using the generic subdomain for orgs
    that have a custom domain is cross-origin to any existing session on the
    custom domain, which breaks the client-side org-context fetch in some
    browsers (strict cross-site cookies, ad blockers) and leaves users on an
    error screen.

    Falls back to the request-derived base URL for:
    - Self-hosted single-instance deployments (no subdomain concept).
    - Development mode (``localhost:3000`` doesn't host working subdomains).
    - Misconfigured deployments with no ``hosting_config.domain``.
    """
    config = get_learnhouse_config()

    if (
        config.hosting_config.self_hosted
        or config.general_config.development_mode
    ):
        return get_base_url_from_request(request)

    scheme = "https" if config.hosting_config.ssl else "http"

    if db_session is not None and org_id is not None:
        custom_domain = _get_primary_verified_custom_domain(db_session, org_id)
        if custom_domain:
            return f"{scheme}://{custom_domain}"

    base_domain = (config.hosting_config.domain or "").strip().rstrip("/")
    if not base_domain or "localhost" in base_domain:
        return get_base_url_from_request(request)

    return f"{scheme}://{org_slug}.{base_domain}"


def _get_primary_verified_custom_domain(db_session, org_id: int) -> Optional[str]:
    """Return the org's primary verified custom domain, or any verified one."""
    try:
        from sqlmodel import select
        from src.db.custom_domains import CustomDomain

        primary = db_session.exec(
            select(CustomDomain).where(
                CustomDomain.org_id == org_id,
                CustomDomain.status == "verified",
                CustomDomain.primary == True,  # noqa: E712
            )
        ).first()
        if primary:
            return primary.domain

        any_verified = db_session.exec(
            select(CustomDomain).where(
                CustomDomain.org_id == org_id,
                CustomDomain.status == "verified",
            )
        ).first()
        return any_verified.domain if any_verified else None
    except Exception:
        logger.exception("Failed to look up custom domain for org %s", org_id)
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
    lh_config = get_learnhouse_config()
    mailing = lh_config.mailing_config
    sender = f"LearnHouse <{mailing.system_email_address}>"

    if mailing.email_provider == "smtp":
        return _send_email_smtp(sender, to, subject, body, mailing)
    else:
        return _send_email_resend(sender, to, subject, body, mailing)


def _send_email_resend(sender: str, to: EmailStr, subject: str, body: str, mailing):
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


def _send_email_smtp(sender: str, to: EmailStr, subject: str, body: str, mailing):
    from fastapi import HTTPException
    msg = MIMEMultipart("alternative")
    msg["From"] = sender
    msg["To"] = str(to)
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

        server.sendmail(mailing.system_email_address, str(to), msg.as_string())
        return {"id": None, "to": str(to)}
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

