"""Render every email template to HTML files, without sending anything.

    cd apps/api && uv run python scripts/preview_emails.py /tmp/email-previews

Each template is rendered twice where it can be white-labeled: once as a
LearnHouse platform email and once branded to a sample organization (logo
wordmark, brand color, "Powered by" line). Open the folder's index.html to
click through them.
"""

import html
import os
import secrets
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# The magic-login module imports the auth stack, which refuses to load without
# a signing key. Nothing is signed or sent here, so a throwaway one will do.
os.environ.setdefault("LEARNHOUSE_AUTH_JWT_SECRET_KEY", secrets.token_urlsafe(32))

from src.db.organizations import OrganizationRead  # noqa: E402
from src.db.users import UserRead  # noqa: E402
from src.services.users import emails  # noqa: E402


USER = UserRead(
    id=1,
    user_uuid="user_preview",
    username="ada",
    first_name="Ada",
    last_name="Lovelace",
    email="ada@example.com",
)
ORG = OrganizationRead(
    id=1,
    org_uuid="org_preview",
    name="Riverbend Academy",
    slug="riverbend",
    email="hello@riverbend.test",
    creation_date="2026-01-01",
    update_date="2026-01-01",
)
BRAND = dict(brand_color="#2563eb", powered_by=True)
BASE = "https://riverbend.learnhouse.io"


def _renders() -> dict[str, callable]:
    from src.services.auth.magic_login import send_magic_login_email

    return {
        "account_creation_platform": lambda: emails.send_account_creation_email(USER, USER.email, cta_url=f"{BASE}/home"),
        "account_creation_org": lambda: emails.send_account_creation_email(
            USER, USER.email, cta_url=BASE, org_name=ORG.name, **BRAND
        ),
        "org_created": lambda: emails.send_org_created_email(USER.email, ORG.name, f"{BASE}/dash"),
        "org_deleted": lambda: emails.send_org_deleted_email(USER.email, ORG.name),
        "account_deleted": lambda: emails.send_account_deleted_email(USER.email, USER.username),
        "email_changed": lambda: emails.send_email_changed_notice(USER.email, "ada@newmail.test", USER.username),
        "password_reset_org": lambda: emails.send_password_reset_email("482915", USER, ORG, USER.email, BASE, **BRAND),
        "password_reset_platform": lambda: emails.send_password_reset_email_platform("482915", USER, USER.email, BASE),
        "invitation": lambda: emails.send_invitation_email(
            USER.email, ORG.name, "grace", f"{BASE}/signup", invite_code="RIVER-2026", **BRAND
        ),
        "org_join": lambda: emails.send_org_join_email(USER.email, USER.username, ORG.name, f"{BASE}/home", **BRAND),
        "drip_unlocked": lambda: emails.send_drip_unlocked_email(
            USER.email, USER.username, ORG.name, "Networking Fundamentals",
            ["How DNS resolves a name", "Caching and TTLs"], f"{BASE}/course/dns", **BRAND,
        ),
        "role_changed": lambda: emails.send_role_changed_email(
            USER.email, USER.username, ORG.name, "Maintainer", cta_url=BASE, **BRAND
        ),
        "email_verification": lambda: emails.send_email_verification_email(
            "tok_preview", USER, ORG, USER.email, BASE, **BRAND
        ),
        "magic_login_platform": lambda: send_magic_login_email(USER, USER.email, BASE, "tok_preview"),
        "nudge": lambda: emails.send_nudge_email(
            "content.course_draft_d3", USER.email, ORG.name, f"{BASE}/dash/courses",
            f"{BASE}/unsubscribe?token=preview", course_name="Intro to DNS", plan_name="pro",
            next_plan="enterprise", track="content", stats=[("lessons", 8), ("learners", 0)], **BRAND,
        ),
        "unread_messages": lambda: emails.send_unread_messages_email(
            USER.email, USER.username, ORG.name,
            [
                {"title": "Grace Hopper", "count": 3, "snippet": "Did you get a chance to look at the resolver lab? I left comments on step 4."},
                {"title": "DNS Study Group", "count": 7, "author": "Linus", "snippet": "Anyone up for a review session before Friday's quiz?"},
                {"title": "Networking Fundamentals", "count": 1, "author": "Prof. Turing", "snippet": "Chapter 3 is open. Read it before Thursday's live session."},
                {"title": "Socratic Tutor", "count": 1, "emoji": "🦉", "color": "#7c3aed", "snippet": "Good question. Before I answer: what do you think a TTL of 0 would do?"},
            ],
            f"{BASE}/messages", f"{BASE}/messages?settings=notifications", **BRAND,
        ),
    }


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    captured: dict = {}

    def fake_send(**kwargs):
        captured.clear()
        captured.update(kwargs)
        return True

    links = []
    with patch("src.services.users.emails.send_email", side_effect=fake_send), \
            patch("src.services.auth.magic_login.send_email", side_effect=fake_send, create=True):
        for name, render in _renders().items():
            render()
            (out / f"{name}.html").write_text(captured["body"], encoding="utf-8")
            links.append(f'<li><a href="{name}.html">{name}</a> <small>{html.escape(captured["subject"])}</small></li>')
            print(f"{name}: {captured['subject']}")

    (out / "index.html").write_text(
        "<!doctype html><meta charset=utf-8><title>Email previews</title>"
        "<body style='font-family:system-ui;padding:24px'><h1>Email previews</h1><ul>"
        + "".join(links) + "</ul></body>",
        encoding="utf-8",
    )
    print(f"\nWrote {len(links)} previews to {out}/index.html")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "email-previews")
