"""Feature flags for the shared demo organization.

Bare environment variables read at the call site, matching how every recent
feature in this codebase is gated (see ``src/services/nudges/runner.py``),
rather than fields on ``config.py``. Operators turn the demo on per
deployment; nothing here reads the database.
"""

import os

# The demo is a product feature, not a SaaS-only one — a self-hosted install
# showing off LearnHouse to its own stakeholders wants it too. So, unlike the
# nudge scheduler, none of this is gated on deployment mode.

DEFAULT_SLUG = "demo"
# Ten minutes: short enough that one visitor's mess is never on screen for the
# next prospect, long enough that a refresh is not landing under someone
# mid-click. A settled demo costs one write per tick, so the interval is a
# product decision rather than a cost one.
DEFAULT_REFRESH_MINUTES = 10

# Domain for the fake students' addresses.
#
# example.com is reserved by RFC 2606 for exactly this purpose and has no MX
# record, so mail to it cannot be delivered even if a code path slips past the
# guard in send_email.
#
# The obvious choice, `.invalid`, does not work: email-validator (behind
# pydantic's EmailStr) rejects it as a special-use name, so every endpoint that
# returns a user through UserRead — the members list, course learners, the
# grading inbox — answered 500 for the demo org. Undeliverable is necessary;
# being a valid address is equally necessary.
DEMO_EMAIL_DOMAIN = "demo.example.com"

# Written to User.signup_method. A greppable sentinel that identifies a fake
# student independently of the DemoEntity registry, so teardown still works if
# the registry is ever inconsistent.
DEMO_SIGNUP_METHOD = "demo"


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _int_flag(name: str, default: int, minimum: int = 1) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw.strip())
    except (TypeError, ValueError):
        return default
    # A zero or negative interval would turn the scheduler into a busy loop
    # that rebuilds the demo continuously.
    return value if value >= minimum else default


def demo_enabled() -> bool:
    return _flag("LEARNHOUSE_DEMO_ENABLED", False)


def demo_slug() -> str:
    raw = (os.environ.get("LEARNHOUSE_DEMO_SLUG") or "").strip().lower()
    return raw or DEFAULT_SLUG


def refresh_minutes() -> int:
    return _int_flag("LEARNHOUSE_DEMO_REFRESH_MINUTES", DEFAULT_REFRESH_MINUTES)


def scheduler_disabled() -> bool:
    """For deployments that would rather drive ``demo-refresh`` from their own cron."""
    return _flag("LEARNHOUSE_DEMO_NO_SCHEDULER", False)


def is_demo_email(email: str | None) -> bool:
    """True for a fake student's address.

    Used by the mail guard, so it is deliberately generous: anything on the
    reserved domain is treated as undeliverable regardless of how it was
    constructed.
    """
    if not email:
        return False
    return email.strip().lower().endswith(f"@{DEMO_EMAIL_DOMAIN}")
