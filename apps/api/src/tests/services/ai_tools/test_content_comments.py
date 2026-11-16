"""Editor comment threads and the page tools: reads say which blocks carry
comments (never the thread text), and edits that remove a commented phrase
say the thread is now detached."""

# ruff: noqa: F811

from src.services.ai.tools import content_edit
from src.tests.services.ai_tools.test_content import (  # noqa: F401
    _no_webhooks,
    _p,
    ctx_for,
    ok,
    registry,
    stored,
)


def _commented(text, thread):
    return {"type": "text", "text": text, "marks": [{"type": "comment", "attrs": {"threadId": thread}}]}


def commented_doc():
    return {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "DNS"}]},
        _p("A record maps a name. The ", _commented("TTL", "thread_ttl"), " sets caching."),
        {"type": "callout", "attrs": {"type": "tip", "dismissible": False}, "content": [
            _p("Keep an ", _commented("honest description", "thread_honest"), " of each host."),
        ]},
        _p("Plain closing words."),
    ]}


async def _page(db, activity):
    activity.content = commented_doc()
    db.add(activity)
    await db.commit()
    await db.refresh(activity)
    return activity


async def test_outline_flags_commented_blocks_without_thread_text(registry, db, org, admin_user, activity):
    await _page(db, activity)
    out = await ok(registry, ctx_for(db, org, admin_user), "get_activity_content", activity_uuid="activity_test")
    flagged = [b["path"] for b in out["blocks"] if b.get("has_comments")]
    assert [1] in flagged and len(flagged) == 2
    assert not any(b.get("has_comments") for b in out["blocks"] if b["path"] in ([0], [3]))
    assert "comments_note" in out and "thread_ttl" not in repr(out)


async def test_markdown_and_json_list_commented_paths(registry, db, org, admin_user, activity):
    await _page(db, activity)
    md = await ok(registry, ctx_for(db, org, admin_user), "get_activity_content", activity_uuid="activity_test", format="markdown")
    assert md["commented_blocks"] == [[1], [2, 0]] and "thread_" not in md["markdown"]
    js = await ok(registry, ctx_for(db, org, admin_user), "get_activity_content", activity_uuid="activity_test", format="json")
    assert js["commented_blocks"] == [[1], [2, 0]] and "thread_" not in repr(js["doc"])


async def test_page_without_comments_has_no_note(registry, db, org, admin_user, activity):
    activity.content = {"type": "doc", "content": [_p("Nothing here.")]}
    db.add(activity)
    await db.commit()
    out = await ok(registry, ctx_for(db, org, admin_user), "get_activity_content", activity_uuid="activity_test")
    assert "comments_note" not in out and not any(b.get("has_comments") for b in out["blocks"])


async def test_edit_removing_commented_text_reports_detached_thread(registry, db, org, admin_user, activity):
    await _page(db, activity)
    ctx = ctx_for(db, org, admin_user)
    kept = await ok(registry, ctx, "edit_activity_content", activity_uuid="activity_test", ops=[
        {"op": "replace_text", "find": "Plain closing", "replace": "Final"},
    ])
    assert "detached_comments" not in kept
    out = await ok(registry, ctx, "edit_activity_content", activity_uuid="activity_test", ops=[
        {"op": "set_text", "path": [2, 0], "text": "Describe each host clearly."},
    ])
    assert out["detached_comments"] == 1
    assert any("1 comment thread;" in n and "detached" in n for n in out["notes"])
    row = await stored(db)
    assert "thread_ttl" in repr(row.content) and "thread_honest" not in repr(row.content)


async def test_write_replace_reports_every_detached_thread(registry, db, org, admin_user, activity):
    await _page(db, activity)
    out = await ok(registry, ctx_for(db, org, admin_user), "write_activity_content",
                   activity_uuid="activity_test", markdown="# DNS\n\nAll new text.")
    assert out["detached_comments"] == 2
    assert any("2 comment threads; they are now detached" in n for n in out["notes"])


def test_flagging_prefers_the_innermost_listed_block():
    blocks = [{"path": [0]}, {"path": [0, 1]}, {"path": [2]}]
    content_edit._flag_comments(blocks, [[0, 1], [2, 0, 3]])
    assert [b.get("has_comments") for b in blocks] == [None, True, True]
    assert content_edit._commented_paths("not a doc") == []
