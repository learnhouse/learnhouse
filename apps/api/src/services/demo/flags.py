"""Markers for the shared demo organization's fake students.

The demo itself (seeding, refresh, the entry endpoints) ships with the
Enterprise Edition. Core keeps only what its guards need to recognise demo
data: the reserved mail domain and the signup-method sentinel.
"""

# Domain for the fake students' addresses.
#
# example.com is reserved by RFC 2606 for exactly this purpose and has no MX
# record, so mail to it cannot be delivered even if a code path slips past the
# guard in send_email.
#
# The obvious choice, `.invalid`, does not work: email-validator (behind
# pydantic's EmailStr) rejects it as a special-use name, so every endpoint that
# returns a user through UserRead (the members list, course learners, the
# grading inbox) answered 500 for the demo org. Undeliverable is necessary;
# being a valid address is equally necessary.
DEMO_EMAIL_DOMAIN = "demo.example.com"

# Written to User.signup_method. A greppable sentinel that identifies a fake
# student independently of any registry, so the guards and teardown still work
# if that registry is ever inconsistent.
DEMO_SIGNUP_METHOD = "demo"


def is_demo_email(email: str | None) -> bool:
    """True for a fake student's address.

    Used by the mail guard, so it is deliberately generous: anything on the
    reserved domain is treated as undeliverable regardless of how it was
    constructed.
    """
    if not email:
        return False
    return email.strip().lower().endswith(f"@{DEMO_EMAIL_DOMAIN}")
