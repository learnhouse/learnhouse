import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
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
            if re.match(allowed_regexp, url_stripped):
                return True
        except re.error:
            pass

    # In development mode, allow localhost
    if config.general_config.development_mode:
        parsed = urlparse(url_stripped)
        if parsed.hostname in ("localhost", "127.0.0.1"):
            return True

    return False


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
    resend.api_key = mailing.resend_api_key
    return resend.Emails.send({
        "from": sender,
        "to": [to],
        "subject": subject,
        "html": body,
    })


def _send_email_smtp(sender: str, to: EmailStr, subject: str, body: str, mailing):
    msg = MIMEMultipart("alternative")
    msg["From"] = sender
    msg["To"] = str(to)
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "html"))

    if mailing.smtp_use_tls:
        server = smtplib.SMTP(mailing.smtp_host, mailing.smtp_port)
        server.starttls()
    else:
        server = smtplib.SMTP(mailing.smtp_host, mailing.smtp_port)

    if mailing.smtp_username and mailing.smtp_password:
        server.login(mailing.smtp_username, mailing.smtp_password)

    server.sendmail(mailing.system_email_address, str(to), msg.as_string())
    server.quit()

    return {"id": None, "to": str(to)}

