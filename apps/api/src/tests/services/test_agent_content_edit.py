"""Tests for the surgical content-edit tools (src/services/ai/tools/content_edit.py).

The tools call get_activity/update_activity in-process; here those are patched
with a small stateful in-memory activity so we exercise the executor logic
(version check, path resolution, anchor, validation, error mapping) without a DB.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.services.ai.tools import content_edit as ce


class _FakeActivity:
    """In-memory activity whose content/current_version the tools read+write."""

    def __init__(self, content):
        self.state = {"content": content, "current_version": 1}

    async def get_activity(self, request, activity_uuid, user, db):
        return dict(self.state)  # jsonable(dict) == dict

    async def update_activity(self, request, activity_object, activity_uuid, user, db):
        patch = activity_object.model_dump(exclude_unset=True)
        if "content" in patch:
            self.state["content"] = patch["content"]
            self.state["current_version"] += 1
        return dict(self.state)


def _doc():
    return {
        "type": "doc",
        "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Intro"}]},
            {"type": "paragraph", "content": [
                {"type": "text", "text": "S3 offers "},
                {"type": "text", "text": "eleven nines", "marks": [{"type": "bold"}]},
                {"type": "text", "text": " of durability."},
            ]},
            {"type": "callout", "attrs": {"type": "tip", "dismissible": False}, "content": [{"type": "text", "text": "Keep it private."}]},
            {"type": "bulletList", "content": [
                {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "First"}]}]},
                {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Second"}]}]},
            ]},
        ],
    }


@pytest.fixture
def fake(monkeypatch):
    f = _FakeActivity(_doc())
    monkeypatch.setattr(ce, "get_activity", f.get_activity)
    monkeypatch.setattr(ce, "update_activity", f.update_activity)
    return f


_CTX = SimpleNamespace(request=None, user=None, db_session=None)


def _blocks(fake):
    return fake.state["content"]["content"]


# ─── reads ──────────────────────────────────────────────────────────────────


async def test_read_content_returns_outline_and_version(fake):
    out = await ce._read_content(_CTX, ce.ReadContentParams(activity_uuid="a"))
    assert out["current_version"] == 1
    paths = [e["path"] for e in out["outline"]]
    assert [0] in paths and [3, 1] in paths  # list item expanded


async def test_find_locates_block(fake):
    out = await ce._find(_CTX, ce.FindParams(activity_uuid="a", query="durability"))
    assert out["matches"] and out["matches"][0]["path"] == [1]


# ─── edit_block_text ────────────────────────────────────────────────────────


async def test_edit_text_find_replace_preserves_marks(fake):
    res = await ce._edit_text(_CTX, ce.EditTextParams(
        activity_uuid="a", path=[1], find="eleven nines", replace="99.999999999%"))
    assert res["current_version"] == 2
    assert res["previous_version"] == 1
    runs = _blocks(fake)[1]["content"]
    bold = next(r for r in runs if r["text"] == "99.999999999%")
    assert bold["marks"] == [{"type": "bold"}]
    # other blocks untouched
    assert _blocks(fake)[0]["content"][0]["text"] == "Intro"


async def test_edit_text_whole_text(fake):
    await ce._edit_text(_CTX, ce.EditTextParams(activity_uuid="a", path=[0], text="New heading"))
    assert _blocks(fake)[0]["content"] == [{"type": "text", "text": "New heading"}]


async def test_edit_text_find_not_found_400(fake):
    with pytest.raises(HTTPException) as e:
        await ce._edit_text(_CTX, ce.EditTextParams(activity_uuid="a", path=[1], find="absent", replace="x"))
    assert e.value.status_code == 400


async def test_edit_text_version_conflict_409(fake):
    with pytest.raises(HTTPException) as e:
        await ce._edit_text(_CTX, ce.EditTextParams(
            activity_uuid="a", path=[1], find="S3", replace="AWS S3", expected_version=99))
    assert e.value.status_code == 409
    assert fake.state["current_version"] == 1  # not written


async def test_edit_text_anchor_mismatch_400(fake):
    with pytest.raises(HTTPException) as e:
        await ce._edit_text(_CTX, ce.EditTextParams(
            activity_uuid="a", path=[1], text="x", anchor={"type": "heading"}))
    assert e.value.status_code == 400


async def test_edit_text_bad_path_400(fake):
    with pytest.raises(HTTPException) as e:
        await ce._edit_text(_CTX, ce.EditTextParams(activity_uuid="a", path=[99], text="x"))
    assert e.value.status_code == 400


async def test_edit_nested_list_item(fake):
    await ce._edit_text(_CTX, ce.EditTextParams(activity_uuid="a", path=[3, 1], find="Second", replace="2nd"))
    from src.services.ai.tools import doc_ops as d
    assert d.node_text(_blocks(fake)[3]["content"][1]) == "2nd"


# ─── update_block_attrs ─────────────────────────────────────────────────────


async def test_update_attrs_changes_callout_type(fake):
    res = await ce._update_attrs(_CTX, ce.UpdateAttrsParams(activity_uuid="a", path=[2], attrs={"type": "warning"}))
    assert _blocks(fake)[2]["attrs"]["type"] == "warning"
    assert res["before_attrs"]["type"] == "tip"


# ─── replace / insert / delete / move ───────────────────────────────────────


async def test_replace_block(fake):
    new = {"type": "paragraph", "content": [{"type": "text", "text": "Replaced"}]}
    await ce._replace_block(_CTX, ce.ReplaceBlockParams(activity_uuid="a", path=[0], new_block=new))
    assert _blocks(fake)[0] == new


async def test_insert_block_after(fake):
    new = {"type": "paragraph", "content": [{"type": "text", "text": "Inserted"}]}
    await ce._insert_block(_CTX, ce.InsertBlockParams(activity_uuid="a", path=[0], new_block=new, position="after"))
    assert _blocks(fake)[1] == new
    assert _blocks(fake)[0]["type"] == "heading"


async def test_insert_block_child_end_into_list(fake):
    li = {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Third"}]}]}
    await ce._insert_block(_CTX, ce.InsertBlockParams(activity_uuid="a", path=[3], new_block=li, position="child_end"))
    assert len(_blocks(fake)[3]["content"]) == 3


async def test_insert_invalid_node_rejected(fake):
    bad = {"type": "paragraph", "content": [{"type": "text", "text": ""}]}  # empty text node
    with pytest.raises(HTTPException) as e:
        await ce._insert_block(_CTX, ce.InsertBlockParams(activity_uuid="a", path=[0], new_block=bad, position="after"))
    assert e.value.status_code == 400
    assert fake.state["current_version"] == 1  # rejected before write


async def test_delete_block(fake):
    before = len(_blocks(fake))
    res = await ce._delete_block(_CTX, ce.DeleteBlockParams(activity_uuid="a", path=[2]))
    assert res["deleted_type"] == "callout"
    assert len(_blocks(fake)) == before - 1


async def test_move_block(fake):
    # move the callout (index 2) to before the heading (index 0)
    await ce._move_block(_CTX, ce.MoveBlockParams(activity_uuid="a", from_path=[2], to_path=[0], position="before"))
    assert _blocks(fake)[0]["type"] == "callout"


async def test_move_block_bad_dest_restores(fake):
    with pytest.raises(HTTPException):
        await ce._move_block(_CTX, ce.MoveBlockParams(activity_uuid="a", from_path=[1], to_path=[99], position="after"))
    # source not lost
    assert len(_blocks(fake)) == 4 and _blocks(fake)[1]["type"] == "paragraph"
