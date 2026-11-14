"""The classic custom landing -> page builder converter (src/services/landing/convert.py).

Every legacy section type and every field it renders must come across; values
the classic renderer would neutralise (unsafe links, bad colors) are
neutralised the same way, and the result always validates."""

import copy

from src.services.landing import convert
from src.services.landing.convert import convert_landing, convert_section
from src.services.landing.schema import validate_doc

BTN = {"text": "Go", "link": "/courses", "color": "#111111", "background": "#ffffff"}
THEME_BTN = {"text": "Theme", "link": "javascript:alert(1)", "color": "", "background": ""}

LEGACY = {
    "enabled": True,
    "settings": {"background": {"type": "solid", "color": "#fafafa"}, "width": "wide", "gap": "small"},
    "sections": [
        {
            "type": "hero", "title": "Hero", "height": "large", "overlay": 40, "contentAlign": "left",
            "background": {"type": "gradient", "colors": ["#0F3D3E", "#14746F", "#1a1a1a"], "direction": "135deg"},
            "heading": {"text": "Learn", "color": "#ffffff", "size": "large"},
            "subheading": {"text": "Sub", "color": "#eeeeee", "size": "medium"},
            "buttons": [BTN, THEME_BTN],
            "illustration": {"image": {"url": "https://x.y/i.png", "alt": "I"}, "position": "right", "verticalAlign": "top", "size": "small"},
            "visibility": "logged_out", "device": "desktop", "showFrom": "2026-01-01T00:00", "showUntil": "not a date",
            "style": {"anchor": "#Top Hero!", "animation": "fade", "spacing": "large", "background": {"type": "image", "image": "https://x.y/bg.png"}, "textColor": "#123456", "titleAlign": "center", "width": "narrow"},
        },
        {"type": "hero", "title": "H2", "background": {"type": "image", "image": "https://x.y/b.png"}, "heading": {"text": "x", "color": "bad"}, "subheading": {"text": ""}, "buttons": [],
         "illustration": {"image": {"url": "https://x.y/i.png", "alt": ""}, "position": "left", "verticalAlign": "bottom", "size": "medium"}, "overlay": "lots", "height": "screen"},
        {"type": "hero", "title": "H3", "background": {"type": "solid", "color": "#ffffff"}, "heading": {"text": "x"}, "subheading": {"text": "y"}, "buttons": [], "illustration": {"image": {"url": "", "alt": ""}}},
        {"type": "text-and-image", "title": "TI", "text": "Body", "flow": "right", "image": {"url": "https://x.y/t.png", "alt": "t"}, "buttons": [BTN], "hidden": True},
        {"type": "text-and-image", "title": "TI2", "text": "Body", "flow": "left", "image": {"url": "", "alt": ""}, "buttons": [], "device": "mobile"},
        {"type": "logos", "title": "Logos", "logos": [{"url": "https://x.y/l.png", "alt": "L"}, {"url": "javascript:x", "alt": "bad"}, "junk"]},
        {"type": "people", "title": "People", "people": [{"name": "Ann", "description": "Teacher", "image_url": "https://x.y/a.png", "username": "ann"}]},
        {"type": "featured-courses", "title": "Picked", "courses": [{"course_uuid": "course_1"}, "course_2", {"x": 1}, 5]},
        {"type": "featured-courses", "title": "Latest", "mode": "latest", "limit": "lots", "courses": []},
        {"type": "featured-courses", "title": "Latest2", "mode": "latest", "limit": 3, "courses": []},
        {"type": "video", "title": "Video", "description": "Watch", "url": "https://youtu.be/abc"},
        {"type": "rich-text", "title": "Rich", "content": "# Hi", "align": "center"},
        {"type": "rich-text", "title": "", "content": "plain", "align": "left"},
        {"type": "features", "title": "F", "subtitle": "Sub", "columns": 4, "items": [{"icon": "🚀", "title": "A", "description": "B"}]},
        {"type": "features", "title": "F2", "subtitle": "", "columns": 9, "items": []},
        {"type": "stats", "title": "S", "items": [{"value": "10", "label": "x"}], "style": {"titleAlign": "center", "anchor": "--"}},
        {"type": "testimonials", "title": "T", "items": [{"quote": "Q", "author": "A", "role": "R", "image_url": ""}]},
        {"type": "faq", "title": "FAQ", "items": [{"question": "Q", "answer": "A"}]},
        {"type": "cta", "heading": "Join", "text": "Now", "background": {"type": "gradient", "colors": ["#000000", "#ffffff"]}, "textColor": "#ffffff", "buttons": [BTN]},
        {"type": "cta", "heading": "Join2", "text": "", "background": {"type": "gradient", "colors": ["#000000", "#ffffff"], "direction": "sideways"}, "textColor": "", "buttons": []},
        {"type": "gallery", "title": "G", "columns": 2, "images": [{"url": "https://x.y/g.png", "alt": "g"}]},
        {"type": "gallery", "title": "Empty", "columns": 3, "images": [{"url": "", "alt": ""}]},
        {"type": "spacer", "size": "large", "divider": True, "visibility": "logged_in"},
        {"type": "spacer", "size": "tiny", "divider": False},
        {"type": "pricing", "title": "P", "subtitle": "Plans", "plans": [
            {"name": "Pro", "price": "$9", "period": "/mo", "description": "D", "features": "One\n\nTwo\n", "highlighted": True, "button": {"text": "Buy", "link": "/store"}, "offer_uuid": "offer_1"},
            {"name": "Free", "price": "$0", "period": "", "description": "", "features": "", "highlighted": False, "button": "bad"},
        ]},
        {"type": "pricing", "title": "P0", "subtitle": "", "plans": []},
        {"type": "steps", "title": "Steps", "layout": "vertical", "items": [{"title": "1", "description": "d"}]},
        {"type": "steps", "title": "Steps2", "layout": "horizontal", "items": []},
        {"type": "columns", "title": "Cols", "items": [{"content": "a"}, {"content": "b"}]},
        {"type": "image", "image": {"url": "https://x.y/im.png", "alt": "im"}, "caption": "Cap", "link": "/x", "rounded": True},
        {"type": "image", "image": {"url": "https://x.y/im.png", "alt": "im"}, "caption": "", "link": "", "rounded": False},
        {"type": "image", "image": {"url": "", "alt": ""}, "caption": "", "link": "", "rounded": False},
        {"type": "embed", "title": "Cal", "url": "https://calendly.com/x", "height": 9999},
        {"type": "embed", "title": "Bad", "url": "http://evil.com", "height": 400},
        {"type": "embed", "title": "Weird", "url": "https://tally.so/x", "height": "tall"},
        {"type": "banner", "text": "Sale", "linkText": "Shop", "link": "/store", "background": "#ff0000", "textColor": "#ffffff"},
        {"type": "banner", "text": "Plain", "linkText": "", "link": "", "background": "", "textColor": ""},
        {"type": "countdown", "heading": "Soon", "text": "Wait", "target": "2027-01-01T10:00", "doneText": "Done", "buttons": [BTN]},
        {"type": "unknown-type"},
        "not a section",
        {"type": "hero", "heading": "boom"},
    ],
}


def _all(doc):
    out = []

    def visit(n):
        out.append(n)
        for c in n.get("children") or []:
            visit(c)

    for n in doc["root"]:
        visit(n)
    return out


def _find(doc, type_, **props):
    for n in _all(doc):
        if n["type"] == type_ and all(n["props"].get(k) == v for k, v in props.items()):
            return n
    raise AssertionError(f"no {type_} with {props}")


def test_full_legacy_landing_converts_and_validates():
    original = copy.deepcopy(LEGACY)
    doc = convert_landing(LEGACY)
    assert LEGACY == original  # never mutated
    validate_doc(doc, caps={"custom_code"})
    assert doc["page"]["background"] == "#fafafa"
    # Every convertible section came across (not the empty gallery/image, bad embed or junk).
    assert len(doc["root"]) == 36
    hero = doc["root"][0]
    assert hero["visibility"] == "logged_out" and hero["hidden"]["mobile"] and hero["anchor"] == "top-hero"
    assert hero["schedule"] == {"from": "2026-01-01T00:00"} and hero["animation"]["type"] == "fade"
    assert hero["style"]["base"]["backgroundImage"] == "https://x.y/bg.png" and hero["style"]["base"]["color"] == "#123456"
    assert hero["children"][0]["style"]["base"]["maxWidth"] == "896px"
    heading = _find(doc, "heading", text="Learn")
    assert heading["style"]["base"]["color"] == "#ffffff"
    card = hero["children"][0]["children"][0]
    assert card["style"]["base"]["minHeight"] == 680 and card["style"]["base"]["overlayOpacity"] == 40
    assert card["style"]["base"]["backgroundGradient"] == {"from": "#0F3D3E", "to": "#1a1a1a", "via": "#14746F", "angle": 135}
    cols = card["children"][0]
    assert cols["type"] == "columns" and cols["props"]["ratio"] == "3:1"
    go = _find(doc, "button", label="Go")
    assert go["props"]["href"] == "/courses" and go["style"]["base"]["backgroundColor"] == "#ffffff"
    theme_btn = _find(doc, "button", label="Theme")
    assert theme_btn["props"]["href"] == "" and "backgroundColor" not in theme_btn["style"]["base"]
    # Second hero: left illustration, bad colors dropped, screen height.
    h2 = doc["root"][1]["children"][0]["children"][0]
    assert h2["style"]["base"]["minHeight"] == "85vh" and h2["children"][0]["props"]["ratio"] == "1:2"
    assert "overlayOpacity" not in h2["style"]["base"]
    assert doc["root"][3]["hidden"] == {"desktop": True, "tablet": True, "mobile": True}
    assert doc["root"][4]["hidden"] == {"desktop": True, "tablet": True, "mobile": False}
    logos = _find(doc, "logos")
    assert [lg["src"] for lg in logos["props"]["items"]] == ["https://x.y/l.png"]
    people = _find(doc, "instructors")
    assert people["props"]["people"][0] == {"name": "Ann", "role": "Teacher", "bio": "", "image": "https://x.y/a.png", "username": "ann", "href": ""}
    picked = _find(doc, "courses", source="selected")
    assert picked["props"]["courseUuids"] == ["course_1", "course_2"]
    latest = [n for n in _all(doc) if n["type"] == "courses" and n["props"]["source"] == "latest"]
    assert [n["props"]["limit"] for n in latest] == [8, 3]
    features = _find(doc, "features", columns=4)
    assert features["props"]["items"][0]["emoji"] == "🚀"
    pricing = _find(doc, "pricing", columns=2)
    plan = pricing["props"]["plans"][0]
    assert plan["features"] == ["One", "Two"] and plan["offerUuid"] == "offer_1" and plan["highlighted"]
    assert pricing["props"]["plans"][1]["button"] == {"label": "", "href": ""}
    assert _find(doc, "steps", layout="vertical")
    assert _find(doc, "image", caption="Cap")["props"]["href"] == "/x"
    assert _find(doc, "embed", url="https://calendly.com/x")["props"]["height"] == 1600
    assert _find(doc, "embed", url="https://tally.so/x")["props"]["height"] == 600
    banner_link = _find(doc, "button", label="Shop")
    assert banner_link["props"]["variant"] == "link"
    assert _find(doc, "countdown")["props"]["target"] == "2027-01-01T10:00"
    # Page gap between sections.
    assert doc["root"][1]["style"]["base"]["marginTop"] == 16
    # Wide pages get the wide frame.
    assert any((n.get("style") or {}).get("base", {}).get("maxWidth") == convert.FRAME_WIDE for n in _all(doc))


def test_defaults_and_empty_inputs():
    assert convert_landing(None)["root"] == []
    assert convert_landing({"sections": "x", "settings": "y"})["root"] == []
    doc = convert_landing({"sections": [{"type": "spacer"}], "settings": {"gap": "medium", "background": {"type": "gradient", "colors": ["#000", "#fff"]}}})
    assert doc["page"]["background"] == "transparent" and doc["root"][0]["type"] == "section"
    assert convert_section({"type": "nope"}) is None


def test_page_backgrounds_carry_over():
    grad = convert_landing({"sections": [], "settings": {"background": {"type": "gradient", "colors": ["#000000", "#ffffff"], "direction": "90deg"}}})
    assert grad["page"]["backgroundGradient"] == {"from": "#000000", "to": "#ffffff", "angle": 90}
    img = validate_doc(convert_landing({"sections": [], "settings": {"background": {"type": "image", "image": "https://x.io/bg.png"}}}))
    assert img["page"]["backgroundImage"] == "https://x.io/bg.png" and img["page"]["background"] == "transparent"


def test_helpers_neutralise_bad_values():
    assert convert._s(None) == "" and convert._s(12) == "12" and convert._s("abc", 2) == "ab"
    assert convert._bg_style("x") == {} and convert._bg_style({"type": "image", "image": "javascript:x"}) == {}
    assert convert._bg_style({"type": "solid", "color": "nope"}) == {}
    assert convert._bg_style({"type": "pattern"}) == {}
    assert convert._bg_style({"type": "gradient", "colors": ["#000"]}) == {}
    assert convert._button("x") is None and convert._buttons("nope") is None
    assert convert._title("") is None and convert._para(None) is None
    assert convert._image({"url": ""}) is None
    assert convert._image({"url": "/a.png", "alt": "a"})["props"]["src"] == "/a.png"
    assert convert._iso("2026-02-30") is None
    assert convert._items({"items": "x"}) == []


def test_one_broken_section_does_not_block_the_rest(monkeypatch):
    real = convert.convert_section

    def flaky(s):
        if s.get("title") == "boom":
            raise RuntimeError("bad")
        return real(s)

    monkeypatch.setattr(convert, "convert_section", flaky)
    doc = convert_landing({"sections": [{"type": "faq", "title": "boom", "items": []}, {"type": "faq", "title": "ok", "items": []}]})
    assert len(doc["root"]) == 1
