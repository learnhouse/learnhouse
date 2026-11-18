"""Learning and conversation mail: unlocked chapters, comment mentions,
lifecycle nudges to org admins, the notification digest, unread messages."""

from __future__ import annotations

from src.services.email.blocks import (
    Button,
    Heading,
    Items,
    LinkFallback,
    Paragraph,
    Quote,
    Row,
    Stat,
    Stats,
    compact,
)
from src.services.email.layout import Brand, Email, first_sentence
from src.services.email.registry import Sample, email_template
from src.services.email.safe_text import email_org_name, email_user_name
from src.services.email.templates import SAMPLE_ORG
from src.services.email.translations import t, th, tt


STAT_ICONS = {"courses": "book-open", "chapters": "book-open", "lessons": "book-open",
              "members": "users", "learners": "users", "completed": "check-circle"}


def _initial(text: str) -> str:
    return next((c for c in text if c.isalnum()), "#").upper()


def reply_to_address() -> str:
    """Where a reply to lifecycle mail should land, or "" when unconfigured."""
    try:
        from config.config import get_learnhouse_config

        return (get_learnhouse_config().contact_email or "").strip()
    except Exception:  # pragma: no cover - config is always present in practice
        return ""


@email_template(
    "learning.drip_unlocked",
    category="learning",
    samples=(
        Sample({"username": "ada", "course": "Data Science 101", "chapters": ["Regression", "Classification"],
                "cta_url": "https://northwind.learnhouse.app/course/ds101"}, org=SAMPLE_ORG),
    ),
)
def drip_unlocked(v: dict, lang: str, brand: Brand) -> Email:
    """Scheduled chapters of a course just opened for an enrolled learner."""
    course = email_org_name(v["course"])
    chapters = [email_org_name(c) for c in v["chapters"]]
    first = chapters[0]
    return Email(
        subject=tt(lang, "drip_unlocked.subject", course=course, chapter=first),
        blocks=compact([
            Heading(th(lang, "drip_unlocked.heading", chapter=first)),
            Paragraph(th(lang, "drip_unlocked.body", username=email_user_name(v.get("username")), course=course)),
            Paragraph(th(lang, "drip_unlocked.more", chapters=", ".join(chapters[1:]))) if len(chapters) > 1 else None,
            Button(t(lang, "drip_unlocked.cta"), v["cta_url"]),
            LinkFallback(v["cta_url"]),
        ]),
        reason=th(lang, "drip_unlocked.footer", course=course, org_name=brand.name),
    )


# The comment is quoted; long ones are cut, the link has the rest.
EXCERPT_MAX = 600


@email_template(
    "learning.comment_mention",
    category="community",
    samples=(
        Sample({"username": "ada", "author": "Grace Hopper", "activity": "Linear regression", "course": "Data Science 101",
                "quote": "the slope is the expected change", "body": "@ada can you double check this formula?",
                "cta_url": "https://northwind.learnhouse.app/editor/course/1/activity/2"}, org=SAMPLE_ORG),
    ),
)
def comment_mention(v: dict, lang: str, brand: Brand) -> Email:
    """Someone mentioned the reader in an editor comment."""
    author = email_user_name(v.get("author"))
    activity = email_org_name(v["activity"])
    course = email_org_name(v["course"])
    body = v.get("body") or ""
    excerpt = body if len(body) <= EXCERPT_MAX else body[:EXCERPT_MAX].rstrip() + "…"
    return Email(
        subject=tt(lang, "comment_mention.subject", author=author, activity=activity),
        blocks=compact([
            Heading(th(lang, "comment_mention.heading", author=author)),
            Paragraph(th(lang, "comment_mention.body", username=email_user_name(v.get("username")), author=author,
                         activity=activity, course=course)),
            Paragraph(f"“{v['quote']}”", muted=True) if v.get("quote") else None,
            Quote(excerpt, author),
            Button(t(lang, "comment_mention.cta"), v["cta_url"]),
            LinkFallback(v["cta_url"]),
        ]),
        reason=th(lang, "comment_mention.footer", course=course, org_name=brand.name),
    )


@email_template(
    "learning.nudge",
    category="learning",
    samples=(
        Sample({"nudge_id": "activation.first_course_d1", "track": "activation", "cta_url": "https://northwind.learnhouse.app/dash/courses",
                "unsubscribe_url": "https://api.learnhouse.app/api/v1/emails/unsubscribe?token=sample",
                "stats": [("courses", 0), ("members", 3)], "copy": {"org_name": "Northwind Academy"}}, org=SAMPLE_ORG),
    ),
)
def nudge(v: dict, lang: str, brand: Brand) -> Email:
    """A lifecycle nudge to an org admin; copy from ``nudge.<id>.*``.

    Bulk mail: always an unsubscribe link with one-click headers, and a
    Reply-To because several nudges invite a reply.
    """
    nudge_id = v["nudge_id"]
    copy = {k: str(val) for k, val in (v.get("copy") or {}).items() if val is not None}
    copy.setdefault("org_name", brand.name)
    cta_url = v.get("cta_url")
    return Email(
        subject=tt(lang, f"nudge.{nudge_id}.subject", **copy),
        preheader=first_sentence(tt(lang, f"nudge.{nudge_id}.body", **copy)),
        blocks=compact([
            Heading(th(lang, f"nudge.{nudge_id}.heading", **copy)),
            Paragraph(th(lang, f"nudge.{nudge_id}.body", **copy)),
            Stats([Stat(t(lang, f"nudge.stat.{key}"), value, STAT_ICONS.get(key, "chart-bar"), "emerald")
                   for key, value in (v.get("stats") or [])]) if v.get("stats") else None,
            Button(th(lang, f"nudge.{nudge_id}.cta", **copy), cta_url) if v.get("has_cta", True) and cta_url else None,
            LinkFallback(cta_url) if v.get("has_cta", True) and cta_url else None,
        ]),
        icon="rocket-launch",
        tone="emerald",
        reason=th(lang, "nudge.common.footer", org_name=brand.name),
        unsubscribe_url=v.get("unsubscribe_url") or "",
        unsubscribe_label=t(lang, "nudge.common.unsubscribe"),
        one_click_unsubscribe=True,
        reply_to=reply_to_address(),
    )


def _digest_copy(lang: str, key: str, **fmt) -> str:
    from src.services.notifications.digest import copy

    return copy(lang, key, **fmt)


@email_template(
    "notifications.digest",
    category="community",
    samples=(
        Sample({"base_url": "https://northwind.learnhouse.app", "items": [
            {"title": "New assignment submitted", "body": "Ada submitted Week 3: Regression", "path": "/dash/assignments/3"},
            {"title": "Grace replied to your discussion", "body": "Great question, I think the answer is…", "path": "/notifications"},
            {"title": "Course published", "body": "", "path": None},
        ]}, org=SAMPLE_ORG),
    ),
)
def digest(v: dict, lang: str, brand: Brand) -> Email:
    """Daily / weekly digest of unread important notifications."""
    base = (v.get("base_url") or "").rstrip("/")
    items = v.get("items") or []
    rows = [
        Row(title=i.get("title") or "", body=(i.get("body") or "")[:180],
            url=base + (i.get("path") or "/notifications"), avatar=_initial(i.get("title") or ""))
        for i in items
    ]
    org = brand.name if brand.org_scoped and brand.name else "LearnHouse"
    return Email(
        subject=_digest_copy(lang, "subject", count=len(items)),
        blocks=[
            Heading(_digest_copy(lang, "heading")),
            Paragraph(_digest_copy(lang, "intro", org=org)),
            Items(rows),
            Button(_digest_copy(lang, "cta"), base + "/notifications"),
        ],
        icon="bell",
        reason=_digest_copy(lang, "footer"),
    )


UNREAD_LIST_LIMIT = 6


@email_template(
    "messages.unread",
    category="community",
    samples=(
        Sample({"username": "ada", "cta_url": "https://northwind.learnhouse.app/messages",
                "settings_url": "https://northwind.learnhouse.app/messages?settings=notifications",
                "conversations": [
                    {"title": "Cohort 12", "count": 4, "author": "Grace", "snippet": "Slides for tomorrow are up!"},
                    {"title": "Study buddy", "count": 1, "emoji": "🤖", "color": "#7c3aed", "snippet": "Ready for your quiz?"},
                    {"title": "Alan Turing", "count": 2, "snippet": "Thanks for the feedback on my essay"},
                ]}, org=SAMPLE_ORG),
    ),
)
def unread(v: dict, lang: str, brand: Brand) -> Email:
    """Messages left unread for a while, one email for every conversation."""
    conversations = v.get("conversations") or []
    total = sum(max(int(c.get("count") or 0), 0) for c in conversations)
    noun = "message" if total == 1 else "messages"
    shown = conversations[:UNREAD_LIST_LIMIT]
    rows = []
    for conv in shown:
        snippet = " ".join((conv.get("snippet") or "").split())
        if len(snippet) > 110:
            snippet = snippet[:110].rsplit(" ", 1)[0] + "…"
        author = (conv.get("author") or "").strip()
        title = email_org_name(conv.get("title") or "Conversation")
        count = max(int(conv.get("count") or 0), 0)
        rows.append(Row(
            title=title,
            body=f"{email_user_name(author)}: {snippet}" if author else snippet,
            meta=f"{count if count < 100 else '99+'} new" if count else "",
            avatar=conv["image"] if (conv.get("image") or "").startswith(("https://", "http://")) else _initial(title),
        ))
    more = len(conversations) - len(shown)
    first = conversations[0] if conversations else {}
    preheader = " ".join(p for p in (
        f"{email_user_name(first.get('author'))}:" if first.get("author") else "", first.get("snippet") or "",
    ) if p)
    return Email(
        subject=f"{total} unread {noun} in {brand.name}",
        preheader=preheader[:120],
        blocks=[
            Heading(f"{total} unread {noun}"),
            Paragraph(f"Hi {email_user_name(v.get('username'))}, here's what's waiting for you in {brand.name}."),
            Items(rows, more=f"And {more} more conversation{'s' if more > 1 else ''}." if more > 0 else ""),
            Button("Open messages", v["cta_url"]),
        ],
        reason="You get this email when messages sit unread for a while.",
        manage_url=v.get("settings_url") or "",
        manage_label="Change message email settings",
    )
