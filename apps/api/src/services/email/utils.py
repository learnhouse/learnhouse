from pydantic import EmailStr
from fastapi import Request
import resend
from config.config import get_learnhouse_config


def get_base_url_from_request(request: Request) -> str:
    """
    Extract the base URL from a FastAPI request.

    Uses the Origin or Referer header to determine the frontend URL,
    falling back to constructing from request URL if headers aren't present.

    Args:
        request: FastAPI Request object

    Returns:
        Base URL string (e.g., "https://myorg.example.com")
    """
    # Try Origin header first (most reliable for CORS requests)
    origin = request.headers.get("origin")
    if origin:
        return origin.rstrip("/")

    # Try Referer header as fallback
    referer = request.headers.get("referer")
    if referer:
        # Extract scheme and host from referer
        from urllib.parse import urlparse
        parsed = urlparse(referer)
        return f"{parsed.scheme}://{parsed.netloc}"

    # Fall back to constructing from request URL
    # This handles cases where API and frontend share the same domain
    return f"{request.url.scheme}://{request.url.netloc}"


def send_email(to: EmailStr, subject: str, body: str):
    lh_config = get_learnhouse_config()
    params = {
        "from": "LearnHouse <" + lh_config.mailing_config.system_email_address + ">",
        "to": [to],
        "subject": subject,
        "html": body,
    }

    resend.api_key = lh_config.mailing_config.resend_api_key
    email = resend.Emails.send(params)

    return email
        
