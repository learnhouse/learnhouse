"""Turn a legacy custom landing (``customization.landing.sections``) into a
builder document.

Every legacy section type and every field it renders maps to builder
elements with the same look: sizes, colors, buttons, visibility, schedule,
devices, per-section style (background, text color, spacing, anchor, narrow
width, centered titles, entrance animation) and the page settings. Values the
legacy renderer would have neutralised (an unsafe link, a broken color) are
neutralised the same way here, so the result always validates. The legacy
config itself is never touched: switching back renders it exactly as before.
"""

from __future__ import annotations

from typing import Any, Optional

from src.services.landing.recipes import new_id
from src.services.landing.schema import (
    SCHEMA,
    SCHEMA_VERSION,
    Theme,
    check_color,
    check_href,
    check_iso,
    check_src,
    validate_doc,
)

TITLE = {"fontSize": 30, "fontWeight": "700", "marginBottom": 24, "lineHeight": 1.2}
TITLE_MOBILE = {"fontSize": 24}
PAD = {"none": 0, "small": 24, "medium": 64, "large": 112}
HERO_HEIGHT = {"small": 320, "medium": 500, "large": 680, "screen": "85vh"}
SPACER = {"small": 32, "medium": 64, "large": 128}
# Content width of the legacy page frame (max 2xl minus its 64px gutters); wide pages get more.
FRAME = "1408px"
FRAME_WIDE = "1792px"
WHITE_CARD = {"backgroundColor": "#ffffff", "color": "#111827", "borderRadius": 12, "boxShadow": "sm"}


def _s(value: Any, limit: int = 5000) -> str:
    return value[:limit] if isinstance(value, str) else ("" if value is None else str(value)[:limit])


def _href(value: Any) -> str:
    try:
        return check_href(_s(value, 2000))
    except ValueError:
        return ""


def _src(value: Any) -> str:
    try:
        return check_src(_s(value, 2000))
    except ValueError:
        return ""


def _color(value: Any) -> Optional[str]:
    try:
        return check_color(_s(value, 64).strip() or None)
    except ValueError:
        return None


def _iso(value: Any) -> Optional[str]:
    try:
        return check_iso(_s(value, 64) or None)
    except ValueError:
        return None


def _node(type_: str, props: Optional[dict] = None, base: Optional[dict] = None, children: Optional[list] = None, *, mobile: Optional[dict] = None, name: Optional[str] = None) -> dict:
    node: dict[str, Any] = {"id": new_id("lg"), "type": type_, "props": props or {}}
    style = {}
    base = {k: v for k, v in (base or {}).items() if v is not None}
    if base:
        style["base"] = base
    if mobile:
        style["mobile"] = mobile
    if style:
        node["style"] = style
    if children is not None:
        node["children"] = children
    if name:
        node["name"] = name
    return node


def _title(text: Any, *, center: bool = False, extra: Optional[dict] = None) -> Optional[dict]:
    text = _s(text, 500)
    if not text:
        return None
    return _node("heading", {"text": text, "level": 2}, {**TITLE, **({"textAlign": "center"} if center else {}), **(extra or {})}, mobile=TITLE_MOBILE)


def _para(text: Any, *, center: bool = False, extra: Optional[dict] = None) -> Optional[dict]:
    text = _s(text)
    if not text:
        return None
    return _node("text", {"text": text}, {"fontSize": 18, "opacity": 0.7, "lineHeight": 1.6, **({"textAlign": "center"} if center else {}), **(extra or {})}, mobile={"fontSize": 16})


def _button(b: Any, *, size: str = "md") -> Optional[dict]:
    if not isinstance(b, dict) or not _s(b.get("text")):
        return None
    base: dict[str, Any] = {"fontWeight": "800", "borderRadius": 8}
    bg = _color(b.get("background"))
    if bg:
        base["backgroundColor"] = bg
        base["color"] = _color(b.get("color")) or "#ffffff"
        base["borderColor"] = bg
    return _node("button", {"label": _s(b.get("text"), 120), "href": _href(b.get("link")), "variant": "primary", "size": size}, base, mobile={"width": "100%"})


def _buttons(buttons: Any, *, justify: str = "center") -> Optional[dict]:
    kids = [x for x in (_button(b) for b in (buttons if isinstance(buttons, list) else [])) if x]
    if not kids:
        return None
    return _node("container", {}, {"display": "flex", "flexWrap": "wrap", "gap": 12, "justifyContent": justify, "alignItems": "center", "marginTop": 8}, kids,
                 mobile={"flexDirection": "column", "alignItems": "stretch"})


def _bg_style(bg: Any) -> dict:
    if not isinstance(bg, dict):
        return {}
    kind = bg.get("type")
    if kind == "solid":
        c = _color(bg.get("color"))
        return {"backgroundColor": c} if c else {}
    if kind == "gradient":
        colors = [c for c in (_color(x) for x in (bg.get("colors") or [])) if c]
        if len(colors) < 2:
            return {}
        try:
            angle = int(str(bg.get("direction") or "45deg").replace("deg", "").strip())
        except ValueError:
            angle = 45
        grad: dict[str, Any] = {"from": colors[0], "to": colors[-1], "angle": max(0, min(360, angle))}
        if len(colors) > 2:
            grad["via"] = colors[1]
        return {"backgroundGradient": grad}
    if kind == "image":
        src = _src(bg.get("image"))
        return {"backgroundImage": src, "backgroundSize": "cover", "backgroundPosition": "center"} if src else {}
    return {}


def _section(children: list, legacy: dict, *, pad: Optional[int] = None, name: str, inner_extra: Optional[dict] = None) -> dict:
    """The legacy section frame: horizontal margins, spacing and the optional
    per-section style (background, text color, anchor, narrow, animation)."""
    style = legacy.get("style") if isinstance(legacy.get("style"), dict) else {}
    spacing = style.get("spacing") or "medium"
    p = PAD.get(spacing, 64) if pad is None else pad
    base: dict[str, Any] = {"paddingTop": p, "paddingBottom": p, "paddingLeft": 64, "paddingRight": 64}
    bg = _bg_style(style.get("background"))
    if bg:
        base.update(bg)
        base.update({"borderRadius": 12, "marginTop": 8, "marginBottom": 8})
    color = _color(style.get("textColor"))
    if color:
        base["color"] = color
    inner_base: dict[str, Any] = {"width": "100%", "maxWidth": FRAME, "marginLeft": "auto", "marginRight": "auto", "display": "flex", "flexDirection": "column"}
    if style.get("width") == "narrow":
        inner_base["maxWidth"] = "896px"
    inner_base.update(inner_extra or {})
    kids = [c for c in children if c]
    if style.get("titleAlign") == "center":
        for c in kids:
            if c["type"] == "heading":
                c.setdefault("style", {}).setdefault("base", {})["textAlign"] = "center"
    inner = _node("container", {}, inner_base, kids)
    node = _node("section", {"tag": "section"}, base, [inner], mobile={"paddingLeft": 24, "paddingRight": 24}, name=name)
    node["style"]["tablet"] = {"paddingLeft": 40, "paddingRight": 40}
    anchor = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in _s(style.get("anchor"), 64).strip().lstrip("#").lower()).strip("-")
    if anchor and anchor[0].isalnum():
        node["anchor"] = anchor
    if style.get("animation") in ("fade", "slide-up"):
        node["animation"] = {"type": style["animation"], "delay": 0, "duration": 600}
    _frame(node, legacy)
    return node


def _frame(node: dict, legacy: dict) -> None:
    vis = legacy.get("visibility")
    if vis in ("logged_in", "logged_out"):
        node["visibility"] = vis
    if legacy.get("hidden"):
        node["hidden"] = {"desktop": True, "tablet": True, "mobile": True}
    elif legacy.get("device") == "desktop":
        node["hidden"] = {"desktop": False, "tablet": False, "mobile": True}
    elif legacy.get("device") == "mobile":
        node["hidden"] = {"desktop": True, "tablet": True, "mobile": False}
    sched = {k: v for k, v in (("from", _iso(legacy.get("showFrom"))), ("until", _iso(legacy.get("showUntil")))) if v}
    if sched:
        node["schedule"] = sched


def _image(img: Any, base: Optional[dict] = None, **props) -> Optional[dict]:
    if not isinstance(img, dict) or not _src(img.get("url")):
        return None
    return _node("image", {"src": _src(img.get("url")), "alt": _s(img.get("alt"), 300), **props}, base)


def _cols(n: int) -> int:
    return 4 if n >= 4 else 2 if n == 2 else 3


# ─── per type ────────────────────────────────────────────────────────────────


def _hero(s: dict) -> dict:
    align = s.get("contentAlign") or "center"
    text_align = {"left": "start", "right": "end"}.get(align, "center")
    justify = {"left": "flex-start", "right": "flex-end"}.get(align, "center")
    heading = s.get("heading") if isinstance(s.get("heading"), dict) else {}
    sub = s.get("subheading") if isinstance(s.get("subheading"), dict) else {}
    content = _node("container", {}, {"display": "flex", "flexDirection": "column", "justifyContent": "center", "alignItems": justify, "paddingTop": 24, "paddingBottom": 24, "paddingLeft": 24, "paddingRight": 24, "flexGrow": 1}, [x for x in [
        _node("heading", {"text": _s(heading.get("text"), 500), "level": 1}, {"fontSize": 30, "fontWeight": "700", "marginBottom": 16, "textAlign": text_align, "color": _color(heading.get("color")), "maxWidth": "672px"}, mobile={"fontSize": 20, "marginBottom": 8}),
        _node("text", {"text": _s(sub.get("text"))}, {"fontSize": 18, "fontWeight": "500", "marginBottom": 32, "textAlign": text_align, "color": _color(sub.get("color")), "maxWidth": "672px"}, mobile={"fontSize": 14, "marginBottom": 16}) if _s(sub.get("text")) else None,
        _buttons(s.get("buttons"), justify=justify),
    ] if x])
    ill = s.get("illustration") if isinstance(s.get("illustration"), dict) else None
    card_kids: list = [content]
    if ill and isinstance(ill.get("image"), dict) and _src(ill["image"].get("url")):
        valign = {"top": "flex-start", "bottom": "flex-end"}.get(ill.get("verticalAlign"), "center")
        img = _node("container", {}, {"display": "flex", "alignItems": valign, "paddingTop": 24, "paddingBottom": 24, "paddingLeft": 24, "paddingRight": 24}, [
            _node("image", {"src": _src(ill["image"].get("url")), "alt": _s(ill["image"].get("alt"), 300)}, {"width": "100%", "objectFit": "contain"})
        ])
        ratio = {"small": "1:3", "medium": "1:2"}.get(ill.get("size"), "2:3")
        if ill.get("position") == "right":
            ratio = ratio[::-1]  # "1:3" -> "3:1"
            card_kids = [content, img]
        else:
            card_kids = [img, content]
        card_kids = [_node("columns", {"ratio": ratio, "stackAt": "mobile"}, {"gap": 0, "alignItems": "stretch"}, card_kids)]
    card_base: dict[str, Any] = {
        "minHeight": HERO_HEIGHT.get(s.get("height") or "medium", 500), "borderRadius": 12, "borderWidth": 1, "borderStyle": "solid",
        "borderColor": "#f3f4f6", "overflow": "hidden", "display": "flex", "flexDirection": "column", "justifyContent": "center", "width": "100%",
        **_bg_style(s.get("background")),
    }
    try:
        overlay = max(0, min(80, int(s.get("overlay") or 0)))
    except (TypeError, ValueError):
        overlay = 0
    if overlay:
        card_base.update({"overlayColor": "#000000", "overlayOpacity": overlay})
    mobile_h = {"small": 260, "medium": 400, "large": 520}.get(s.get("height") or "medium")
    card = _node("container", {}, card_base, card_kids, mobile={"minHeight": mobile_h} if mobile_h else None)
    return _section([card], s, pad=0, name="Hero", inner_extra={"paddingTop": 40})


def _text_image(s: dict) -> dict:
    text = _node("container", {}, {"display": "flex", "flexDirection": "column", "gap": 16, "maxWidth": "672px"}, [x for x in [
        _title(s.get("title"), extra={"marginBottom": 0}),
        _node("text", {"text": _s(s.get("text"))}, {"fontSize": 18, "lineHeight": 1.7, "color": "#4b5563"}, mobile={"fontSize": 16}),
        _buttons(s.get("buttons"), justify="flex-start"),
    ] if x])
    img = _image(s.get("image"), {"width": "100%", "maxWidth": "500px", "aspectRatio": "4/3", "objectFit": "contain", "borderRadius": 8, "marginLeft": "auto", "marginRight": "auto"})
    kids = [text, _node("container", {}, {}, [img] if img else [])]
    if s.get("flow") == "right":
        kids.reverse()
    card = _node("container", {}, {**WHITE_CARD, "paddingTop": 48, "paddingBottom": 48, "paddingLeft": 48, "paddingRight": 48}, [
        _node("columns", {"ratio": "equal", "stackAt": "tablet"}, {"gap": 48, "alignItems": "center"}, kids)
    ], mobile={"paddingTop": 24, "paddingBottom": 24, "paddingLeft": 24, "paddingRight": 24})
    return _section([card], s, name="Text and image")


def _items(s: dict, key: str = "items") -> list:
    value = s.get(key)
    return [x for x in value if isinstance(x, dict)] if isinstance(value, list) else []


def convert_section(s: dict) -> Optional[dict]:
    t = s.get("type")
    if t == "hero":
        return _hero(s)
    if t == "text-and-image":
        return _text_image(s)
    if t == "logos":
        logos = [{"src": _src(lg.get("url")), "alt": _s(lg.get("alt"), 200)} for lg in _items(s, "logos") if _src(lg.get("url"))]
        return _section([_title(s.get("title"), extra={"marginBottom": 64}), _node("logos", {"items": logos, "grayscale": False, "size": "lg"})], s, name="Logos")
    if t == "people":
        people = [{"name": _s(p.get("name"), 120), "role": _s(p.get("description"), 120), "image": _src(p.get("image_url")), "username": _s(p.get("username"), 64)} for p in _items(s, "people")]
        return _section([_title(s.get("title"), extra={"marginBottom": 40}), _node("instructors", {"people": people, "layout": "row", "columns": 6})], s, name="People")
    if t == "featured-courses":
        uuids = []
        for c in s.get("courses") or []:
            uuid = c if isinstance(c, str) else c.get("course_uuid") if isinstance(c, dict) else None
            if uuid:
                uuids.append(_s(uuid, 100))
        latest = s.get("mode") == "latest"
        try:
            limit = max(1, min(48, int(s.get("limit") or 8)))
        except (TypeError, ValueError):
            limit = 8
        props = {"source": "latest" if latest else "selected", "courseUuids": [] if latest else uuids[:60], "limit": limit if latest else max(1, min(48, len(uuids) or 1)), "columns": 4, "showDescription": False}
        return _section([_title(s.get("title")), _node("courses", props)], s, name="Featured courses")
    if t == "video":
        return _section([_title(s.get("title"), extra={"marginBottom": 12}), _para(s.get("description"), extra={"marginBottom": 24}),
                         _node("video", {"url": _src(s.get("url"))}, {"maxWidth": "896px", "width": "100%", "marginLeft": "auto", "marginRight": "auto", "borderRadius": 12, "overflow": "hidden", "boxShadow": "sm"})], s, name="Video")
    if t == "rich-text":
        center = s.get("align") == "center"
        return _section([_title(s.get("title"), center=center), _node("richtext", {"markdown": _s(s.get("content"), 20000)}, {"fontSize": 18, **({"textAlign": "center"} if center else {})})], s, name="Text",
                        inner_extra={"maxWidth": "768px", **({} if center else {"marginLeft": 0})})
    if t == "features":
        items = [{"emoji": _s(i.get("icon"), 8), "title": _s(i.get("title"), 200), "text": _s(i.get("description"), 1500)} for i in _items(s)]
        cols = s.get("columns") if s.get("columns") in (2, 3, 4) else 3
        return _section([_title(s.get("title"), extra={"marginBottom": 8 if s.get("subtitle") else 24}), _para(s.get("subtitle"), extra={"marginBottom": 32}), _node("features", {"items": items, "columns": cols, "layout": "cards"})], s, name="Features")
    if t == "stats":
        items = [{"value": _s(i.get("value"), 40), "label": _s(i.get("label"), 120)} for i in _items(s)][:12]
        return _section([_title(s.get("title"), center=True), _node("stats", {"items": items, "layout": "row"})], s, name="Stats")
    if t == "testimonials":
        items = [{"quote": _s(i.get("quote"), 1500), "author": _s(i.get("author"), 120), "role": _s(i.get("role"), 120), "image": _src(i.get("image_url"))} for i in _items(s)]
        return _section([_title(s.get("title")), _node("testimonials", {"items": items, "layout": "grid", "columns": 3})], s, name="Testimonials")
    if t == "faq":
        items = [{"question": _s(i.get("question"), 500), "answer": _s(i.get("answer"), 3000)} for i in _items(s)]
        return _section([_title(s.get("title"), center=True), _node("faq", {"items": items, "layout": "accordion"}, {"maxWidth": "768px", "width": "100%", "marginLeft": "auto", "marginRight": "auto"})], s, name="FAQ")
    if t == "cta":
        bg = _bg_style(s.get("background")) or {"backgroundColor": "#0f172a"}
        card = _node("container", {}, {**bg, "color": _color(s.get("textColor")) or "#ffffff", "borderRadius": 16, "boxShadow": "sm", "paddingTop": 56, "paddingBottom": 56, "paddingLeft": 48, "paddingRight": 48, "display": "flex", "flexDirection": "column", "alignItems": "center", "gap": 12}, [x for x in [
            _node("heading", {"text": _s(s.get("heading"), 500), "level": 2}, {"fontSize": 36, "fontWeight": "700", "textAlign": "center", "letterSpacing": "-0.01em"}, mobile={"fontSize": 24}),
            _para(s.get("text"), center=True, extra={"opacity": 0.8, "maxWidth": "672px"}),
            _buttons(s.get("buttons")),
        ] if x], mobile={"paddingLeft": 24, "paddingRight": 24})
        return _section([card], s, name="Call to action")
    if t == "gallery":
        images = [{"src": _src(i.get("url")), "alt": _s(i.get("alt"), 300)} for i in _items(s, "images") if _src(i.get("url"))]
        if not images:
            return None
        cols = s.get("columns") if s.get("columns") in (2, 3, 4) else 3
        return _section([_title(s.get("title")), _node("gallery", {"images": images, "columns": cols})], s, name="Gallery")
    if t == "spacer":
        size = SPACER.get(s.get("size") or "medium", 64)
        kids = [_node("divider", {}, {"opacity": 0.15})] if s.get("divider") else []
        node = _node("section", {"tag": "div"}, {"minHeight": size, "display": "flex", "alignItems": "center", "paddingLeft": 64, "paddingRight": 64},
                     [_node("container", {}, {"width": "100%"}, kids)], name="Spacer")
        _frame(node, s)
        return node
    if t == "pricing":
        plans = []
        for p in _items(s, "plans")[:8]:
            b = p.get("button") if isinstance(p.get("button"), dict) else {}
            plans.append({
                "name": _s(p.get("name"), 120), "price": _s(p.get("price"), 40), "period": _s(p.get("period"), 40),
                "description": _s(p.get("description"), 500),
                "features": [line.strip()[:500] for line in _s(p.get("features"), 20000).split("\n") if line.strip()][:40],
                "highlighted": bool(p.get("highlighted")),
                "button": {"label": _s(b.get("text"), 120), "href": _href(b.get("link"))},
                "offerUuid": _s(p.get("offer_uuid"), 100),
            })
        n = len(plans)
        return _section([_title(s.get("title"), center=True, extra={"marginBottom": 8 if s.get("subtitle") else 24}), _para(s.get("subtitle"), center=True, extra={"marginBottom": 40}), _node("pricing", {"plans": plans, "columns": _cols(n) if n else 3})], s, name="Pricing")
    if t == "steps":
        items = [{"title": _s(i.get("title"), 200), "text": _s(i.get("description"), 1500)} for i in _items(s)][:20]
        return _section([_title(s.get("title")), _node("steps", {"items": items, "layout": "vertical" if s.get("layout") == "vertical" else "horizontal"})], s, name="Steps")
    if t == "columns":
        items = _items(s)[:6]
        cols = [_node("container", {}, {}, [_node("richtext", {"markdown": _s(i.get("content"), 20000)})]) for i in items]
        return _section([_title(s.get("title")), _node("columns", {"ratio": "equal", "stackAt": "tablet"}, {"gap": 40}, cols)], s, name="Columns")
    if t == "image":
        img = s.get("image") if isinstance(s.get("image"), dict) else {}
        if not _src(img.get("url")):
            return None
        base = {"width": "100%"}
        if s.get("rounded"):
            base.update({"borderRadius": 16, "boxShadow": "sm"})
        return _section([_node("image", {"src": _src(img.get("url")), "alt": _s(img.get("alt"), 300), "href": _href(s.get("link")), "caption": _s(s.get("caption"), 300)}, base)], s, name="Image")
    if t == "embed":
        url = _s(s.get("url"), 2000).strip()
        if not url.lower().startswith("https://"):
            return None
        try:
            height = max(200, min(1600, int(s.get("height") or 600)))
        except (TypeError, ValueError):
            height = 600
        return _section([_title(s.get("title")), _node("embed", {"url": url, "title": _s(s.get("title"), 200), "height": height}, {"borderRadius": 12, "boxShadow": "sm", "overflow": "hidden"})], s, name="Embed")
    if t == "banner":
        kids = [_node("text", {"text": _s(s.get("text"))}, {"fontSize": 14, "fontWeight": "500"})]
        if _s(s.get("linkText")):
            kids.append(_node("button", {"label": _s(s.get("linkText"), 120), "href": _href(s.get("link")), "variant": "link", "size": "sm"}, {"color": "currentColor", "fontWeight": "600", "textDecoration": "underline"}))
        bar = _node("container", {}, {"backgroundColor": _color(s.get("background")) or "#0f172a", "color": _color(s.get("textColor")) or "#ffffff", "borderRadius": 8, "paddingTop": 10, "paddingBottom": 10, "paddingLeft": 16, "paddingRight": 16, "display": "flex", "flexWrap": "wrap", "justifyContent": "center", "alignItems": "center", "gap": 12, "textAlign": "center"}, kids)
        return _section([bar], s, pad=0, name="Banner", inner_extra={"paddingTop": 12})
    if t == "countdown":
        return _section([
            _title(s.get("heading"), center=True, extra={"marginBottom": 8}),
            _para(s.get("text"), center=True),
            _node("countdown", {"target": _iso(s.get("target")), "doneText": _s(s.get("doneText"), 300)}, {"marginTop": 32}),
            _buttons(s.get("buttons")),
        ], s, name="Countdown", inner_extra={"alignItems": "center"})
    return None


def _widen(nodes: list) -> None:
    for n in nodes:
        base = (n.get("style") or {}).get("base") or {}
        if base.get("maxWidth") == FRAME:
            base["maxWidth"] = FRAME_WIDE
        _widen(n.get("children") or [])


def convert_landing(landing: Any) -> dict:
    """The builder document equivalent to a legacy landing object."""
    landing = landing if isinstance(landing, dict) else {}
    sections = [s for s in (landing.get("sections") or []) if isinstance(s, dict)]
    settings = landing.get("settings") if isinstance(landing.get("settings"), dict) else {}
    theme = Theme(width="wide" if settings.get("width") == "wide" else "normal").model_dump(mode="json")
    theme["colors"]["text"] = "#111827"
    root = []
    for s in sections:
        try:
            node = convert_section(s)
        except Exception:  # noqa: BLE001 - one broken legacy section must not block the upgrade
            node = None
        if node is not None:
            root.append(node)
    gap = {"small": 16, "medium": 40}.get(settings.get("gap") or "none", 0)
    if gap:
        for node in root[1:]:
            node.setdefault("style", {}).setdefault("base", {})["marginTop"] = gap
    # The classic landing sits on the org theme's page background.
    page: dict[str, Any] = {"background": "transparent"}
    bg = _bg_style(settings.get("background"))
    if bg.get("backgroundColor"):
        page["background"] = bg["backgroundColor"]
    if bg.get("backgroundGradient"):
        page["backgroundGradient"] = bg["backgroundGradient"]
    if bg.get("backgroundImage"):
        page["backgroundImage"] = bg["backgroundImage"]
    doc = {"schema": SCHEMA, "version": SCHEMA_VERSION, "theme": theme, "page": page, "symbols": {}, "root": root, }
    if settings.get("width") == "wide":
        _widen(root)
    return validate_doc(doc, caps={"custom_code"})
