"""score_course, preview_activity (course_quality.py) and import_content,
import_outline (course_import.py)."""

from unittest.mock import AsyncMock, patch

import httpx
import pytest
from sqlmodel import select

from src.db.courses.activities import Activity
from src.db.courses.courses import Course
from src.services.ai.tools import course_import as ci
from src.services.ai.tools import course_quality as cq
from src.services.ai.tools import get_mcp_registry, run_tool
from src.tests.services.ai_tools.test_content import PNG, net  # noqa: F401  (fixture)
from src.tests.services.ai_tools.test_course_build import quiet_assignments, redis_store  # noqa: F401  (fixtures)
from src.tests.services.ai_tools.test_courses import ctx_for, quiet_services  # noqa: F401  (fixtures)


async def tool(db, org, user, name, args, **kw):
    return await run_tool(get_mcp_registry(), name, args, ctx_for(db, org, user, **kw))


LONG = " ".join(["Photosynthesis lets green plants turn light, water and carbon dioxide into sugar and oxygen."] * 8)
HARD = " ".join(["Notwithstanding photosynthetic electrochemical considerations, thylakoid-embedded multiprotein complexes orchestrate unidirectional electron transportation."] * 6)


async def _course(db, org, admin_user):
    spec = {
        "course": {"name": "Leaves", "objectives": ["Explain photosynthesis in green plants", "Compute quantum yield thermodynamics"]},
        "chapters": [
            {"name": "Basics", "activities": [
                {"name": "Intro", "markdown": f"## Light\n\n{LONG}\n\n#### Too deep\n\n# Title in page\n\n[click here](https://example.org)\n\n| a | b |\n|---|---|\n| 1 | 2 |"},
                {"name": "Hard", "markdown": HARD},
                {"name": "Exam", "kind": "assignment", "tasks": [{"type": "short_answer", "title": "Gas", "prompt": "Which gas?", "accepted_answers": ["oxygen"]}]},
            ]},
            {"name": "Practice", "activities": [
                {"name": "Check", "blocks": [
                    {"type": "quiz", "questions": [{"text": "Makes sugar?", "options": [{"text": "Leaves", "correct": True}, {"text": "Rocks"}]}]},
                    {"type": "flashcards", "cards": [{"front": "Stomata", "back": "Pores"}]},
                    {"type": "embed", "url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ"},
                    {"type": "table", "header": ["x"], "rows": []},
                    {"type": "toggle", "summary": "Hidden", "blocks": [{"type": "paragraph", "text": "secret"}]},
                    {"type": "toggle", "summary": "Open", "open": True, "blocks": [{"type": "paragraph", "text": "visible"}]},
                    {"type": "conditional", "rules": {"conditions": [{"field": "progress.percent", "op": "lt", "value": 50}]}, "blocks": [{"type": "paragraph", "text": "beginner only"}]},
                    {"type": "exercise", "task": "Add numbers", "starter": "a=1", "tests": [{"output": "2"}]},
                    {"type": "scenario", "title": "Pick", "steps": [{"id": "s", "text": "Go?", "options": [{"text": "Yes"}]}]},
                    {"type": "widget", "html": "<html></html>", "title": "W"},
                    {"type": "web_preview", "url": "https://example.org/", "title": "Ex"},
                    {"type": "paragraph", "text": "Hello {{user.first_name}}"},
                ]},
            ]},
            {"name": "Reading", "activities": [{"name": "Just text", "markdown": "Some plain reading text."}]},
            {"name": "Empty chapter"},
        ],
    }
    out = await tool(db, org, admin_user, "build_course", spec, approved=True)
    assert out.status == "executed" and out.result["ok"], out.result
    return out.result


def test_flesch_and_syllables():
    assert cq.flesch("too short") is None
    assert cq.flesch(LONG) > cq.flesch(HARD)
    assert cq.syllables("the") == 1 and cq.syllables("photosynthesis") >= 4


async def test_score_course_scores_every_area_and_ranks_fixes(db, org, admin_user):
    built = await _course(db, org, admin_user)
    # Add an image without alt text and a video without caption the way the editor would.
    row = (await db.execute(select(Activity).where(Activity.activity_uuid == built["ids"]["activities"]["intro"]))).scalars().one()
    row.content = {**row.content, "content": row.content["content"] + [
        {"type": "blockImage", "attrs": {"blockObject": {"block_uuid": "b"}, "alt": ""}},
        {"type": "blockVideo", "attrs": {"blockObject": {"block_uuid": "v"}, "caption": ""}},
        {"type": "table", "content": [{"type": "tableRow", "content": [{"type": "tableCell", "content": [{"type": "paragraph"}]}]}]},
    ]}
    db.add(row)
    await db.commit()
    with patch.object(cq, "check_links", new=AsyncMock(return_value={"https://www.youtube.com/embed/aqz-KE-bpKQ?rel=0": {"state": "broken", "reason": "404"}})), \
            patch("src.services.ai.tools.course_audit.check_links_of", new=AsyncMock(return_value={})):
        out = await tool(db, org, admin_user, "score_course", {"course_uuid": built["ids"]["course_uuid"], "check_links": True, "max_fixes": 60})
    r = out.result
    assert out.status == "executed", out.reason
    assert set(r["scores"]) == set(cq.WEIGHTS) and 0 <= r["score"] <= 100 and r["grade"]
    codes = {f["code"] for f in r["fixes"]}
    for code in ("image_no_alt", "heading_skip", "heading_h1", "table_no_header", "vague_link_text", "video_no_caption",
                 "hard_to_read", "objective_not_covered", "chapter_no_practice", "broken_embed"):
        assert code in codes, code
    assert r["objectives"][0]["covered"] >= 0.5 > r["objectives"][1]["covered"]
    assert r["figures"]["pages_with_practice"] >= 1 and r["figures"]["hardest_pages"]
    small = await tool(db, org, admin_user, "score_course", {"course_uuid": built["ids"]["course_uuid"], "max_fixes": 1})
    assert len(small.result["fixes"]) == 1 and small.result["fixes_not_shown"]


async def test_score_course_without_objectives_or_pages(db, org, admin_user):
    out = await tool(db, org, admin_user, "build_course", {"course": {"name": "Bare"}})
    r = (await tool(db, org, admin_user, "score_course", {"course_uuid": out.result["ids"]["course_uuid"]})).result
    assert any(f["code"] == "no_objectives" for f in r["fixes"]) and r["scores"]["readability"] == 70


async def test_score_course_needs_edit_rights(db, org, admin_user, regular_user):
    built = await _course(db, org, admin_user)
    out = await tool(db, org, regular_user, "score_course", {"course_uuid": built["ids"]["course_uuid"]})
    assert out.status == "denied"


async def test_preview_as_learner(db, org, admin_user):
    built = await _course(db, org, admin_user)
    uuid = built["ids"]["activities"]["check"]
    early = (await tool(db, org, admin_user, "preview_activity", {"activity_uuid": uuid, "learner": {"progress_percent": 10, "first_name": "Sam"}})).result
    late = (await tool(db, org, admin_user, "preview_activity", {"activity_uuid": uuid, "learner": {"progress_percent": 90}})).result
    text = early["preview"]
    assert "**Quiz**" in text and "( ) Leaves" in text and "[x]" not in text
    assert "flip to reveal" in text and "Coding exercise" in text and "Scenario: Pick" in text and "- [Yes]" in text
    assert "▸ Hidden (collapsed)" in text and "secret" not in text and "▾ Open" in text and "visible" in text
    assert "[Interactive: W]" in text and "Embedded youtube" in text and "Hello Sam" in text
    assert "beginner only" in text and "beginner only" not in late["preview"]
    assert early["conditional_blocks"] == {"shown": 1, "hidden": 0} and late["conditional_blocks"]["hidden"] == 1
    media = cq._learner_lines({"type": "blockImage", "attrs": {"alt": "Leaf"}})
    assert media == ["[Image: Leaf]"] and cq._learner_lines({"type": "blockUser", "attrs": {}}) == ["[Member card]"]
    anon = (await tool(db, org, admin_user, "preview_activity", {"activity_uuid": uuid, "learner": {"signed_in": False, "role": "anonymous"}})).result
    assert anon["as"]["signed_in"] is False


# ─── import ──────────────────────────────────────────────────────────────────

HTML = """<html><head><title>Leaf guide</title></head><body>
<nav>Menu</nav><header>Site</header>
<article><h1>Leaf guide</h1><p>Leaves are <b>green</b>. <a href="/more">More</a></p>
<img src="/img/leaf.png" alt="leaf" width="300">
<h2>Parts</h2><ul><li>Stomata <img src="https://img.test/inline.png"></li></ul>
<script>alert(1)</script><iframe src="https://www.youtube.com/embed/aqz-KE-bpKQ"></iframe>
<h2>Uses</h2><p>Food.</p></article><footer>Footer</footer></body></html>"""


def test_main_html_and_conversion():
    body, title = ci.main_html(HTML, "https://site.test/guide/")
    assert title == "Leaf guide" and "Menu" not in body and "alert" not in body and "https://site.test/more" in body
    converted, title = ci.html_to_converted(HTML, "https://site.test/guide/")
    assert [m.url for m in converted.media] == ["https://site.test/img/leaf.png"]
    assert converted.notes  # the image inside a list stays a link
    _body, untitled = ci.main_html("<body><h1>Only heading</h1><p>x</p></body>")
    assert untitled == "Only heading"
    assert ci.main_html("<p>bare</p>")[1] is None
    with pytest.raises(Exception, match="over"):
        ci.html_to_converted("x" * (ci.MAX_HTML + 1))


def test_split_doc():
    doc = {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Lead"}]},
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "A"}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "a"}]},
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "B"}]},
    ]}
    assert [n for n, _d in ci.split_doc(doc, 2, "Page")] == ["Page", "A", "B"]
    assert ci.split_doc(doc, None, "Page") == [("Page", doc)]
    assert [n for n, _d in ci.split_doc(doc, 1, "Page")] == ["Page"]
    many = {"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": str(i)}]} for i in range(ci.MAX_PAGES + 1)]}
    with pytest.raises(Exception, match="at most"):
        ci.split_doc(many, 1, "P")


async def test_import_markdown_html_and_url(db, org, admin_user, course, chapter, net):  # noqa: F811 (fixture)
    md = await tool(db, org, admin_user, "import_content", {"chapter_uuid": chapter.chapter_uuid, "markdown": "# One\n\nText.\n\n# Two\n\nMore.", "split_on": "h1"})
    assert [a["name"] for a in md.result["activities"]] == ["One", "Two"]
    # A leading title names the page (and is not repeated in it).
    titled = await tool(db, org, admin_user, "import_content", {"chapter_uuid": chapter.chapter_uuid, "markdown": "# Leaf notes\n\nGreen.\n\n## Parts\n\nStems.", "split_on": "h2"})
    assert [a["name"] for a in titled.result["activities"]] == ["Leaf notes", "Parts"]
    row = (await db.execute(select(Activity).where(Activity.activity_uuid == titled.result["activities"][0]["uuid"]))).scalars().one()
    assert row.content["content"][0]["type"] == "paragraph"
    html = await tool(db, org, admin_user, "import_content", {"chapter_uuid": chapter.chapter_uuid, "html": "<h2>Alpha</h2><p>a</p><h2>Beta</h2><p>b</p>", "split_on": "h2", "name": "Fallback"})
    assert [a["name"] for a in html.result["activities"]] == ["Alpha", "Beta"]
    # A URL needs a person's yes, then is fetched through the guarded fetcher.
    net.routes[("site.test", "/guide/")] = httpx.Response(200, text=HTML, headers={"content-type": "text/html; charset=utf-8"})
    net.routes[("site.test", "/img/leaf.png")] = httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    held = await tool(db, org, admin_user, "import_content", {"chapter_uuid": chapter.chapter_uuid, "url": "https://site.test/guide/"})
    assert held.denied_code == "approval_required"
    page = await tool(db, org, admin_user, "import_content", {"chapter_uuid": chapter.chapter_uuid, "url": "https://site.test/guide/"}, approved=True)
    assert page.status == "executed", page.reason
    ref = page.result["activities"][0]
    assert ref["name"] == "Leaf guide" and ref["media"]["added"] and "from https://site.test/guide/" in page.result["summary"]
    net.routes[("site.test", "/notes.md")] = httpx.Response(200, text="## Notes\n\nPlain.", headers={"content-type": "text/markdown"})
    notes = await tool(db, org, admin_user, "import_content", {"chapter_uuid": chapter.chapter_uuid, "url": "https://site.test/notes.md", "name": "Notes"}, approved=True)
    assert notes.result["activities"][0]["name"] == "Notes"
    bad = await tool(db, org, admin_user, "import_content", {"chapter_uuid": chapter.chapter_uuid, "markdown": "a", "html": "<p>b</p>"})
    assert bad.denied_code == "invalid_args"


async def test_fetch_page_refusals(net):  # noqa: F811 (fixture)
    from fastapi import HTTPException

    from src.services.ai.tools import content_assets as ca

    net.routes[("site.test", "/bin")] = httpx.Response(200, content=b"\x00", headers={"content-type": "application/zip"})
    net.routes[("site.test", "/big")] = httpx.Response(200, content=b"x" * (ca.PAGE_CAP + 10), headers={"content-type": "text/html"})
    for path, problem in (("/bin", "not a web page"), ("/big", "limit")):
        with pytest.raises(HTTPException, match=problem):
            await ca.fetch_page(f"https://site.test{path}")
    with pytest.raises(HTTPException, match="Only http"):
        await ca.fetch_page("ftp://site.test/x")


async def test_fetch_page_errors_are_readable(monkeypatch):
    from fastapi import HTTPException

    from src.services.ai.tools import content_assets as ca
    from src.services.utils.ssrf_guard import SSRFBlockedError

    for error, problem in ((TimeoutError(), "longer than"), (SSRFBlockedError("x"), "not allowed"), (httpx.ConnectError("x"), "Could not fetch")):
        async def boom(*a, error=error, **k):
            raise error

        monkeypatch.setattr(ca, "_fetch", boom)
        with pytest.raises(HTTPException, match=problem):
            await ca.fetch_page("https://site.test/x")


def test_parse_outline_forms():
    spec = ci.parse_outline("# Course\nA short intro.\n## One\n### Page A\nBody\n### Page B\n## Two\n- item page")
    assert spec["course"] == {"name": "Course", "description": "A short intro."}
    assert spec["chapters"][0]["activities"] == [{"name": "Page A", "markdown": "Body"}, {"name": "Page B"}]
    assert spec["chapters"][1]["activities"] == [{"name": "item page"}]
    nested = ci.parse_outline("- Chapter 1\n  - Page 1\n  - Page 2\n- Chapter 2")
    assert [c["name"] for c in nested["chapters"]] == ["Chapter 1", "Chapter 2"] and len(nested["chapters"][0]["activities"]) == 2
    orphan = ci.parse_outline("### Lone page\ntext")
    assert orphan["chapters"][0]["name"] == "Chapter 1"
    with pytest.raises(Exception, match="No chapters"):
        ci.parse_outline("just text")


async def test_import_outline(db, org, admin_user):
    spec = await tool(db, org, admin_user, "import_outline", {"outline": "## One\n### Page"})
    assert spec.denied_code == "http_400" and "name" in spec.reason
    named = await tool(db, org, admin_user, "import_outline", {"outline": "## One\n### Page", "course_name": "Named"})
    assert named.result["spec"]["course"]["name"] == "Named"
    built = await tool(db, org, admin_user, "import_outline", {"outline": "# Built\n## One\n### Page\nHi", "create": True})
    assert built.result["ok"] and (await db.execute(select(Course).where(Course.name == "Built"))).scalars().one()


def test_markdown_with_raw_html_goes_through_the_html_converter():
    converted, title = ci.markdown_to_converted('<p align="center"><img src="https://img.test/logo.png" alt="Logo"></p>\n\n# Project\n\nSome **bold** text and a [link](https://x.test).\n')
    text = str(converted.doc)
    assert "<p" not in text and "bold" in text and title == "Project"
    plain, none = ci.markdown_to_converted("## Plain\n\n```quiz\nQ: ok?\n- [x] yes\n- [ ] no\n```")
    assert none is None and any(n["type"] == "blockQuiz" for n in plain.doc["content"])


async def test_many_images_import_without_failing(db, org, admin_user, course, chapter):
    html = "".join(f'<p><img src="https://img.test/{i}.png" alt="{i}"></p>' for i in range(23))
    with patch("src.services.ai.tools.course_import.attach_media", new=AsyncMock(return_value=None)) as attach:
        out = await tool(db, org, admin_user, "import_content", {"chapter_uuid": chapter.chapter_uuid, "html": html, "name": "Gallery"}, approved=True)
    assert out.status == "executed", out.reason
    assert len(attach.await_args.args[2]) == 20 and "3 more images were kept as links" in " ".join(out.result["notes"])
