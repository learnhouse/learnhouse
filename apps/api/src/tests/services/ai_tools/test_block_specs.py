"""Typed blocks (block_specs.py) and embed providers (embeds.py)."""

import pytest

from src.services.ai.tools import block_specs as bs
from src.services.ai.tools import doc_ops as d
from src.services.ai.tools.embeds import EXAMPLES, PROVIDERS, parse_embed

UNSAFE_URLS = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "\tjavascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "DATA:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "VBScript:msgbox(1)",
]


@pytest.mark.parametrize("url", UNSAFE_URLS)
def test_typed_blocks_refuse_non_http_urls(url):
    for block in (
        {"type": "button", "label": "Go", "url": url},
        {"type": "h5p", "url": url},
        {"type": "web_preview", "url": url},
        {"type": "embed", "url": url},
        {"type": "video", "url": url},
        {"type": "image", "url": url, "alt": "a"},
        {"type": "audio", "url": url},
        {"type": "pdf", "url": url},
        {"type": "scenario", "steps": [{"id": "a", "text": "t", "image_url": url}]},
    ):
        with pytest.raises(bs.BlockError, match="http"):
            bs.parse_blocks([block])
    # The raw-node escape hatch is checked by the editor schema instead.
    raw = {"type": "node", "node": {"type": "button", "attrs": {"link": url}, "content": [{"type": "text", "text": "Go"}]}}
    with pytest.raises(bs.BlockError):
        bs.to_converted(bs.parse_blocks([raw]))
    link = {"type": "paragraph", "text": f"[click]({url})"}
    doc = bs.to_converted(bs.parse_blocks([link])).doc
    marks = [m for n in d.children(doc["content"][0]) for m in n.get("marks") or []]
    assert all(m.get("type") != "link" for m in marks)  # Markdown never makes it a link


def test_every_example_builds_and_passes_the_schema():
    raw = [dict(v) for k, v in bs.EXAMPLES.items() if k != "user"]
    raw.append({"type": "toggle", "summary": "Who", "blocks": [{"type": "user", "member": "Maya"}]})
    converted = bs.to_converted(bs.parse_blocks(raw), {"maya": 7})
    types = [n["type"] for n in converted.doc["content"]]
    for expected in ("blockQuiz", "flipcardGrid", "scenarios", "blockCode", "blockMagic", "conditionalBlock",
                     "toggleBlock", "blockEmbed", "blockH5P", "blockWebPreview", "horizontalRule", "button",
                     "badge", "table", "blockMathEquation", "callout", "codeBlock", "bulletList"):
        assert expected in types
    assert [m.kind for m in converted.media] == ["image", "audio", "pdf"]
    assert converted.doc["content"][-1]["content"][0] == {"type": "blockUser", "attrs": {"user_id": 7, "layout": "card"}}
    assert set(bs.catalog()["types"]) == set(bs.EXAMPLES)
    assert bs.catalog("quiz")["example"]["type"] == "quiz"


def test_block_errors_name_the_block_and_the_fix():
    with pytest.raises(bs.BlockError, match="unknown block type; use one of"):
        bs.parse_blocks([{"type": "quizz"}])
    with pytest.raises(bs.BlockError, match="style"):
        bs.parse_blocks([{"type": "callout", "style": "loud", "text": "x"}])
    cases = [
        ({"type": "quiz", "questions": [{"text": "Q", "options": [{"text": "a"}, {"text": "b"}]}]}, "no option marked correct"),
        ({"type": "table", "header": ["a"], "rows": [["1", "2"]]}, "at most 1 cells"),
        ({"type": "scenario", "steps": [{"id": "a", "text": "t"}, {"id": "a", "text": "u"}]}, "unique"),
        ({"type": "scenario", "steps": [{"id": "a", "text": "t", "options": [{"text": "go", "next": "zz"}]}]}, "unknown step"),
        ({"type": "toggle", "summary": "s", "blocks": [{"type": "image", "url": "https://x.org/a.png", "alt": "a"}]}, "top level"),
        ({"type": "user", "member": "ghost"}, "not a member"),
        ({"type": "exercise", "language": "cobol", "task": "t"}, "unknown language"),
        ({"type": "conditional", "rules": {"conditions": [{"field": "user.shoe", "op": "in"}]}, "blocks": [{"type": "divider"}]}, "unknown"),
    ]
    for block, problem in cases:
        with pytest.raises(bs.BlockError, match=problem):
            bs.to_converted(bs.parse_blocks([block]), {})
    deep = {"type": "divider"}
    for _ in range(4):
        deep = {"type": "toggle", "summary": "s", "blocks": [deep]}
    with pytest.raises(bs.BlockError, match="nest at most"):
        bs.to_converted(bs.parse_blocks([deep]))
    with pytest.raises(bs.BlockError, match="at most"):
        bs.to_converted([bs.parse_blocks([{"type": "divider"}])[0]] * (bs.MAX_BLOCKS + 1))
    with pytest.raises(bs.BlockError, match="unknown block type"):
        bs.catalog("nope")


def test_single_flashcard_and_video_kinds():
    one = bs.to_converted(bs.parse_blocks([{"type": "flashcards", "cards": [{"front": "a", "back": "b"}]}]))
    assert one.doc["content"][0]["type"] == "flipcard"
    file_video = bs.to_converted(bs.parse_blocks([{"type": "video", "url": "https://x.org/clip.mp4"}]))
    assert file_video.media[0].kind == "video"
    raw_quiz = bs.to_converted(bs.parse_blocks([{"type": "node", "node": {"type": "blockQuiz", "attrs": {"questions": [
        {"text": "Q", "options": [{"text": "a", "correct": True}, {"text": "b", "correct": False}]}]}}}]))
    assert raw_quiz.doc["content"][0]["attrs"]["questions"][0]["question_id"]


@pytest.mark.parametrize("provider", PROVIDERS)
def test_every_provider_link_becomes_its_player(provider):
    parsed = parse_embed(EXAMPLES[provider])
    assert parsed is not None and parsed.provider == provider
    attrs = parsed.attrs()
    assert d.is_web_url(attrs["embedUrl"]) and attrs["embedProvider"] == provider


def test_embed_edge_cases():
    assert parse_embed("not a url") is None
    assert parse_embed("ftp://x.org/a") is None
    assert parse_embed("https://example.org/page") is None
    assert parse_embed("youtube.com/watch?v=aqz-KE-bpKQ&t=1m30s").embed_url.endswith("start=90")
    assert parse_embed("https://vimeo.com/123456789/abcdef12").embed_url.endswith("?h=abcdef12")
    assert parse_embed("https://www.youtube.com/shorts/aqz-KE-bpKQ").aspect == 9 / 16
    assert parse_embed("https://docs.google.com/presentation/d/e/2PACX/pub").embed_url.endswith("/embed")


def test_member_cards_only_through_the_typed_block_and_only_for_members():
    card = {"type": "blockUser", "attrs": {"user_id": 999, "layout": "card"}}
    for raw in (
        {"type": "node", "node": card},
        {"type": "node", "node": {"type": "toggleBlock", "attrs": {"summary": "s"}, "content": [card]}},
        {"type": "node", "node": {"type": "conditionalBlock", "attrs": {"rules": {"conditions": []}}, "content": [
            {"type": "toggleBlock", "attrs": {"summary": "s"}, "content": [card]}]}},
    ):
        with pytest.raises(bs.BlockError, match="use the typed 'user' block"):
            bs.to_converted(bs.parse_blocks([raw]), {"maya": 999})
    # A document that carries a card for someone outside the org is refused,
    # top level or nested, even if its shape is right.
    foreign = {"type": "doc", "content": [{"type": "toggleBlock", "attrs": {"summary": "s"}, "content": [card]}]}
    with pytest.raises(bs.BlockError, match="not for a member of this organization"):
        bs.check_doc(foreign, member_ids={7})
    with pytest.raises(bs.BlockError, match="not for a member"):
        bs.check_doc({"type": "doc", "content": [card]})
    bs.check_doc({"type": "doc", "content": [card]}, member_ids={999})
    # The typed block resolves the member in this org and works nested.
    typed = bs.to_converted(bs.parse_blocks([{"type": "toggle", "summary": "Team", "blocks": [
        {"type": "user", "member": "maya@school.dev"}]}]), {"maya@school.dev": 42})
    assert typed.doc["content"][0]["content"][0]["attrs"]["user_id"] == 42


async def test_resolve_members_only_finds_this_orgs_members(db, org, other_org, admin_user):
    from datetime import datetime
    from types import SimpleNamespace

    from src.db.user_organizations import UserOrganization
    from src.db.users import User

    outsider = User(id=77, username="outsider", first_name="O", last_name="X", email="o@x.test", password="x",
                    user_uuid="user_outsider", creation_date=str(datetime.now()), update_date=str(datetime.now()))
    db.add(outsider)
    await db.commit()
    db.add(UserOrganization(user_id=77, org_id=other_org.id, role_id=1, creation_date="", update_date=""))
    await db.commit()
    ctx = SimpleNamespace(db_session=db, org=org)
    found = await bs.resolve_members(ctx, {"admin", "admin@test.com", "outsider", "user_outsider", "nobody"})
    assert found == {"admin": admin_user.id, "admin@test.com": admin_user.id}
    # The outsider's card cannot be written for this org by any spelling.
    with pytest.raises(bs.BlockError, match="not a member"):
        await bs.convert_blocks(ctx, [{"type": "user", "member": "outsider"}])
    assert await bs.resolve_members(ctx, set()) == {}
