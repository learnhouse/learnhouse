"""Landing page builder: the document validator, the custom code sanitizer,
recipes, templates and tree edits (src/services/landing)."""

import json

import pytest

from src.services.landing import recipes, schema, tree
from src.services.landing.sanitize import safe_url, sanitize_css, sanitize_html
from src.services.landing.schema import DocError, validate_doc


def _doc(*root, **kw):
    return {"schema": "lh.page", "version": 1, "root": list(root), **kw}


def _section(*children, **kw):
    return {"id": kw.pop("id", "s1"), "type": "section", "props": {}, "children": list(children), **kw}


def _errors(raw, caps=None):
    with pytest.raises(DocError) as e:
        validate_doc(raw, caps=caps)
    return e.value


# ─── value checks ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("value,ok", [(24, True), (-10.5, True), ("2rem", True), ("1.0625rem", True), ("60%", True), ("80vh", True),
                                       ("auto", False), ("calc(1px)", False), ("1px;color:red", False), (True, False), (20000, False), ([], False)])
def test_check_length(value, ok):
    if ok:
        assert schema.check_length(value) == (value.strip() if isinstance(value, str) else value)
    else:
        with pytest.raises(ValueError):
            schema.check_length(value)
    assert schema.check_length(None) is None
    assert schema.check_length("auto", allow_auto=True) == "auto"


@pytest.mark.parametrize("value,ok", [("#fff", True), ("#1a2b3c", True), ("#1a2b3c80", True), ("rgba(0, 0, 0, 0.5)", True), ("rgb(1,2,3)", True),
                                       ("$primary", True), ("$on-primary", True), ("transparent", True), ("currentColor", True),
                                       ("red", False), ("$nope", False), ("url(x)", False), ("#12", False), (12, False)])
def test_check_color(value, ok):
    if ok:
        assert schema.check_color(value) == value
    else:
        with pytest.raises(ValueError):
            schema.check_color(value)
    assert schema.check_color(None) is None


@pytest.mark.parametrize("value,expected", [("", ""), ("  ", ""), ("#pricing", "#pricing"), ("/courses", "/courses"), ("https://x.y/z", "https://x.y/z"),
                                             ("mailto:a@b.c", "mailto:a@b.c"), ("tel:+1 555", "tel:+1 555"), (None, "")])
def test_check_href_accepts(value, expected):
    assert schema.check_href(value) == expected


@pytest.mark.parametrize("value", ["javascript:alert(1)", "//evil.com", "data:text/html,x", "vbscript:x", "https://a b.com", "ftp://x"])
def test_check_href_refuses(value):
    with pytest.raises(ValueError):
        schema.check_href(value)


def test_check_src_and_iso():
    assert schema.check_src("/img.png") == "/img.png"
    assert schema.check_src("https://cdn.x/y.png") == "https://cdn.x/y.png"
    assert schema.check_src(None) == ""
    for bad in ("javascript:x", "//x", "data:image/png;base64,AAA", "https://a b"):
        with pytest.raises(ValueError):
            schema.check_src(bad)
    assert schema.check_iso("2026-12-01T09:00") == "2026-12-01T09:00"
    assert schema.check_iso("2026-12-01T09:00:00Z") == "2026-12-01T09:00:00Z"
    assert schema.check_iso("") is None
    with pytest.raises(ValueError):
        schema.check_iso("next week")


def test_check_slug():
    assert schema.check_slug("") == "" and schema.check_slug("home") == ""
    assert schema.check_slug(" About-Us ") == "about-us"
    for bad in ("a b", "-x", "x-", "ü"):
        with pytest.raises(ValueError):
            schema.check_slug(bad)


# ─── documents ────────────────────────────────────────────────────────────────


def test_empty_and_minimal_documents():
    out = validate_doc({})
    assert out["root"] == [] and out["theme"]["colors"]["primary"] == "brand" and out["symbols"] == {}
    assert validate_doc(schema.empty_doc()) == schema.empty_doc()


def test_full_node_round_trip():
    node = {
        "id": "h1", "type": "heading", "name": "Title", "props": {"text": "Hi", "level": 1},
        "style": {
            "base": {"fontSize": "3rem", "color": "$primary", "backgroundGradient": {"from": "#000", "to": "$secondary", "angle": 90, "via": "#111"}, "maxWidth": "content", "marginLeft": "auto"},
            "tablet": {"fontSize": 40},
            "mobile": {"fontSize": 28, "textAlign": "center"},
            "hover": {"color": "#ff0000", "scale": 1.05},
        },
        "hidden": {"mobile": True}, "visibility": "logged_out", "schedule": {"from": "2026-01-01T00:00", "until": "2027-01-01T00:00"},
        "animation": {"type": "fade", "delay": 100, "duration": 400}, "anchor": "top",
    }
    out = validate_doc(_doc(_section(node)))
    got = out["root"][0]["children"][0]
    assert got["style"]["base"]["backgroundGradient"] == {"from": "#000", "to": "$secondary", "via": "#111", "angle": 90}
    assert got["hidden"] == {"desktop": False, "tablet": False, "mobile": True}
    assert got["visibility"] == "logged_out" and got["anchor"] == "top" and got["name"] == "Title"
    assert got["schedule"] == {"from": "2026-01-01T00:00", "until": "2027-01-01T00:00"}
    # Defaults that carry nothing are dropped; "everyone" is the default.
    plain = validate_doc(_doc(_section({"id": "t", "type": "text", "props": {}, "hidden": {}, "visibility": "everyone", "anchor": "", "name": ""})))
    assert set(plain["root"][0]["children"][0]) == {"id", "type", "props"}


@pytest.mark.parametrize(
    "raw,needle",
    [
        ("nope", "JSON object"),
        ({"schema": "x"}, "schema"),
        ({"version": 2}, "unsupported version"),
        ({"extra": 1}, "unknown keys"),
        ({"theme": {"colors": {"primary": "red"}}}, "theme.colors.primary"),
        ({"theme": {"radius": "huge"}}, "theme.radius"),
        ({"page": {"background": "red"}}, "page.background"),
        ({"page": {"backgroundImage": "javascript:x"}}, "page.backgroundImage"),
        ({"symbols": []}, "symbols"),
        ({"root": {}}, "root"),
        (_doc({"id": "x", "type": "heading", "props": {}}), "wrap this in a section"),
        (_doc("nope"), "must be an object"),
        (_doc(_section(id="bad id")), "letters, digits"),
        (_doc(_section(id="a"), _section(id="a")), "duplicate id"),
        (_doc(_section({"id": "u", "type": "marquee", "props": {}})), "unknown element type"),
        (_doc(_section({"id": "u", "type": "text", "props": {"text": "x", "color": "red"}})), "props.color"),
        (_doc(_section({"id": "u", "type": "text", "props": "x"})), "props: must be an object"),
        (_doc(_section({"id": "u", "type": "text", "props": {}, "bogus": 1})), "unknown keys: bogus"),
        (_doc(_section({"id": "u", "type": "text", "props": {}, "name": 5})), "up to 80 characters"),
        (_doc(_section({"id": "u", "type": "text", "props": {}, "visibility": "admins"})), "visibility"),
        (_doc(_section({"id": "u", "type": "text", "props": {}, "anchor": "Bad Anchor"})), "anchor"),
        (_doc(_section({"id": "u", "type": "text", "props": {}, "children": [{"id": "v", "type": "text", "props": {}}]})), "cannot contain"),
        (_doc(_section({"id": "u", "type": "container", "props": {}, "children": "x"})), "must be a list"),
        (_doc(_section({"id": "u", "type": "container", "props": {}, "children": [_section(id="s2")]})), "top level"),
        (_doc(_section({"id": "u", "type": "columns", "props": {}, "children": [{"id": f"c{i}", "type": "container", "props": {}} for i in range(7)]})), "at most 6"),
        (_doc(_section({"id": "u", "type": "text", "props": {}, "style": "x"})), "base / tablet / mobile"),
        (_doc(_section({"id": "u", "type": "text", "props": {}, "style": {"desktop": {}}})), "style.desktop"),
        (_doc(_section({"id": "u", "type": "text", "props": {}, "style": {"base": {"position": "fixed"}}})), "style.base.position"),
        (_doc(_section({"id": "u", "type": "text", "props": {}, "style": {"base": {"color": "expression(alert(1))"}}})), "hex color"),
        (_doc(_section({"id": "u", "type": "text", "props": {}, "style": {"base": {"backgroundImage": "javascript:x"}}})), "http(s)"),
        (_doc(_section({"id": "u", "type": "text", "props": {}, "schedule": {"from": "soon"}})), "schedule.from"),
        (_doc(_section({"id": "u", "type": "text", "props": {}, "animation": {"type": "spin"}})), "animation.type"),
        (_doc(_section({"id": "u", "type": "button", "props": {"href": "javascript:alert(1)"}})), "props.href"),
        (_doc(_section({"id": "u", "type": "embed", "props": {"url": "http://youtube.com"}})), "https://"),
        (_doc(_section({"id": "u", "type": "list", "props": {"items": ["x" * 501]}})), "500 characters"),
        (_doc(_section({"id": "u", "type": "form", "props": {"fields": [{"key": "a"}, {"key": "a"}]}})), "unique"),
        (_doc(_section({"id": "u", "type": "symbol", "props": {"symbolId": "missing"}})), "no symbol"),
    ],
)
def test_invalid_documents_name_the_problem(raw, needle):
    err = _errors(raw)
    assert needle in str(err), str(err)
    detail = err.as_detail()
    assert detail["code"] == "invalid_page" and detail["errors"]


def test_hover_keeps_only_allowed_keys_and_reports():
    err = _errors(_doc(_section({"id": "u", "type": "text", "props": {}, "style": {"hover": {"color": "#fff", "width": 20}}})))
    assert "hover can only change" in str(err)


def test_error_message_is_capped():
    nodes = [{"id": f"n{i}", "type": "marquee", "props": {}} for i in range(12)]
    err = _errors(_doc(_section(*nodes)))
    assert "(+4 more)" in str(err)
    walker = schema._Walker(set(), set())
    for i in range(250):
        walker.err("x", "y")
    assert len(walker.errors) == 200


def test_custom_code_needs_its_capability():
    html = {"id": "c", "type": "html", "props": {"html": "<p onclick=x>hi</p><script>alert(1)</script>", "css": "@import url(x); p{color:red}"}}
    assert "Pro plan" in str(_errors(_doc(_section(html))))
    out = validate_doc(_doc(_section(html)), caps={"custom_code"})
    props = out["root"][0]["children"][0]["props"]
    assert props["html"] == "<p>hi</p>" and "@import" not in props["css"] and "color:red" in props["css"]


def test_symbols():
    sym_node = {"id": "sym_root", "type": "container", "props": {}, "children": [{"id": "sym_t", "type": "text", "props": {"text": "Shared"}}]}
    doc = _doc(_section({"id": "inst", "type": "symbol", "props": {"symbolId": "sym1"}}), symbols={"sym1": {"name": "Card", "node": sym_node}})
    out = validate_doc(doc)
    assert out["symbols"]["sym1"]["name"] == "Card" and out["root"][0]["children"][0]["props"]["symbolId"] == "sym1"
    assert schema.element_types_used(out) >= {"section", "symbol", "container", "text"}
    seen = []
    schema.walk(out, lambda n, p: seen.append((n["id"], p["id"] if p else None)))
    assert ("sym_t", "sym_root") in seen and ("inst", "s1") in seen
    bad = [
        ({"bad id": {"name": "x", "node": sym_node}}, "symbol ids"),
        ({"s": {"name": "x"}, "t": "nope"}, "must be {name, node}"),
        ({"s": {"name": 5, "node": sym_node}}, "symbols.s.name"),
        ({"s": {"name": "x", "node": {"id": "i", "type": "symbol", "props": {"symbolId": "s"}}}}, "cannot contain another symbol"),
    ]
    for symbols, needle in bad:
        assert needle in str(_errors({"symbols": symbols})), needle
    many = {f"s{i}": {"name": "x", "node": {"id": f"n{i}", "type": "text", "props": {}}} for i in range(schema.MAX_SYMBOLS + 1)}
    assert "at most" in str(_errors({"symbols": many}))


def test_size_node_depth_and_section_limits(monkeypatch):
    huge = _doc(_section({"id": "t", "type": "richtext", "props": {"markdown": "x" * 19_000}}))
    big = {**huge, "root": [dict(huge["root"][0], id=f"s{i}", children=[dict(huge["root"][0]["children"][0], id=f"t{i}")]) for i in range(25)]}
    assert "the limit is" in str(_errors(big))
    circular: dict = {}
    circular["root"] = [circular]
    assert "not valid JSON" in str(_errors(circular))
    many = _doc(_section(*[{"id": f"t{i}", "type": "text", "props": {}} for i in range(schema.MAX_NODES + 5)]))
    assert "limited to" in str(_errors(many))
    deep = {"id": "c0", "type": "container", "props": {}, "children": []}
    cur = deep
    for i in range(1, schema.MAX_DEPTH + 2):
        nxt = {"id": f"c{i}", "type": "container", "props": {}, "children": []}
        cur["children"].append(nxt)
        cur = nxt
    assert "levels deep" in str(_errors(_doc(_section(deep))))
    sections = [_section(id=f"s{i}") for i in range(schema.MAX_ROOT + 1)]
    assert "top-level sections" in str(_errors(_doc(*sections)))


def test_every_element_type_validates_with_defaults():
    nodes = [{"id": f"n{i}", "type": t, "props": {"symbolId": "sx"} if t == "symbol" else {}} for i, t in enumerate(schema.ELEMENT_TYPES) if t != "section"]
    doc = _doc(_section(*nodes), symbols={"sx": {"name": "S", "node": {"id": "sxn", "type": "text", "props": {}}}})
    out = validate_doc(doc, caps={"custom_code"})
    assert len(out["root"][0]["children"]) == len(schema.ELEMENT_TYPES) - 1


def test_schema_summary_describes_every_element():
    summary = schema.schema_summary()
    assert set(summary["elements"]) == set(schema.ELEMENT_TYPES)
    assert summary["elements"]["html"]["plan"] == "pro"
    assert summary["elements"]["button"]["props"]["variant"] == "primary|secondary|outline|ghost|link"
    assert isinstance(summary["elements"]["pricing"]["props"]["plans"], list)
    assert "$primary" in summary["tokens"] and "Star" in summary["icons"]
    json.dumps(summary)
    assert schema._short_schema({"const": 3}, {}) == 3
    assert schema._short_schema({"anyOf": [{"type": "string"}, {"type": "integer"}]}, {}) == ["string", "integer"]


# ─── sanitizer ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "dirty,clean",
    [
        ("<p>Hello <b>world</b></p>", "<p>Hello <b>world</b></p>"),
        ("<script>alert(1)</script><p>x</p>", "<p>x</p>"),
        ("<img src=x onerror=alert(1)>", '<img src="x">'),
        ('<a href="javascript:alert(1)">x</a>', "<a>x</a>"),
        ('<a href="jav&#x09;ascript:alert(1)">x</a>', "<a>x</a>"),
        ('<a href=" JAVASCRIPT:alert(1)">x</a>', "<a>x</a>"),
        ('<a href="//evil.com">x</a>', "<a>x</a>"),
        ('<a href="https://ok.com" target="_blank">x</a>', '<a href="https://ok.com" target="_blank" rel="noopener noreferrer">x</a>'),
        ('<a href="/p" target="_top">x</a>', '<a href="/p">x</a>'),
        ("<iframe src=https://evil.com></iframe>ok", "ok"),
        ("<svg><script>alert(1)</script><path d='M0'/></svg>", '<svg><path d="M0"></path></svg>'),
        ('<div style="background:url(javascript:alert(1));color:red">x</div>', '<div style="color:red">x</div>'),
        ('<div style="background:url(http://x/y.png);color:red">x</div>', '<div style="background:none;color:red">x</div>'),
        ('<div style="width:expression(alert(1))">x</div>', "<div>x</div>"),
        ("<!-- <script>x</script> --><p>a</p>", "<p>a</p>"),
        ("<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>", ""),
        ("<form action=x><input name=a></form>t", "t"),
        ("<p>unclosed <b>bold", "<p>unclosed <b>bold</b></p>"),
        ("<b>x</p></b>", "<b>x</b>"),
        ("<br/><hr>", "<br><hr>"),
        ('<img srcset="https://a/1.png 1x, javascript:x 2x">', "<img>"),
        ('<img srcset="https://a/1.png 1x, /2.png 2x">', '<img srcset="https://a/1.png 1x, /2.png 2x">'),
        ("<div data-x='1' class='c'>&lt;tag&gt;</div>", '<div data-x="1" class="c">&lt;tag&gt;</div>'),
        ("<!DOCTYPE html><?xml x?><p>a</p>", "<p>a</p>"),
        ("<style>p{}</style><p>a</p>", "<p>a</p>"),
        ("<noscript><p>x</p></noscript>y", "y"),
        ("<span/>", "<span></span>"),
        ("", ""),
    ],
)
def test_sanitize_html(dirty, clean):
    assert sanitize_html(dirty) == clean


def test_sanitizer_handles_unknown_declarations():
    from src.services.landing.sanitize import _Cleaner

    c = _Cleaner()
    c.unknown_decl("CDATA[x")
    assert c.result() == ""


@pytest.mark.parametrize(
    "dirty,banned",
    [
        ("@import url('https://evil.com/x.css'); p{}", "@import"),
        ("p{width:expression(alert(1))}", "expression("),
        ("p{behavior:url(x.htc)}", "behavior"),
        ("p{-moz-binding:url(x)}", "-moz-binding"),
        ("p{background:url(javascript:alert(1))}", "javascript"),
        ("p{background:url('http://insecure.com/x.png')}", "insecure"),
        ("p{background:\\75 rl(javascript:alert(1))}", "javascript"),
        ("p{\\65 xpression(alert(1))}", "xpression("),
        ("</style><script>alert(1)</script>", "</style"),
        ("@charset 'x'; @namespace x; p{}", "@charset"),
        ("p{color:red}<!-- x -->", "<!--"),
        ("p{content:'vbscript:x'}", "vbscript"),
    ],
)
def test_sanitize_css_bypass_attempts(dirty, banned):
    assert banned.lower() not in sanitize_css(dirty).lower()


def test_sanitize_css_keeps_safe_urls_and_inline_braces():
    assert 'url("https://cdn.x/a.png")' in sanitize_css("p{background:url(https://cdn.x/a.png)}")
    assert 'url("/a.png")' in sanitize_css("p{background:url('/a.png')}")
    assert "data:image/png;base64,AAA" in sanitize_css("p{background:url(data:image/png;base64,AAA)}")
    assert sanitize_css("color:red;}body{x:y", inline=True) == "color:red;bodyx:y"
    assert sanitize_css("") == ""
    assert sanitize_css("p{a:\\110000 b}")  # an out-of-range escape is dropped, not raised


def test_safe_url():
    assert safe_url("") and safe_url("about") and safe_url("./x") and safe_url("#a") and safe_url("/p")
    assert not safe_url("//evil") and not safe_url("javascript:x") and not safe_url("data:x")


# ─── recipes and templates ────────────────────────────────────────────────────


def test_templates_and_library_always_validate():
    ctx = {"org_name": "Acme", "org_description": "We teach.", "year": 2026, "course_uuids": ["course_1"]}
    for tpl in recipes.TEMPLATES:
        doc = validate_doc(recipes.build_template(tpl["id"], ctx))
        assert doc["root"], tpl["id"]
    for entry in recipes.section_library(ctx):
        validate_doc({"root": [entry["node"]]})
    summaries = recipes.template_summaries()
    # The designed gallery plus the simple catalog home; the first recipe
    # templates are only listed on request (they still build, above).
    assert {s["id"] for s in recipes.template_summaries(include_legacy=True)} >= {t["id"] for t in recipes.TEMPLATES} and all(s["sections"] for s in summaries)
    with pytest.raises(KeyError):
        recipes.build_template("nope")


@pytest.mark.parametrize("kind", recipes.SECTION_KINDS)
def test_every_section_kind_with_full_content(kind):
    spec = {
        "kind": kind, "variant": "", "eyebrow": "Eyebrow", "heading": "Heading", "subheading": "Sub", "text": "Body **md**",
        "buttons": [{"label": "One", "href": "/a"}, {"label": "Two", "href": "#b"}],
        "items": [{"title": "T", "text": "X", "icon": "Star", "value": "9", "label": "L", "quote": "Q", "author": "A", "role": "R",
                   "image": "https://x.y/i.png", "question": "Q?", "answer": "A.", "name": "N", "price": "$1", "period": "/mo",
                   "features": ["f1"], "highlighted": True, "href": "/x"}],
        "image": "https://x.y/hero.png", "video": "https://youtu.be/abc", "background": "surface", "columns": 2, "limit": 4,
        "course_uuids": ["course_1"], "anchor": "here",
    }
    node = recipes.build_section(spec, {"org_name": "Acme", "year": 2026})
    validate_doc({"root": [node]})


@pytest.mark.parametrize("background", ["default", "surface", "primary", "dark", "image", "gradient"])
def test_backgrounds_and_hero_variants(background):
    for variant in ("", "centered", "split", "image"):
        node = recipes.build_section({"kind": "hero", "variant": variant, "background": background, "image": "https://x/i.png"})
        validate_doc({"root": [node]})
    validate_doc({"root": [recipes.build_section({"kind": "cta", "background": background})]})
    validate_doc({"root": [recipes.build_section({"kind": "text_image", "variant": "image-left"})]})
    validate_doc({"root": [recipes.build_section({"kind": "navbar", "buttons": [{"label": "Join", "href": "/signup"}]})]})


def test_hero_skips_a_description_that_repeats_the_name():
    plain = recipes.build_section({"kind": "hero"}, {"org_name": "Acme", "org_description": "Acme"})
    assert "Practical courses" in json.dumps(plain)
    rich = recipes.build_section({"kind": "hero"}, {"org_name": "Acme", "org_description": "Hands-on cooking classes for busy people"})
    assert "Hands-on cooking" in json.dumps(rich)


def test_build_page_presets_and_theme():
    doc = recipes.build_page([{"kind": "hero"}], preset="nope", theme={"radius": "none"})
    assert doc["theme"]["radius"] == "none"
    for name in recipes.PRESETS:
        validate_doc(recipes.build_page([recipes.SectionSpec(kind="faq")], preset=name))
    assert recipes.apply_theme(schema.Theme().model_dump(mode="json"), {"colors": {"accent": "#000000"}})["colors"]["accent"] == "#000000"


def test_reid_gives_fresh_ids():
    node = recipes.build_section({"kind": "features"})
    clone = recipes.reid(node)
    ids = lambda n: [n["id"]] + [i for c in n.get("children") or [] for i in ids(c)]  # noqa: E731
    assert not set(ids(node)) & set(ids(clone))


# ─── tree edits ───────────────────────────────────────────────────────────────


def _tree():
    return {
        "root": [
            {"id": "a", "type": "section", "props": {}, "children": [{"id": "a1", "type": "container", "props": {}, "children": [{"id": "t1", "type": "text", "props": {"text": "Hi"}}]}]},
            {"id": "b", "type": "section", "props": {}, "children": []},
        ],
        "symbols": {"s": {"name": "S", "node": {"id": "sr", "type": "container", "props": {}, "children": [{"id": "st", "type": "text", "props": {}}]}}, "broken": {"name": "x"}},
    }


def test_tree_find_insert_remove_move_duplicate():
    doc = _tree()
    assert tree.get(doc, "t1")["props"]["text"] == "Hi"
    assert tree.find(doc, "st")[2]["id"] == "sr" and tree.find(doc, "sr")[1] == 0 and tree.find(doc, "zz") is None
    with pytest.raises(KeyError):
        tree.get(doc, "zz")
    doc2 = tree.insert(doc, {"id": "n", "type": "text", "props": {}}, "a1", 0)
    assert tree.get(doc2, "a1")["children"][0]["id"] == "n" and doc["root"][0]["children"][0]["children"][0]["id"] == "t1"
    doc3 = tree.insert(doc, {"id": "s3", "type": "section", "props": {}}, None)
    assert doc3["root"][-1]["id"] == "s3"
    doc4, removed = tree.remove(doc, "t1")
    assert removed["id"] == "t1" and not tree.get(doc4, "a1")["children"]
    with pytest.raises(KeyError):
        tree.remove(doc, "zz")
    moved = tree.move(doc, "a", None, 2)
    assert [n["id"] for n in moved["root"]] == ["b", "a"]
    moved = tree.move(doc, "t1", "b", 0)
    assert tree.get(moved, "b")["children"][0]["id"] == "t1"
    with pytest.raises(ValueError):
        tree.move(doc, "a", "t1")
    with pytest.raises(KeyError):
        tree.move(doc, "zz", None)
    dup, clone = tree.duplicate({**doc, "root": [dict(doc["root"][0], anchor="x")] + doc["root"][1:]}, "a")
    assert dup["root"][1]["id"] == clone["id"] != "a" and "anchor" not in clone
    with pytest.raises(KeyError):
        tree.duplicate(doc, "zz")
    assert tree.is_inside(doc, "t1", "a") and not tree.is_inside(doc, "b", "a")


def test_merge_style_set_path_and_outline():
    style = tree.merge_style({"base": {"color": "#000", "gap": 4}, "mobile": {"gap": 2}}, {"base": {"color": None, "fontSize": 20}, "mobile": {"gap": None}, "tablet": None})
    assert style == {"base": {"gap": 4, "fontSize": 20}}
    props = {"items": [{"title": "a"}], "plans": []}
    tree.set_path(props, "items.0.title", "b")
    tree.set_path(props, "new", 1)
    assert props["items"][0]["title"] == "b" and props["new"] == 1
    for bad in ("items.5.title", "items.x", "missing.deep", "new.x"):
        with pytest.raises(KeyError):
            tree.set_path(props, bad, 1)
    with pytest.raises(KeyError):
        tree.set_path({"items": [{"a": 1}]}, "items.0.a.b", 1)
    doc = _tree()
    doc["root"][1]["children"] = [{"id": "f", "type": "faq", "props": {"items": [{}, {}]}, "hidden": {"mobile": True}}]
    view = tree.outline(doc)
    assert view[0]["children"][0]["children"][0]["text"] == "Hi"
    assert view[1]["children"][0]["text"] == "2 item(s)" and view[1]["children"][0]["hidden"]
    assert tree.outline(doc, depth=1)[0]["children"] == "1 element(s)"
    named = {"root": [{"id": "x", "type": "section", "name": "Hero", "props": {}}]}
    assert tree.outline(named)[0]["name"] == "Hero"


def test_link_and_date_props_are_checked_everywhere():
    nodes = [
        {"id": "c", "type": "container", "props": {"href": "/x", "newTab": True}},
        {"id": "i", "type": "image", "props": {"src": "/a.png", "href": "#top"}},
        {"id": "l", "type": "list", "props": {"items": ["a", "b"]}},
        {"id": "p", "type": "instructors", "props": {"people": [{"name": "A", "href": "https://x.y", "image": "/i.png"}]}},
        {"id": "d", "type": "countdown", "props": {"target": "2030-01-01T00:00"}},
        {"id": "f", "type": "footer", "props": {"social": [{"network": "x", "href": "https://x.com/a"}]}},
        {"id": "e", "type": "embed", "props": {"url": "https://youtu.be/x"}},
    ]
    out = validate_doc(_doc(_section(*nodes)))
    assert out["root"][0]["children"][4]["props"]["target"] == "2030-01-01T00:00"


def test_clean_drops_empty_styles_and_set_path_on_list_end():
    node = recipes._clean({"id": "x", "type": "text", "props": {}, "style": {"base": {"color": None}, "mobile": {"gap": 2}}})
    assert node["style"] == {"mobile": {"gap": 2}}
    node = recipes._clean({"id": "x", "type": "text", "props": {}, "style": {"base": {"color": None}}})
    assert "style" not in node
    props = {"items": ["a", "b"]}
    tree.set_path(props, "items.1", "c")
    assert props["items"] == ["a", "c"]
