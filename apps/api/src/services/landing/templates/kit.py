"""A small vocabulary for writing page templates by hand.

Templates are designed node trees (not recipe output): each has its own
palette, type and rhythm. These helpers keep them readable. Colors use theme
tokens ($primary, $surface...) wherever the design allows, so a section lifted
into another page (the section library) takes that page's colors.
"""

from __future__ import annotations

from typing import Any, Optional

from src.services.landing.recipes import el

Style = dict[str, Any]


def rs(base: Optional[Style] = None, tablet: Optional[Style] = None, mobile: Optional[Style] = None, hover: Optional[Style] = None) -> Optional[dict]:
    out = {}
    for key, value in (("base", base), ("tablet", tablet), ("mobile", mobile), ("hover", hover)):
        clean = {k: v for k, v in (value or {}).items() if v is not None}
        if clean:
            out[key] = clean
    return out or None


def anim(kind: str = "slide-up", delay: int = 0, duration: int = 700) -> dict:
    return {"type": kind, "delay": delay, "duration": duration}


def section(children: list, *, name: str, base: Optional[Style] = None, tablet: Optional[Style] = None, mobile: Optional[Style] = None,
            inner: Optional[Style] = None, inner_mobile: Optional[Style] = None, anchor: Optional[str] = None, pad: tuple[int, int] = (112, 112),
            mpad: tuple[int, int] = (72, 72), width: Any = "content") -> dict:
    """A full-width band holding one centered content column."""
    sbase = {"paddingTop": pad[0], "paddingBottom": pad[1], "paddingLeft": 32, "paddingRight": 32, **(base or {})}
    smobile = {"paddingTop": mpad[0], "paddingBottom": mpad[1], "paddingLeft": 20, "paddingRight": 20, **(mobile or {})}
    stablet = {"paddingTop": round(pad[0] * 0.8), "paddingBottom": round(pad[1] * 0.8), **(tablet or {})}
    col = el("container", {}, rs(
        {"maxWidth": width, "marginLeft": "auto", "marginRight": "auto", "width": "100%", "display": "flex", "flexDirection": "column", "gap": 56, **(inner or {})},
        mobile={"gap": 36, **(inner_mobile or {})},
    ), children)
    return el("section", {"tag": "section"}, rs(sbase, stablet, smobile), [col], name=name, anchor=anchor)


def box(children: list, *, base: Optional[Style] = None, tablet: Optional[Style] = None, mobile: Optional[Style] = None, hover: Optional[Style] = None, name: Optional[str] = None, animation: Optional[dict] = None, href: str = "") -> dict:
    props = {"href": href} if href else {}
    return el("container", props, rs({"display": "flex", "flexDirection": "column", **(base or {})}, tablet, mobile, hover), children, name=name, animation=animation)


def row(children: list, *, gap: Any = 16, base: Optional[Style] = None, mobile: Optional[Style] = None, wrap: bool = True, name: Optional[str] = None) -> dict:
    return el("container", {}, rs({"display": "flex", "flexDirection": "row", "flexWrap": "wrap" if wrap else "nowrap", "alignItems": "center", "gap": gap, **(base or {})}, mobile=mobile), children, name=name)


def cols(columns: list, *, ratio: str = "equal", stack: str = "tablet", gap: Any = 64, base: Optional[Style] = None, mobile: Optional[Style] = None, name: Optional[str] = None) -> dict:
    return el("columns", {"ratio": ratio, "stackAt": stack}, rs({"gap": gap, "alignItems": "center", **(base or {})}, mobile={"gap": 40, **(mobile or {})}), columns, name=name)


def h(text: str, level: int = 2, *, base: Optional[Style] = None, tablet: Optional[Style] = None, mobile: Optional[Style] = None, animation: Optional[dict] = None) -> dict:
    return el("heading", {"text": text, "level": level}, rs({"fontFamily": "heading", **(base or {})}, tablet, mobile), animation=animation)


def t(text: str, *, base: Optional[Style] = None, mobile: Optional[Style] = None, animation: Optional[dict] = None) -> dict:
    return el("text", {"text": text}, rs(base, mobile=mobile), animation=animation)


def eyebrow(text: str, *, color: str = "$primary", base: Optional[Style] = None, font: Optional[str] = None) -> dict:
    return t(text, base={"fontSize": 12, "fontWeight": "600", "letterSpacing": "0.16em", "textTransform": "uppercase", "color": color, **({"fontFamily": font} if font else {}), **(base or {})})


def btn(label: str, href: str, variant: str = "primary", *, size: str = "lg", icon: Optional[str] = None, base: Optional[Style] = None, hover: Optional[Style] = None) -> dict:
    props: dict[str, Any] = {"label": label, "href": href, "variant": variant, "size": size}
    if icon:
        props["icon"] = icon
    return el("button", props, rs(base, hover=hover))


def img(src: str, alt: str, *, base: Optional[Style] = None, mobile: Optional[Style] = None, animation: Optional[dict] = None) -> dict:
    return el("image", {"src": src, "alt": alt}, rs({"width": "100%", **(base or {})}, mobile=mobile), animation=animation)


def icon(name: str, *, size: int = 28, weight: str = "duotone", color: Optional[str] = None) -> dict:
    return el("icon", {"name": name, "size": size, "weight": weight}, rs({"color": color} if color else None))


def divider(color: str = "$border") -> dict:
    return el("divider", {}, rs({"borderColor": color}))


def courses(*, limit: int = 6, columns: int = 3, card: str = "minimal", layout: str = "grid", desc: bool = True, empty: str = "New courses are on their way.") -> dict:
    return el("courses", {"source": "latest", "limit": limit, "columns": columns, "cardStyle": card, "layout": layout, "showDescription": desc, "emptyText": empty})


def heading_group(eyebrow_text: str, title: str, sub: str = "", *, align: str = "start", size: Any = "3rem", msize: Any = "2.1rem", max_width: Any = "720px",
                  eyebrow_color: str = "$primary", eyebrow_font: Optional[str] = None, title_style: Optional[Style] = None, sub_style: Optional[Style] = None) -> dict:
    center = align == "center"
    kids = []
    if eyebrow_text:
        kids.append(eyebrow(eyebrow_text, color=eyebrow_color, font=eyebrow_font, base={"textAlign": align}))
    kids.append(h(title, 2, base={"fontSize": size, "lineHeight": 1.08, "letterSpacing": "-0.025em", "textAlign": align, **(title_style or {})}, mobile={"fontSize": msize}))
    if sub:
        kids.append(t(sub, base={"fontSize": "1.125rem", "lineHeight": 1.65, "color": "$muted", "textAlign": align, "maxWidth": "620px",
                                 **({"marginLeft": "auto", "marginRight": "auto"} if center else {}), **(sub_style or {})}, mobile={"fontSize": "1rem"}))
    return box(kids, base={"gap": 16, "maxWidth": max_width, **({"marginLeft": "auto", "marginRight": "auto", "alignItems": "center"} if center else {})},
               animation=anim("slide-up"))


def stat(value: str, label: str, *, value_style: Optional[Style] = None, label_style: Optional[Style] = None) -> dict:
    return box([
        t(value, base={"fontFamily": "heading", "fontSize": "3rem", "fontWeight": "600", "letterSpacing": "-0.03em", "lineHeight": 1, **(value_style or {})}, mobile={"fontSize": "2.25rem"}),
        t(label, base={"fontSize": 14, "color": "$muted", "lineHeight": 1.5, **(label_style or {})}),
    ], base={"gap": 10, "flexGrow": 1})


def feature(icon_name: str, title: str, text: str, *, tile: Optional[Style] = None, card: Optional[Style] = None, icon_color: str = "$primary") -> dict:
    return box([
        box([icon(icon_name, size=24, color=icon_color)], base={"width": 48, "height": 48, "alignItems": "center", "justifyContent": "center", "borderRadius": 12,
                                                             "backgroundColor": "$surface", **(tile or {})}),
        h(title, 3, base={"fontSize": "1.25rem", "lineHeight": 1.3, "fontWeight": "600"}),
        t(text, base={"fontSize": 15, "lineHeight": 1.65, "color": "$muted"}),
    ], base={"gap": 14, "flexGrow": 1, **(card or {})})


def page(theme: dict, root: list, *, background: Optional[str] = None, title: str = "", description: str = "") -> dict:
    from src.services.landing.schema import SCHEMA, SCHEMA_VERSION

    page_settings: dict[str, Any] = {}
    if background:
        page_settings["background"] = background
    if title:
        page_settings["title"] = title
    if description:
        page_settings["description"] = description
    return {"schema": SCHEMA, "version": SCHEMA_VERSION, "theme": theme, "page": page_settings, "symbols": {}, "root": root}


def theme(*, primary: str, secondary: str, accent: str, background: str, surface: str, text: str, muted: str, border: str,
          heading: str, body: str, radius: str = "lg", button: str = "solid", width: str = "normal", density: str = "comfortable", weight: str = "700",
          dark: Optional[dict] = None) -> dict:
    out = {
        "colors": {"primary": primary, "secondary": secondary, "accent": accent, "background": background, "surface": surface, "text": text, "muted": muted, "border": border},
        "fonts": {"heading": heading, "body": body},
        "radius": radius, "buttonStyle": button, "width": width, "density": density, "headingWeight": weight,
    }
    if dark:
        out["dark"] = dark
    return out


def art(name: str) -> str:
    # Root-level files in apps/web/public are served as is (the web proxy
    # skips paths with an extension at the top level only).
    return f"/landing-t-{name}.svg"
