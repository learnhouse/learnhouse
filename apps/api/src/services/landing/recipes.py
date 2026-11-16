"""Section recipes, style presets and page templates.

A recipe turns a short content spec ("a hero with this heading, these two
buttons, split layout") into a full, well-styled node tree. Templates,
Atlas tools, AI generation and the builder's section library all use the same
recipes, so a page built by any of them looks like it was designed by one
hand and always validates.
"""

from __future__ import annotations

import copy
import secrets
import string
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from src.services.landing.schema import ICONS, IconName, Theme, empty_doc, theme_dump

_ALPHABET = string.ascii_lowercase + string.digits


def new_id(prefix: str = "n") -> str:
    return f"{prefix}_{''.join(secrets.choice(_ALPHABET) for _ in range(8))}"


def reid(node: dict) -> dict:
    """A deep copy of ``node`` with fresh ids (duplicate, paste, template)."""
    node = copy.deepcopy(node)

    def visit(n: dict) -> None:
        n["id"] = new_id()
        for c in n.get("children") or []:
            visit(c)

    visit(node)
    return node


def el(type_: str, props: Optional[dict] = None, style: Optional[dict] = None, children: Optional[list] = None, **extra) -> dict:
    node: dict[str, Any] = {"id": new_id(), "type": type_, "props": props or {}}
    if style:
        node["style"] = style
    if children is not None:
        node["children"] = children
    node.update({k: v for k, v in extra.items() if v is not None})
    return node


# ─── content spec ─────────────────────────────────────────────────────────────

Background = Literal["default", "surface", "primary", "dark", "image", "gradient"]
SectionKind = Literal[
    "hero", "features", "courses", "featured_course", "paths", "communities", "podcasts", "live_sessions",
    "instructors", "testimonials", "pricing", "faq", "stats", "logos", "steps", "cta", "text_image",
    "gallery", "video", "newsletter", "contact", "rich_text", "navbar", "footer", "countdown",
]
SECTION_KINDS: tuple[str, ...] = SectionKind.__args__  # type: ignore[attr-defined]


class SpecButton(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(..., max_length=120)
    href: str = Field("/courses", max_length=500)


class SpecItem(BaseModel):
    """One repeated item; which fields matter depends on the section kind."""

    model_config = ConfigDict(extra="forbid")
    title: str = Field("", max_length=200)
    text: str = Field("", max_length=1500)
    icon: Optional[IconName] = None
    value: str = Field("", max_length=40)
    label: str = Field("", max_length=120)
    quote: str = Field("", max_length=1500)
    author: str = Field("", max_length=120)
    role: str = Field("", max_length=120)
    image: str = Field("", max_length=1000)
    question: str = Field("", max_length=500)
    answer: str = Field("", max_length=3000)
    name: str = Field("", max_length=120)
    price: str = Field("", max_length=40)
    period: str = Field("", max_length=40)
    features: list[str] = Field(default_factory=list, max_length=20)
    highlighted: bool = False
    href: str = Field("", max_length=500)


class SectionSpec(BaseModel):
    """A section described by its content. Unset fields get sensible copy."""

    model_config = ConfigDict(extra="forbid")
    kind: SectionKind
    variant: str = Field("", max_length=40, description="Layout variant, e.g. hero: centered|split|image.")
    eyebrow: str = Field("", max_length=120)
    heading: str = Field("", max_length=300)
    subheading: str = Field("", max_length=1000)
    text: str = Field("", max_length=5000, description="Body text; markdown for rich_text.")
    buttons: list[SpecButton] = Field(default_factory=list, max_length=3)
    items: list[SpecItem] = Field(default_factory=list, max_length=24)
    image: str = Field("", max_length=1000, description="Image URL (uploaded or https).")
    video: str = Field("", max_length=1000)
    background: Background = "default"
    columns: int = Field(0, ge=0, le=6)
    limit: int = Field(0, ge=0, le=24)
    course_uuids: list[str] = Field(default_factory=list, max_length=24)
    anchor: str = Field("", max_length=64)


# ─── shared styles ────────────────────────────────────────────────────────────

PAD = {"base": {"paddingTop": 96, "paddingBottom": 96, "paddingLeft": 24, "paddingRight": 24}, "mobile": {"paddingTop": 56, "paddingBottom": 56, "paddingLeft": 16, "paddingRight": 16}}


def _bg(background: str, image: str = "") -> dict:
    if background == "surface":
        return {"backgroundColor": "$surface"}
    if background == "primary":
        return {"backgroundColor": "$primary", "color": "$on-primary"}
    if background == "dark":
        return {"backgroundColor": "#0b1120", "color": "#f8fafc"}
    if background == "gradient":
        return {"backgroundGradient": {"from": "$primary", "to": "$secondary", "angle": 135}, "color": "#ffffff"}
    if background == "image" and image:
        return {
            "backgroundImage": image, "backgroundSize": "cover", "backgroundPosition": "center",
            "overlayColor": "#000000", "overlayOpacity": 55, "color": "#ffffff",
        }
    return {}


def section(children: list, *, name: str, background: str = "default", image: str = "", anchor: str = "", pad: Optional[dict] = None, tag: str = "section", extra: Optional[dict] = None) -> dict:
    base = {**(pad or PAD)["base"], **_bg(background, image), **(extra or {})}
    style = {"base": base, "mobile": (pad or PAD).get("mobile", {})}
    inner = el("container", {}, {"base": {"maxWidth": "content", "marginLeft": "auto", "marginRight": "auto", "width": "100%", "display": "flex", "flexDirection": "column", "gap": 40}, "mobile": {"gap": 28}}, children)
    return el("section", {"tag": tag}, style, [inner], name=name, anchor=anchor or None)


def heading_block(eyebrow: str, heading: str, sub: str, *, align: str = "center", level: int = 2, size: Any = "2.5rem", invert: bool = False) -> dict:
    kids = []
    if eyebrow:
        kids.append(el("text", {"text": eyebrow}, {"base": {"fontSize": 13, "fontWeight": "600", "letterSpacing": "0.08em", "textTransform": "uppercase", "color": "$primary" if not invert else None, "opacity": 0.9 if invert else None, "textAlign": align}}))
    if heading:
        kids.append(el("heading", {"text": heading, "level": level}, {"base": {"fontSize": size, "lineHeight": 1.15, "textAlign": align, "fontFamily": "heading"}, "mobile": {"fontSize": "1.875rem"}}))
    if sub:
        kids.append(el("text", {"text": sub}, {"base": {"fontSize": "1.125rem", "lineHeight": 1.6, "textAlign": align, "opacity": 0.75, "maxWidth": "680px", **({"marginLeft": "auto", "marginRight": "auto"} if align == "center" else {})}, "mobile": {"fontSize": "1rem"}}))
    for k in kids:
        _clean(k)
    return el("container", {}, {"base": {"display": "flex", "flexDirection": "column", "gap": 12}}, kids)


def buttons_row(buttons: list[dict], *, align: str = "center", invert: bool = False) -> dict:
    kids = []
    for i, b in enumerate(buttons[:3]):
        # On a dark, brand or image background the main button is light (a
        # brand-colored button could disappear into a brand-colored section).
        variant = ("secondary" if invert else "primary") if i == 0 else "outline"
        kids.append(el("button", {"label": b.get("label", ""), "href": b.get("href", ""), "variant": variant, "size": "lg", **({"icon": "ArrowRight"} if i == 0 else {})}))
    justify = {"center": "center", "start": "flex-start", "end": "flex-end"}[align]
    return el("container", {}, {"base": {"display": "flex", "flexWrap": "wrap", "gap": 12, "justifyContent": justify}, "mobile": {"flexDirection": "column", "alignItems": "stretch"}}, kids)


def _clean(node: dict) -> dict:
    """Drop None values a recipe left in styles."""
    style = node.get("style")
    if style:
        for bp in list(style):
            style[bp] = {k: v for k, v in style[bp].items() if v is not None}
            if not style[bp]:
                del style[bp]
        if not style:
            del node["style"]
    for c in node.get("children") or []:
        _clean(c)
    return node


def _btns(spec: SectionSpec, default: list[dict]) -> list[dict]:
    return [b.model_dump() for b in spec.buttons] if spec.buttons else default


# ─── recipes ──────────────────────────────────────────────────────────────────


def _hero(s: SectionSpec, ctx: dict) -> dict:
    heading = s.heading or f"Learn with {ctx.get('org_name') or 'us'}"
    about = (ctx.get("org_description") or "").strip()
    # A description that only repeats the name (or a few words) makes a poor subheading.
    if len(about) < 24 or about.lower() == (ctx.get("org_name") or "").strip().lower():
        about = ""
    sub = s.subheading or about or "Practical courses taught by people who do the work. Start today and learn at your own pace."
    btns = _btns(s, [{"label": "Browse courses", "href": "/courses"}, {"label": "Create an account", "href": "/signup"}])
    variant = s.variant or ("image" if s.background == "image" and s.image else "split" if s.image else "centered")
    if variant == "split":
        text = el("container", {}, {"base": {"display": "flex", "flexDirection": "column", "gap": 28, "justifyContent": "center"}}, [
            heading_block(s.eyebrow, heading, sub, align="start", level=1, size="3.5rem"),
            buttons_row(btns, align="start"),
        ])
        media = el("image", {"src": s.image or "", "alt": heading}, {"base": {"borderRadius": 24, "aspectRatio": "4/3", "objectFit": "cover", "width": "100%", "boxShadow": "xl"}})
        cols = el("columns", {"ratio": "equal", "stackAt": "tablet"}, {"base": {"gap": 56, "alignItems": "center"}, "tablet": {"gap": 36}}, [text, el("container", {}, None, [media])])
        return section([cols], name="Hero", background=s.background, image=s.image, anchor=s.anchor,
                       pad={"base": {"paddingTop": 112, "paddingBottom": 112, "paddingLeft": 24, "paddingRight": 24}, "mobile": {"paddingTop": 56, "paddingBottom": 56, "paddingLeft": 16, "paddingRight": 16}})
    bg = "image" if variant == "image" and s.image else s.background
    if variant == "compact":
        # A short welcome above the content (the default home page).
        return section([heading_block(s.eyebrow, heading, sub, align="center", level=1, size="2.75rem", invert=bg in ("dark", "primary", "gradient")),
                        buttons_row(btns, invert=bg in ("dark", "primary", "gradient"))],
                       name="Hero", background=bg, image="", anchor=s.anchor,
                       pad={"base": {"paddingTop": 72, "paddingBottom": 24, "paddingLeft": 24, "paddingRight": 24}, "mobile": {"paddingTop": 48, "paddingBottom": 16, "paddingLeft": 16, "paddingRight": 16}})
    kids = [heading_block(s.eyebrow, heading, sub, align="center", level=1, size="4rem", invert=bg in ("image", "dark", "primary", "gradient")), buttons_row(btns, invert=bg in ("image", "dark", "primary", "gradient"))]
    if variant == "centered" and s.image:
        kids.append(el("image", {"src": s.image, "alt": heading}, {"base": {"borderRadius": 24, "width": "100%", "aspectRatio": "16/9", "objectFit": "cover", "boxShadow": "xl", "marginTop": 24}}))
    return section(kids, name="Hero", background=bg, image=s.image, anchor=s.anchor,
                   pad={"base": {"paddingTop": 140, "paddingBottom": 140, "paddingLeft": 24, "paddingRight": 24, **({"minHeight": "80vh", "display": "flex", "alignItems": "center"} if bg == "image" else {})}, "mobile": {"paddingTop": 72, "paddingBottom": 72, "paddingLeft": 16, "paddingRight": 16}})


def _items(s: SectionSpec, default: list[dict]) -> list[dict]:
    if s.items:
        return [i.model_dump() for i in s.items]
    return default


def _features(s: SectionSpec, ctx: dict) -> dict:
    items = _items(s, [
        {"icon": "Lightning", "title": "Learn by doing", "text": "Short lessons with hands-on exercises you can apply the same day."},
        {"icon": "Certificate", "title": "Earn certificates", "text": "Finish a course and get a certificate you can share."},
        {"icon": "ChatsCircle", "title": "Get answers", "text": "Ask questions and learn alongside a community of peers."},
    ])
    feats = [{"icon": i.get("icon") or ICONS[(n * 7) % 20], "title": i.get("title", ""), "text": i.get("text", "")} for n, i in enumerate(items)]
    layout = s.variant if s.variant in ("cards", "plain", "list") else "cards"
    return section([
        heading_block(s.eyebrow, s.heading or "Why learn here", s.subheading),
        el("features", {"items": feats, "columns": s.columns or min(3, max(1, len(feats))), "layout": layout}),
    ], name="Features", background=s.background, image=s.image, anchor=s.anchor)


def _courses(s: SectionSpec, ctx: dict) -> dict:
    props: dict[str, Any] = {
        "source": "selected" if s.course_uuids else "latest", "limit": s.limit or 6, "columns": s.columns or 3,
        "layout": s.variant if s.variant in ("grid", "carousel", "list") else "grid",
        # Visitors only see public courses: say why the grid can be empty.
        "emptyText": s.text or "No courses to show yet. Members may see more after signing in.",
    }
    if s.course_uuids:
        props["courseUuids"] = s.course_uuids
    kids = [heading_block(s.eyebrow, s.heading or "Popular courses", s.subheading, align="start"), el("courses", props)]
    if s.buttons:
        kids.append(buttons_row(_btns(s, []), align="start"))
    return section(kids, name="Courses", background=s.background, image=s.image, anchor=s.anchor or "courses")


def _featured_course(s: SectionSpec, ctx: dict) -> dict:
    uuid = (s.course_uuids or ctx.get("course_uuids") or [""])[0]
    return section([
        heading_block(s.eyebrow or "Featured course", s.heading, s.subheading, align="start"),
        el("course", {"courseUuid": uuid, "layout": "split", "buttonLabel": (s.buttons[0].label if s.buttons else "Start learning")}),
    ], name="Featured course", background=s.background or "surface", image=s.image, anchor=s.anchor)


def _collection(kind: str, title: str):
    def build(s: SectionSpec, ctx: dict) -> dict:
        props: dict[str, Any] = {"limit": s.limit or (3 if kind == "paths" else 6), "columns": s.columns or 3}
        if kind == "live_sessions":
            props = {"limit": s.limit or 4, "layout": "list"}
        return section([heading_block(s.eyebrow, s.heading or title, s.subheading, align="start"), el(kind, props)],
                       name=title, background=s.background, image=s.image, anchor=s.anchor)
    return build


def _instructors(s: SectionSpec, ctx: dict) -> dict:
    people = [{"name": i.get("name") or i.get("title", ""), "role": i.get("role", ""), "bio": i.get("text", ""), "image": i.get("image", "")} for i in _items(s, [
        {"name": "Alex Morgan", "role": "Lead instructor", "text": "Ten years of teaching and building in the field."},
        {"name": "Sam Rivera", "role": "Instructor", "text": "Makes hard topics simple, one example at a time."},
        {"name": "Jordan Lee", "role": "Mentor", "text": "Helps learners turn lessons into real projects."},
    ])]
    return section([heading_block(s.eyebrow, s.heading or "Meet your instructors", s.subheading), el("instructors", {"people": people, "columns": s.columns or min(4, max(1, len(people)))})],
                   name="Instructors", background=s.background, image=s.image, anchor=s.anchor)


def _testimonials(s: SectionSpec, ctx: dict) -> dict:
    items = [{"quote": i.get("quote") or i.get("text", ""), "author": i.get("author") or i.get("name", ""), "role": i.get("role", ""), "image": i.get("image", ""), "rating": 5} for i in _items(s, [
        {"quote": "The lessons are short and practical. I used what I learned at work the same week.", "author": "Priya S.", "role": "Product designer"},
        {"quote": "Clear explanations, great exercises, and a community that actually answers.", "author": "Marco D.", "role": "Developer"},
        {"quote": "I finally finished a course. The pacing makes it easy to keep going.", "author": "Lena K.", "role": "Marketing lead"},
    ])]
    layout = s.variant if s.variant in ("grid", "carousel", "single") else "grid"
    return section([heading_block(s.eyebrow, s.heading or "What learners say", s.subheading), el("testimonials", {"items": items, "layout": layout, "columns": s.columns or 3})],
                   name="Testimonials", background=s.background or "surface", image=s.image, anchor=s.anchor)


def _pricing(s: SectionSpec, ctx: dict) -> dict:
    plans = []
    for i in _items(s, [
        {"name": "Free", "price": "$0", "period": "", "text": "Start with our free lessons.", "features": ["Free courses", "Community access"]},
        {"name": "Pro", "price": "$19", "period": "/ month", "text": "Everything, for serious learners.", "features": ["All courses", "Certificates", "Live sessions"], "highlighted": True},
        {"name": "Teams", "price": "$49", "period": "/ month", "text": "Train your whole team.", "features": ["Everything in Pro", "Team dashboard", "Priority support"]},
    ]):
        plans.append({
            "name": i.get("name") or i.get("title", ""), "price": i.get("price", ""), "period": i.get("period", ""),
            "description": i.get("text", ""), "features": i.get("features") or [], "highlighted": bool(i.get("highlighted")),
            "badge": "Most popular" if i.get("highlighted") else "",
            "button": {"label": "Get started", "href": i.get("href") or "/signup"},
        })
    return section([heading_block(s.eyebrow, s.heading or "Simple pricing", s.subheading), el("pricing", {"plans": plans, "columns": s.columns or min(3, max(1, len(plans)))})],
                   name="Pricing", background=s.background, image=s.image, anchor=s.anchor or "pricing")


def _faq(s: SectionSpec, ctx: dict) -> dict:
    items = [{"question": i.get("question") or i.get("title", ""), "answer": i.get("answer") or i.get("text", "")} for i in _items(s, [
        {"question": "How long do I have access?", "answer": "As long as your account is active. Learn at your own pace."},
        {"question": "Do I get a certificate?", "answer": "Yes: finish a course to receive a certificate you can share."},
        {"question": "Can I learn on my phone?", "answer": "Every course works on phones, tablets and computers."},
    ])]
    return section([heading_block(s.eyebrow, s.heading or "Frequently asked questions", s.subheading),
                    el("faq", {"items": items, "layout": "accordion"}, {"base": {"maxWidth": "760px", "marginLeft": "auto", "marginRight": "auto", "width": "100%"}})],
                   name="FAQ", background=s.background, image=s.image, anchor=s.anchor or "faq")


def _stats(s: SectionSpec, ctx: dict) -> dict:
    items = [{"value": i.get("value") or i.get("title", ""), "label": i.get("label") or i.get("text", "")} for i in _items(s, [
        {"value": "12k+", "label": "Learners"}, {"value": "40+", "label": "Courses"}, {"value": "4.9", "label": "Average rating"}, {"value": "92%", "label": "Completion"},
    ])]
    kids = []
    if s.heading or s.eyebrow:
        kids.append(heading_block(s.eyebrow, s.heading, s.subheading))
    kids.append(el("stats", {"items": items, "layout": "row"}))
    return section(kids, name="Stats", background=s.background, image=s.image, anchor=s.anchor,
                   pad={"base": {"paddingTop": 64, "paddingBottom": 64, "paddingLeft": 24, "paddingRight": 24}, "mobile": {"paddingTop": 40, "paddingBottom": 40, "paddingLeft": 16, "paddingRight": 16}})


def _logos(s: SectionSpec, ctx: dict) -> dict:
    items = [{"src": i.get("image", ""), "alt": i.get("title") or i.get("name", ""), "href": i.get("href", "")} for i in _items(s, [])]
    return section([heading_block("", s.heading or "Trusted by teams at", "", level=3, size="1rem"), el("logos", {"items": items, "grayscale": True})],
                   name="Logos", background=s.background, image=s.image, anchor=s.anchor,
                   pad={"base": {"paddingTop": 48, "paddingBottom": 48, "paddingLeft": 24, "paddingRight": 24}, "mobile": {"paddingTop": 32, "paddingBottom": 32, "paddingLeft": 16, "paddingRight": 16}})


def _steps(s: SectionSpec, ctx: dict) -> dict:
    items = [{"title": i.get("title", ""), "text": i.get("text", "")} for i in _items(s, [
        {"title": "Pick a course", "text": "Browse the catalog and choose what fits your goals."},
        {"title": "Learn at your pace", "text": "Short lessons, quizzes and projects, on any device."},
        {"title": "Show your skills", "text": "Earn a certificate and put it to work."},
    ])]
    return section([heading_block(s.eyebrow, s.heading or "How it works", s.subheading), el("steps", {"items": items, "layout": "horizontal"})],
                   name="Steps", background=s.background, image=s.image, anchor=s.anchor)


def _cta(s: SectionSpec, ctx: dict) -> dict:
    bg = s.background if s.background != "default" else "primary"
    card = el("container", {}, {"base": {**_bg(bg, s.image), "borderRadius": 28, "paddingTop": 72, "paddingBottom": 72, "paddingLeft": 40, "paddingRight": 40, "display": "flex", "flexDirection": "column", "gap": 28, "alignItems": "center"}, "mobile": {"paddingTop": 48, "paddingBottom": 48, "paddingLeft": 20, "paddingRight": 20}}, [
        heading_block("", s.heading or "Ready to start learning?", s.subheading or "Join today and get access to your first course in minutes.", invert=True),
        buttons_row(_btns(s, [{"label": "Get started", "href": "/signup"}]), invert=True),
    ])
    return section([card], name="Call to action", anchor=s.anchor,
                   pad={"base": {"paddingTop": 64, "paddingBottom": 64, "paddingLeft": 24, "paddingRight": 24}, "mobile": {"paddingTop": 32, "paddingBottom": 32, "paddingLeft": 16, "paddingRight": 16}})


def _text_image(s: SectionSpec, ctx: dict) -> dict:
    text_kids = [heading_block(s.eyebrow, s.heading or "Built for real progress", s.subheading, align="start")]
    if s.text:
        text_kids.append(el("richtext", {"markdown": s.text}, {"base": {"fontSize": "1.0625rem", "lineHeight": 1.7, "opacity": 0.85}}))
    if s.items:
        text_kids.append(el("list", {"items": [i.title or i.text for i in s.items], "marker": "check"}))
    if s.buttons:
        text_kids.append(buttons_row(_btns(s, []), align="start"))
    text = el("container", {}, {"base": {"display": "flex", "flexDirection": "column", "gap": 20, "justifyContent": "center"}}, text_kids)
    media = el("container", {}, None, [el("image", {"src": s.image or "", "alt": s.heading}, {"base": {"borderRadius": 20, "aspectRatio": "4/3", "objectFit": "cover", "width": "100%", "boxShadow": "lg"}})])
    kids = [media, text] if s.variant == "image-left" else [text, media]
    return section([el("columns", {"ratio": "equal", "stackAt": "tablet"}, {"base": {"gap": 64, "alignItems": "center"}, "tablet": {"gap": 32}}, kids)],
                   name="Text and image", background=s.background, image="", anchor=s.anchor)


def _gallery(s: SectionSpec, ctx: dict) -> dict:
    images = [{"src": i.image, "alt": i.title} for i in s.items if i.image]
    return section([heading_block(s.eyebrow, s.heading, s.subheading), el("gallery", {"images": images, "columns": s.columns or 3})],
                   name="Gallery", background=s.background, image=s.image, anchor=s.anchor)


def _video(s: SectionSpec, ctx: dict) -> dict:
    return section([heading_block(s.eyebrow, s.heading or "See it in action", s.subheading),
                    el("video", {"url": s.video or ""}, {"base": {"borderRadius": 20, "overflow": "hidden", "boxShadow": "xl", "maxWidth": "960px", "marginLeft": "auto", "marginRight": "auto", "width": "100%"}})],
                   name="Video", background=s.background, image=s.image, anchor=s.anchor)


def _newsletter(s: SectionSpec, ctx: dict) -> dict:
    card = el("container", {}, {"base": {"backgroundColor": "$surface", "borderRadius": 24, "paddingTop": 48, "paddingBottom": 48, "paddingLeft": 32, "paddingRight": 32, "display": "flex", "flexDirection": "column", "gap": 24, "alignItems": "center"}, "mobile": {"paddingLeft": 20, "paddingRight": 20}}, [
        heading_block(s.eyebrow, s.heading or "Get new lessons in your inbox", s.subheading or "One email a week. Unsubscribe anytime."),
        el("newsletter", {"placeholder": "you@example.com", "buttonLabel": "Subscribe", "successText": "Thanks! Check your inbox to confirm.", "layout": "inline"}, {"base": {"maxWidth": "480px", "width": "100%"}}),
    ])
    return section([card], name="Newsletter", anchor=s.anchor or "newsletter")


def _contact(s: SectionSpec, ctx: dict) -> dict:
    form = el("form", {
        "fields": [
            {"key": "name", "label": "Name", "type": "text", "required": True},
            {"key": "email", "label": "Email", "type": "email", "required": True},
            {"key": "message", "label": "Message", "type": "textarea", "required": True},
        ],
        "submitLabel": "Send message",
        "successText": "Thanks! We'll get back to you soon.",
    }, {"base": {"maxWidth": "560px", "width": "100%", "marginLeft": "auto", "marginRight": "auto"}})
    return section([heading_block(s.eyebrow, s.heading or "Get in touch", s.subheading or "Questions about a course or training for your team? Send us a message."), form],
                   name="Contact", background=s.background, image=s.image, anchor=s.anchor or "contact")


def _rich_text(s: SectionSpec, ctx: dict) -> dict:
    kids = []
    if s.heading:
        kids.append(heading_block(s.eyebrow, s.heading, s.subheading, align="start"))
    kids.append(el("richtext", {"markdown": s.text or "Write something about your academy here."}, {"base": {"fontSize": "1.0625rem", "lineHeight": 1.75, "maxWidth": "760px"}}))
    return section(kids, name="Text", background=s.background, image=s.image, anchor=s.anchor)


def _navbar(s: SectionSpec, ctx: dict) -> dict:
    links = [{"label": b.label, "href": b.href} for b in s.buttons[:-1]] if len(s.buttons) > 1 else [
        {"label": "Courses", "href": "#courses"}, {"label": "Pricing", "href": "#pricing"}, {"label": "FAQ", "href": "#faq"},
    ]
    cta = {"label": s.buttons[-1].label, "href": s.buttons[-1].href} if s.buttons else {"label": "Sign up", "href": "/signup"}
    nav = el("navbar", {"variant": s.variant if s.variant in ("simple", "centered", "split") else "simple", "showLogo": True, "links": links, "cta": cta})
    return el("section", {"tag": "header"}, {"base": {"paddingTop": 16, "paddingBottom": 16, "paddingLeft": 24, "paddingRight": 24, **_bg(s.background)}, "mobile": {"paddingLeft": 16, "paddingRight": 16}},
              [el("container", {}, {"base": {"maxWidth": "content", "marginLeft": "auto", "marginRight": "auto", "width": "100%"}}, [nav])], name="Navigation")


def _footer(s: SectionSpec, ctx: dict) -> dict:
    footer = el("footer", {
        "variant": "columns" if s.items else "simple",
        "showLogo": True,
        "text": s.text or ctx.get("org_description") or "",
        "columns": [{"title": i.title, "links": [{"label": x, "href": "#"} for x in i.features]} for i in s.items][:6],
        # Filled in when the page renders, so the year stays current.
        "copyright": "© {year} {org}",
    })
    return el("section", {"tag": "footer"}, {"base": {"paddingTop": 56, "paddingBottom": 40, "paddingLeft": 24, "paddingRight": 24, "borderColor": "$border", "borderStyle": "solid", "borderWidth": 0, **_bg(s.background or "surface")}, "mobile": {"paddingLeft": 16, "paddingRight": 16}},
              [el("container", {}, {"base": {"maxWidth": "content", "marginLeft": "auto", "marginRight": "auto", "width": "100%"}}, [footer])], name="Footer")


def _countdown(s: SectionSpec, ctx: dict) -> dict:
    return section([heading_block(s.eyebrow, s.heading or "Enrollment closes soon", s.subheading), el("countdown", {"doneText": "Enrollment is closed."}), buttons_row(_btns(s, [{"label": "Enroll now", "href": "/courses"}]))],
                   name="Countdown", background=s.background or "dark", image=s.image, anchor=s.anchor)


RECIPES = {
    "hero": _hero,
    "features": _features,
    "courses": _courses,
    "featured_course": _featured_course,
    "paths": _collection("paths", "Learning paths"),
    "communities": _collection("communities", "Join the community"),
    "podcasts": _collection("podcasts", "Listen"),
    "live_sessions": _collection("live_sessions", "Upcoming live sessions"),
    "instructors": _instructors,
    "testimonials": _testimonials,
    "pricing": _pricing,
    "faq": _faq,
    "stats": _stats,
    "logos": _logos,
    "steps": _steps,
    "cta": _cta,
    "text_image": _text_image,
    "gallery": _gallery,
    "video": _video,
    "newsletter": _newsletter,
    "contact": _contact,
    "rich_text": _rich_text,
    "navbar": _navbar,
    "footer": _footer,
    "countdown": _countdown,
}


# Neutral illustrations shipped with the web app (apps/web/public/landing-scene-*.svg).
PLACEHOLDER_IMAGES = ("/landing-scene-1.svg", "/landing-scene-2.svg", "/landing-scene-3.svg")


def build_section(spec: SectionSpec | dict, ctx: Optional[dict] = None) -> dict:
    if isinstance(spec, dict):
        spec = SectionSpec.model_validate(spec)
    node = RECIPES[spec.kind](spec, ctx or {})
    return _clean(node)


# ─── style presets (restyle) ──────────────────────────────────────────────────

PRESETS: dict[str, dict] = {
    "brand": {"colors": {"primary": "brand"}, "radius": "lg", "buttonStyle": "solid"},
    "minimal": {
        "colors": {"primary": "#111111", "secondary": "#111111", "accent": "#111111", "background": "#ffffff", "surface": "#f6f6f6", "text": "#111111", "muted": "#6b6b6b", "border": "#e7e7e7"},
        "fonts": {"heading": "Inter", "body": "Inter"}, "radius": "sm", "buttonStyle": "outline", "density": "spacious", "headingWeight": "600",
    },
    "warm": {
        "colors": {"primary": "#c2410c", "secondary": "#7c2d12", "accent": "#f59e0b", "background": "#fffaf5", "surface": "#fff1e6", "text": "#2b1a10", "muted": "#7a5c4a", "border": "#f2dccb"},
        "fonts": {"heading": "Fraunces", "body": "Nunito"}, "radius": "xl", "buttonStyle": "pill", "headingWeight": "700",
    },
    "bold": {
        "colors": {"primary": "#4f46e5", "secondary": "#111827", "accent": "#facc15", "background": "#ffffff", "surface": "#eef2ff", "text": "#0b1020", "muted": "#4b5563", "border": "#e5e7eb"},
        "fonts": {"heading": "Space Grotesk", "body": "Inter"}, "radius": "md", "buttonStyle": "solid", "headingWeight": "800",
    },
    "elegant": {
        "colors": {"primary": "#1f3a32", "secondary": "#0f1f1a", "accent": "#b08d57", "background": "#fbfaf7", "surface": "#f1eee6", "text": "#1b1b18", "muted": "#6f6a5f", "border": "#e4dfd3"},
        "fonts": {"heading": "Playfair Display", "body": "Lora"}, "radius": "none", "buttonStyle": "outline", "density": "spacious", "headingWeight": "600",
    },
    "playful": {
        "colors": {"primary": "#db2777", "secondary": "#7c3aed", "accent": "#22c55e", "background": "#ffffff", "surface": "#fdf2f8", "text": "#1f1033", "muted": "#6b5b7b", "border": "#f5d0e6"},
        "fonts": {"heading": "Quicksand", "body": "Nunito"}, "radius": "full", "buttonStyle": "pill", "headingWeight": "700",
    },
    "dark": {
        "colors": {"primary": "#38bdf8", "secondary": "#0ea5e9", "accent": "#a3e635", "background": "#0b1120", "surface": "#111a2e", "text": "#e5edf7", "muted": "#94a3b8", "border": "#1e293b"},
        "fonts": {"heading": "Sora", "body": "Inter"}, "radius": "lg", "buttonStyle": "solid", "headingWeight": "700",
    },
    "fresh": {
        "colors": {"primary": "#059669", "secondary": "#064e3b", "accent": "#fbbf24", "background": "#ffffff", "surface": "#ecfdf5", "text": "#0f172a", "muted": "#475569", "border": "#d1fae5"},
        "fonts": {"heading": "Plus Jakarta Sans", "body": "Plus Jakarta Sans"}, "radius": "xl", "buttonStyle": "solid", "headingWeight": "800",
    },
}


def apply_theme(theme: dict, changes: dict) -> dict:
    out = copy.deepcopy(theme)
    for key, value in changes.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = {**out[key], **value}
        else:
            out[key] = value
    return theme_dump(Theme.model_validate(out))


# ─── templates ────────────────────────────────────────────────────────────────

# The home page of an org that never had a custom landing: the classic
# course catalog, with a short welcome above it (see migrate_legacy.py).
DEFAULT_TEMPLATE = "default"

TEMPLATES: list[dict] = [
    {
        "id": DEFAULT_TEMPLATE,
        "name": "Simple catalog",
        "description": "A short welcome and your course catalog: the classic home page, in the builder.",
        "audience": "everyone",
        "preset": "brand",
        "sections": [
            {"kind": "hero", "variant": "compact", "buttons": [{"label": "Browse all courses", "href": "/courses"}]},
            {"kind": "courses", "heading": "Courses", "limit": 12, "columns": 4, "anchor": "courses"},
        ],
    },
    {
        "id": "creator",
        "name": "Course creator",
        "description": "A personal brand page: you, your flagship course, proof and pricing.",
        "audience": "creators",
        "preset": "warm",
        "sections": [
            {"kind": "hero", "variant": "split", "eyebrow": "Online courses", "heading": "Learn the skills I use every day", "subheading": "Practical, no-fluff courses that take you from first steps to real results."},
            {"kind": "stats"},
            {"kind": "featured_course", "heading": "Start with the flagship course"},
            {"kind": "steps"},
            {"kind": "testimonials", "variant": "grid"},
            {"kind": "pricing"},
            {"kind": "faq"},
            {"kind": "newsletter"},
        ],
    },
    {
        "id": "school",
        "name": "School / academy",
        "description": "A full catalog front page with paths, instructors and community.",
        "audience": "schools",
        "preset": "brand",
        "sections": [
            {"kind": "hero", "variant": "centered", "eyebrow": "Welcome", "heading": "", "subheading": ""},
            {"kind": "courses", "heading": "Explore our courses", "limit": 6},
            {"kind": "paths"},
            {"kind": "features", "heading": "Everything you need to learn well"},
            {"kind": "instructors"},
            {"kind": "testimonials", "variant": "carousel"},
            {"kind": "cta"},
        ],
    },
    {
        "id": "business",
        "name": "Business training",
        "description": "For companies training teams and customers: outcomes, logos, contact.",
        "audience": "business",
        "preset": "bold",
        "sections": [
            {"kind": "hero", "variant": "split", "eyebrow": "Team training", "heading": "Train your team on the skills that move the business", "subheading": "Ready-made courses, progress tracking and certificates for every employee.", "buttons": [{"label": "Talk to us", "href": "#contact"}, {"label": "See courses", "href": "#courses"}]},
            {"kind": "features", "heading": "Built for teams", "items": [
                {"icon": "ChartLineUp", "title": "Track progress", "text": "See who finished what, and where people get stuck."},
                {"icon": "ShieldCheck", "title": "Compliance ready", "text": "Required training with due dates and reminders."},
                {"icon": "UsersThree", "title": "Groups and roles", "text": "Organize learners by team, region or client."},
            ]},
            {"kind": "courses", "heading": "Courses your team can start today"},
            {"kind": "stats", "items": [{"value": "3x", "label": "Faster onboarding"}, {"value": "95%", "label": "Completion"}, {"value": "200+", "label": "Teams"}]},
            {"kind": "faq"},
            {"kind": "contact"},
        ],
    },
    {
        "id": "minimal",
        "name": "Minimal",
        "description": "Clean and quiet: a short intro, your courses and a call to action.",
        "audience": "everyone",
        "preset": "minimal",
        "sections": [
            {"kind": "hero", "variant": "centered"},
            {"kind": "courses", "limit": 6},
            {"kind": "cta", "background": "dark"},
        ],
    },
    {
        "id": "launch",
        "name": "Course launch",
        "description": "A launch page with a countdown, curriculum steps and early-bird pricing.",
        "audience": "creators",
        "preset": "dark",
        "sections": [
            {"kind": "hero", "variant": "centered", "eyebrow": "New course", "heading": "The course you've been waiting for", "subheading": "Doors open soon. Join the waitlist to get the early-bird price.", "buttons": [{"label": "Join the waitlist", "href": "#newsletter"}]},
            {"kind": "countdown"},
            {"kind": "text_image", "heading": "What you'll build", "items": [{"title": "A real project, start to finish"}, {"title": "Feedback from the instructor"}, {"title": "A certificate when you're done"}]},
            {"kind": "steps", "heading": "Curriculum"},
            {"kind": "pricing", "items": [{"name": "Early bird", "price": "$99", "text": "Lifetime access", "features": ["Full course", "Community", "Certificate"], "highlighted": True}, {"name": "Regular", "price": "$149", "text": "Lifetime access", "features": ["Full course", "Community", "Certificate"]}]},
            {"kind": "newsletter"},
            {"kind": "faq"},
        ],
    },
    {
        "id": "community",
        "name": "Community hub",
        "description": "Lead with people: communities, live sessions, podcasts and courses.",
        "audience": "schools",
        "preset": "fresh",
        "sections": [
            {"kind": "hero", "variant": "centered", "eyebrow": "Learn together", "heading": "A place to learn with others", "subheading": "Courses, live sessions and discussions with people on the same path."},
            {"kind": "communities"},
            {"kind": "live_sessions"},
            {"kind": "courses"},
            {"kind": "podcasts"},
            {"kind": "cta"},
        ],
    },
]


def template_summaries(*, include_legacy: bool = False) -> list[dict]:
    """The gallery: the designed templates (templates/), then the simple
    catalog home. The first recipe templates stay buildable for old links and
    agents (``legacy``) but are no longer offered unless asked for."""
    from src.services.landing import templates as gallery

    simple = [
        {k: t[k] for k in ("id", "name", "description", "audience", "preset")}
        | {"sections": [s["kind"] for s in t["sections"]], "category": "simple", "featured": t["id"] == DEFAULT_TEMPLATE, "legacy": t["id"] != DEFAULT_TEMPLATE}
        for t in TEMPLATES
    ]
    out = gallery.summaries() + [x for x in simple if not x["legacy"]]
    if include_legacy:
        out += [x for x in simple if x["legacy"]]
    return out


def template_ids() -> list[str]:
    from src.services.landing import templates as gallery

    return [t["id"] for t in gallery.GALLERY] + [t["id"] for t in TEMPLATES]


def build_page(sections: list[SectionSpec | dict], *, ctx: Optional[dict] = None, preset: str = "brand", theme: Optional[dict] = None) -> dict:
    doc = empty_doc()
    doc["theme"] = apply_theme(doc["theme"], PRESETS.get(preset, PRESETS["brand"]))
    if theme:
        doc["theme"] = apply_theme(doc["theme"], theme)
    root = []
    for n, spec in enumerate(sections):
        spec = spec if isinstance(spec, SectionSpec) else SectionSpec.model_validate(spec)
        # A split hero or text-and-image section without a picture gets a
        # neutral illustration instead of an empty column.
        if spec.kind in ("hero", "text_image") and spec.variant not in ("centered", "compact", "") and not spec.image:
            spec = spec.model_copy(update={"image": PLACEHOLDER_IMAGES[n % len(PLACEHOLDER_IMAGES)]})
        elif spec.kind == "text_image" and not spec.image:
            spec = spec.model_copy(update={"image": PLACEHOLDER_IMAGES[n % len(PLACEHOLDER_IMAGES)]})
        root.append(build_section(spec, ctx))
    doc["root"] = root
    return doc


def build_template(template_id: str, ctx: Optional[dict] = None) -> dict:
    from src.services.landing import templates as gallery

    if gallery.has(template_id):
        return gallery.build(template_id, ctx)
    tpl = next((t for t in TEMPLATES if t["id"] == template_id), None)
    if tpl is None:
        raise KeyError(template_id)
    return build_page(tpl["sections"], ctx=ctx, preset=tpl["preset"])


def section_library(ctx: Optional[dict] = None) -> list[dict]:
    """Ready-made sections for the builder's library (one per kind/variant)."""
    entries = [
        ("hero", "centered"), ("hero", "split"), ("hero", "image"), ("features", "cards"), ("features", "list"),
        ("courses", "grid"), ("courses", "carousel"), ("featured_course", ""), ("paths", ""), ("communities", ""),
        ("podcasts", ""), ("live_sessions", ""), ("instructors", ""), ("testimonials", "grid"), ("testimonials", "single"),
        ("pricing", ""), ("faq", ""), ("stats", ""), ("logos", ""), ("steps", ""), ("cta", ""), ("text_image", ""),
        ("text_image", "image-left"), ("video", ""), ("gallery", ""), ("newsletter", ""), ("contact", ""), ("rich_text", ""),
        ("navbar", ""), ("footer", ""), ("countdown", ""),
    ]
    out = []
    for kind, variant in entries:
        spec = SectionSpec(kind=kind, variant=variant)
        if kind == "hero" and variant == "image":
            spec = SectionSpec(kind=kind, variant="centered", background="gradient")
        elif kind == "logos":
            spec = SectionSpec(kind=kind, items=[SpecItem(title=f"Logo {i}", image=f"/landing-logo-{i}.svg") for i in range(1, 6)])
        elif kind == "gallery":
            spec = SectionSpec(kind=kind, heading="Inside the courses", items=[SpecItem(title=f"Scene {i + 1}", image=img) for i, img in enumerate(PLACEHOLDER_IMAGES)])
        elif kind == "text_image":
            spec = SectionSpec(kind=kind, variant=variant, image=PLACEHOLDER_IMAGES[len(out) % len(PLACEHOLDER_IMAGES)],
                               text="Short lessons, real projects and feedback that keeps you moving. Learn at your own pace, on any device.",
                               buttons=[SpecButton(label="Browse courses", href="/courses")])
        elif kind == "hero" and variant != "centered":
            spec = SectionSpec(kind=kind, variant=variant, image=PLACEHOLDER_IMAGES[len(out) % len(PLACEHOLDER_IMAGES)])
        out.append({"kind": kind, "variant": variant, "node": build_section(spec, ctx)})
    return out
