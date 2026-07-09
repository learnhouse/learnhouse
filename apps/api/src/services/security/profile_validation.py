"""
Profile-field validation for user-controlled identity strings.

An attacker planted a phishing URL in their *username*, then used the invite
flow to relay it to hundreds of recipients from a trusted sender. Display
names (username / first_name / last_name) and org names have no legitimate
reason to contain URLs, so we reject them at signup and profile update, and
additionally strip any that slip through before rendering them into emails.

Two entry points:
- ``validate_display_name`` / ``validate_profile_fields`` — hard-reject at
  write time (raises the caller's chosen error).
- ``strip_urls`` / ``sanitize_display_name`` — best-effort scrub at render
  time (defense in depth for values already stored, e.g. via OAuth import).
"""
import re
from typing import Dict, List, Optional

from pydantic import BaseModel

# Control characters (CR/LF/NUL and other C0 controls). Stripped before a value
# is rendered into an email — a newline in a display name that reaches an SMTP
# header is a classic header-injection (Bcc smuggling) primitive.
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")

# URL / link-like patterns. We match generously — the goal is to deny links in
# a display name, not to perfectly parse URLs. Any of these signals a link:
#   - a scheme (http://, https://, ftp://, etc.)
#   - a bare "www." host
#   - any dotted token immediately followed by a path ("evil.dev/x") — this is
#     TLD-agnostic so new/obscure TLDs (.dev .ai .ly .to …) can't slip through
#   - a "word.tld" with a plausible TLD (schemeless, pathless)
#   - explicit "dot"/"punto" obfuscation ("evil dot com")
_URL_PATTERNS = [
    re.compile(r"[a-z][a-z0-9+.-]*://", re.IGNORECASE),
    re.compile(r"\bwww\.", re.IGNORECASE),
    re.compile(r"[a-z0-9-]+\.[a-z]{2,24}/\S", re.IGNORECASE),
    re.compile(r"[a-z0-9-]+\.(?:com|net|org|io|ru|online|site|click|xyz|top|shop|app|link|info|biz|co|me|tv|cc|pro|store|live|dev|ai|ly|to|sh|gg|us|uk|de|fr|es|it|nl|pl|in|cn|jp|br|za|ua|by|kz)\b", re.IGNORECASE),
    # Obfuscated dot forms only — "evil[.]com", "evil(dot)com", "evil dot com".
    # Deliberately NOT a bare "." so ordinary names ("Dr. Strange", "J.R.R.")
    # are not flagged; real "word.tld" is already covered by the list above.
    re.compile(r"[a-z0-9-]+\s*(?:\[\.\]|\(dot\)|\bdot\b|\bpunto\b)\s*[a-z]{2,}", re.IGNORECASE),
]


class ProfileValidationResult(BaseModel):
    """Result of validating one or more profile fields."""
    is_valid: bool
    errors: List[str]
    invalid_fields: List[str]


def contains_url(value: Optional[str]) -> bool:
    """Return True if the value looks like it contains a URL or link."""
    if not value:
        return False
    return any(p.search(value) for p in _URL_PATTERNS)


def validate_display_name(value: Optional[str]) -> bool:
    """Return True if a single display-name value is acceptable (no links)."""
    return not contains_url(value)


def validate_profile_fields(fields: Dict[str, Optional[str]]) -> ProfileValidationResult:
    """Validate a mapping of ``field_name -> value`` (e.g. username,
    first_name, last_name, org name). Fields set to ``None`` are skipped so
    this is safe for partial updates.
    """
    errors: List[str] = []
    invalid_fields: List[str] = []
    for name, value in fields.items():
        if value is None:
            continue
        if contains_url(value):
            invalid_fields.append(name)
            errors.append(f"{name} may not contain a URL or link")
    return ProfileValidationResult(
        is_valid=not errors,
        errors=errors,
        invalid_fields=invalid_fields,
    )


def strip_urls(value: Optional[str]) -> str:
    """Remove URL/link-like substrings and control characters from a value.
    Best-effort scrub used at render time; collapses leftover whitespace."""
    if not value:
        return ""
    cleaned = _CONTROL_CHARS.sub(" ", value)
    for p in _URL_PATTERNS:
        cleaned = p.sub(" ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def sanitize_display_name(value: Optional[str], *, fallback: str = "A LearnHouse user") -> str:
    """Return a link-free display name suitable for rendering into emails.
    Falls back to a neutral label if stripping leaves nothing meaningful."""
    cleaned = strip_urls(value)
    return cleaned if len(cleaned) >= 2 else fallback
