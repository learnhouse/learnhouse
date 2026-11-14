"""The template gallery: fifteen designed starting points, one per kind of
learning business, each with its own palette, type and layout rhythm.

``build(template_id, ctx)`` returns a full page document (validate it before
storing). Copy is real and adapts to the org's name; data sections (courses,
paths, live sessions, communities, podcasts) show the org's own content.
Pictures are original SVG art shipped with the web app
(apps/web/public/landing-t-*.svg), so every template is license-safe.

``adopt_org_brand`` swaps a template's palette and fonts for the org theme's
(``brand`` tokens), for "use my colors" when applying a template.
"""

from __future__ import annotations

import copy
from typing import Any, Callable, Optional

from src.services.landing.templates import catalog_a, catalog_b

Builder = Callable[[dict], dict]

# id, builder, category, tags. Names and descriptions are translated in the
# web app (landingBuilder.templates.<id>.name / .description); the English
# here is for agents and the API.
GALLERY: list[dict[str, Any]] = [
    {"id": "academy", "build": catalog_a.academy, "name": "Meridian", "category": "academy", "scheme": "light", "tags": ["serif", "editorial"],
     "description": "An editorial academy home: quiet serif type, a numbered method and a calm catalogue."},
    {"id": "bootcamp", "build": catalog_a.bootcamp, "name": "Forge", "category": "bootcamp", "scheme": "dark", "tags": ["dark", "bold"],
     "description": "A high-energy bootcamp: dark canvas, electric accent, syllabus, outcomes and a cohort countdown."},
    {"id": "corporate", "build": catalog_a.corporate, "name": "Northwind", "category": "corporate", "scheme": "light", "tags": ["sans", "clean"],
     "description": "Corporate training: programmes, results band, client logos and a walkthrough form."},
    {"id": "university", "build": catalog_a.university, "name": "Collegiate", "category": "university", "scheme": "light", "tags": ["serif", "formal"],
     "description": "A university department: faculty, programmes, lectures and admissions, in a formal serif."},
    {"id": "coach", "build": catalog_a.coach, "name": "Lumen", "category": "creator", "scheme": "light", "tags": ["serif", "warm"],
     "description": "A creator or coach: warm palette, flagship programme, testimonials, offers and a letter."},
    {"id": "language", "build": catalog_a.language, "name": "Polyglot", "category": "language", "scheme": "light", "tags": ["playful", "colorful"],
     "description": "A language school: CEFR levels, conversation clubs and simple membership pricing."},
    {"id": "health", "build": catalog_a.health, "name": "Clinic", "category": "health", "scheme": "light", "tags": ["sans", "trust"],
     "description": "Health and CE credits: accreditation, credit hours, a four-step certificate flow and FAQ."},
    {"id": "coding", "build": catalog_a.coding, "name": "Syntax", "category": "coding", "scheme": "light", "tags": ["mono", "technical"],
     "description": "A coding school: grid paper hero, learning paths, student projects and mentor reviews."},
    {"id": "kids", "build": catalog_b.kids, "name": "Lanterns", "category": "kids", "scheme": "light", "tags": ["playful", "rounded"],
     "description": "Kids learning: soft colours, four subject worlds and a section written for parents."},
    {"id": "nonprofit", "build": catalog_b.nonprofit, "name": "Commons", "category": "nonprofit", "scheme": "light", "tags": ["serif", "earthy"],
     "description": "A nonprofit: mission, impact numbers, free courses, partners and a supporter call."},
    {"id": "cohort", "build": catalog_b.cohort, "name": "Cohort", "category": "cohort", "scheme": "light", "tags": ["serif", "minimal"],
     "description": "A live cohort course: huge serif headline, six-week syllabus, instructors and enrolment."},
    {"id": "membership", "build": catalog_b.membership, "name": "Circle", "category": "community", "scheme": "dark", "tags": ["dark", "glow"],
     "description": "A membership community: glowing dark hero, spaces, live sessions, podcast and tiers."},
    {"id": "partner", "build": catalog_b.partner, "name": "Channel", "category": "partner", "scheme": "light", "tags": ["sans", "b2b"],
     "description": "A B2B partner academy: role-based paths, certification tiers and a partner application."},
    {"id": "atelier", "build": catalog_b.atelier, "name": "Atelier", "category": "art", "scheme": "light", "tags": ["display", "bold"],
     "description": "An art and design school: oversized display type, student work and disciplines."},
    {"id": "certification", "build": catalog_b.certification, "name": "Standard", "category": "certification", "scheme": "light", "tags": ["serif", "trust"],
     "description": "A certification body: credential levels, exam preparation, process and verification."},
]

BY_ID: dict[str, dict[str, Any]] = {t["id"]: t for t in GALLERY}
CATEGORIES = tuple(dict.fromkeys(t["category"] for t in GALLERY))


def has(template_id: str) -> bool:
    return template_id in BY_ID


def build(template_id: str, ctx: Optional[dict] = None) -> dict:
    tpl = BY_ID.get(template_id)
    if tpl is None:
        raise KeyError(template_id)
    return tpl["build"](ctx or {})


def summary(tpl: dict[str, Any]) -> dict:
    """Gallery card data: palette swatches and fonts come from the design itself."""
    doc = tpl["build"]({})
    th = doc["theme"]
    c = th["colors"]
    return {
        "id": tpl["id"],
        "name": tpl["name"],
        "description": tpl["description"],
        "category": tpl["category"],
        "scheme": tpl["scheme"],
        "tags": tpl["tags"],
        "palette": [c["background"], c["primary"], c["accent"], c["text"]],
        "fonts": th["fonts"],
        "sections": [n.get("name") or n["type"] for n in doc["root"]],
        "audience": tpl["category"],
        "preset": "",
        "featured": True,
    }


_SUMMARIES: Optional[list[dict]] = None


def summaries() -> list[dict]:
    global _SUMMARIES
    if _SUMMARIES is None:
        _SUMMARIES = [summary(t) for t in GALLERY]
    return copy.deepcopy(_SUMMARIES)


def adopt_org_brand(doc: dict, org_theme: Optional[dict] = None) -> dict:
    """Use the org's own brand instead of the template palette.

    The primary color (and the accent, when the org has a separate one)
    becomes the ``brand`` token, so the page follows later theme changes; the
    fonts switch to the org's when it set any. Backgrounds and neutrals stay,
    so a dark template stays dark and text keeps its contrast."""
    out = copy.deepcopy(doc)
    th = out.setdefault("theme", {})
    colors = th.setdefault("colors", {})
    org_theme = org_theme or {}
    if org_theme.get("has_color", True):
        colors["primary"] = "brand"
    fonts = th.setdefault("fonts", {})
    if org_theme.get("font"):
        fonts["body"] = "brand"
        fonts["heading"] = "brand"
    return out


def library_sections(ctx: Optional[dict] = None) -> list[dict]:
    """Every designed section of every template, for the builder's library
    ("From templates"). Each keeps its template id so the builder can group
    them and show where it comes from."""
    out = []
    for tpl in GALLERY:
        doc = tpl["build"](ctx or {})
        for node in doc["root"]:
            out.append({"kind": "template", "variant": tpl["id"], "template": tpl["id"], "name": node.get("name") or node["type"], "node": node})
    return out
