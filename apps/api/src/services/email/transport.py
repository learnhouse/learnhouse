"""Delivery of an already rendered email to the configured provider.

This is the bottom of the mail pipeline and nothing but the pipeline calls
it: features build an email with ``src.services.email.pipeline.send_email``,
which renders the shared layout and hands the result here. Resend in
production (``LEARNHOUSE_RESEND_API_KEY``), SMTP for self-hosted installs
(Mailpit locally). Every message carries an HTML part and a plain-text
alternative.
"""

import logging
import smtplib
import ssl
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

import resend
from pydantic import EmailStr

from config.config import get_learnhouse_config
from src.services.email.sender import DEFAULT_SENDER_NAME, format_sender

logger = logging.getLogger(__name__)


def send_message(
    to: EmailStr,
    subject: str,
    body: str,
    headers: Optional[dict[str, str]] = None,
    sender_name: Optional[str] = None,
    text: Optional[str] = None,
):
    """Send one email: ``body`` is the HTML part, ``text`` the plain alternative.

    ``headers`` carries extra SMTP headers through to the provider. Bulk
    lifecycle mail needs ``List-Unsubscribe`` / ``List-Unsubscribe-Post``;
    Gmail and Outlook penalise bulk senders that omit them. Transactional
    callers pass nothing and are unaffected.

    ``sender_name`` is the DISPLAY NAME only: an organization's own name on
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
    from src.services.email.safe_text import header_safe

    # Subjects interpolate org/user names; a line break there is header injection.
    subject = header_safe(subject)

    lh_config = get_learnhouse_config()
    mailing = lh_config.mailing_config
    sender = format_sender(
        sender_name,
        mailing.system_email_address,
        getattr(mailing, "system_email_sender_name", DEFAULT_SENDER_NAME),
    )

    # Resend (and most providers) require a plain `email@example.com` string.
    # Pydantic's EmailStr is a str subclass, but third-party JSON serializers
    # can mis-handle it. Coerce to a stripped plain str and validate shape
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

    # An impersonation's shadow member (role preview) can never receive mail.
    from src.security.impersonation import is_shadow_email

    if is_shadow_email(to_addr):
        logger.info("Dropping email to a impersonation shadow member (subject=%r)", subject)
        return None

    if mailing.email_provider == "smtp":
        return _send_email_smtp(sender, to_addr, subject, body, mailing, headers, text)
    else:
        return _send_email_resend(sender, to_addr, subject, body, mailing, headers, text)


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
    for everyone: an unverified sending domain (invalid_from_address), an empty
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
    text: Optional[str] = None,
):
    from fastapi import HTTPException
    resend.api_key = mailing.resend_api_key
    payload = {
        "from": sender,
        "to": [to],
        "subject": subject,
        "html": body,
    }
    if text:
        payload["text"] = text
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
    text: Optional[str] = None,
):
    from fastapi import HTTPException
    msg = MIMEMultipart("alternative")
    msg["From"] = sender
    msg["To"] = to
    msg["Subject"] = subject
    for header_name, header_value in (headers or {}).items():
        msg[header_name] = header_value
    # Plain part first: RFC 2046 orders alternatives from least to most faithful.
    if text:
        msg.attach(MIMEText(text, "plain"))
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
            "is not trusted or does not match its hostname; fix the relay's "
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

