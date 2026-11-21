"""Locating blocks without node ids (``contributions/blocks.py``)."""

from src.services.courses.contributions import blocks as B


def p(text, **attrs):
    node = {"type": "paragraph", "content": [{"type": "text", "text": text}]}
    if attrs:
        node["attrs"] = attrs
    return node


def h(text, level=2):
    return {"type": "heading", "attrs": {"level": level}, "content": [{"type": "text", "text": text}]}


IMG = {"type": "blockImage", "attrs": {"blockObject": {"id": 1}, "size": {"width": 300}, "id": "x"}}


class TestFingerprint:
    def test_text_blocks_use_type_and_normalized_text(self):
        assert B.fingerprint(p("  Hello\n  World ")) == "paragraph|hello world"
        assert B.fingerprint(h("Title")) == "heading|title"

    def test_nested_text_is_joined_without_separators(self):
        node = {"type": "bulletList", "content": [
            {"type": "listItem", "content": [p("one")]},
            {"type": "listItem", "content": [p("two")]},
        ]}
        assert B.fingerprint(node) == "bulletList|onetwo"

    def test_atoms_use_stable_attrs_without_ids(self):
        fp = B.fingerprint(IMG)
        assert fp.startswith("blockImage|#")
        assert '"id"' not in fp.split("#", 1)[1].replace('{"id":1}', "")
        other = dict(IMG, attrs=dict(IMG["attrs"], id="y"))
        assert B.fingerprint(other) == fp

    def test_empty_attrs_and_non_nodes(self):
        assert B.fingerprint({"type": "horizontalRule"}) == "horizontalRule|#"
        assert B.fingerprint({"type": "horizontalRule", "attrs": {"a": None, "b": ""}}) == "horizontalRule|#"
        assert B.fingerprint("nope") == "?|"
        assert B.fingerprint({}) == "?|#"

    def test_unserializable_attrs_fall_back_to_keys(self):
        assert B.fingerprint({"type": "x", "attrs": {"a": object()}}) == "x|#a"

    def test_text_of_handles_junk(self):
        assert B.text_of(None) == ""
        assert B.text_of({"type": "x", "content": "nope"}) == ""


class TestBlocksOf:
    def test_reads_top_level_dicts_only(self):
        assert B.blocks_of({"type": "doc", "content": [p("a"), "junk", p("b")]}) == [p("a"), p("b")]
        assert B.blocks_of(None) == []
        assert B.blocks_of({"type": "doc"}) == []


class TestLocate:
    fps = ["paragraph|a", "paragraph|b", "paragraph|c", "paragraph|b"]

    def test_run_nearest_target(self):
        assert B.locate_run(self.fps, ["paragraph|b"], 0) == 1
        assert B.locate_run(self.fps, ["paragraph|b"], 3) == 3
        assert B.locate_run(self.fps, ["paragraph|b", "paragraph|c"], 3) == 1
        assert B.locate_run(self.fps, ["paragraph|z"], 0) is None
        assert B.locate_run(self.fps, [], 0) is None

    def test_insert_after_previous_block_or_top(self):
        assert B.locate_insert(self.fps, "paragraph|a", 1) == 1
        assert B.locate_insert(self.fps, "paragraph|b", 4) == 4
        assert B.locate_insert(self.fps, "", 0) == 0
        assert B.locate_insert(self.fps, None, 2) is None
        assert B.locate_insert(self.fps, "paragraph|zz", 1) is None


class TestFuzzy:
    def test_exact_wins(self):
        assert B.fuzzy_locate(["paragraph|x", "paragraph|y"], "paragraph|y", 0) == 1

    def test_edited_text_follows(self):
        fps = ["heading|intro", "paragraph|the quick brown fox jumps over the lazy dog!", "paragraph|other"]
        assert B.fuzzy_locate(fps, "paragraph|the quick brown fox jumps over the lazy dog", 1) == 1

    def test_too_different_or_wrong_type_or_far(self):
        fps = ["heading|the quick brown fox", "paragraph|completely unrelated words"]
        assert B.fuzzy_locate(fps, "paragraph|the quick brown fox", 0) is None
        far = ["paragraph|z"] * 30 + ["paragraph|the quick brown fox"]
        assert B.fuzzy_locate(far, "paragraph|the quick brown fax", 0) is None

    def test_atoms_need_exact(self):
        assert B.fuzzy_locate(["blockImage|#[a]"], "blockImage|#[b]", 0) is None

    def test_tie_prefers_nearest(self):
        fps = ["paragraph|abcdefgx", "paragraph|zzz", "paragraph|abcdefgx"]
        assert B.fuzzy_locate(fps, "paragraph|abcdefgy", 2) == 2

    def test_similarity(self):
        assert B.similarity("a", "a") == 1.0
        assert B.similarity("", "a") == 0.0


class TestBestRegion:
    def test_finds_closest_text(self):
        blocks = [p("intro"), p("the old sentence here"), p("outro")]
        start, region = B.best_region(blocks, [p("the old sentence")], 0)
        assert start == 1 and region == [blocks[1]]

    def test_empty_page(self):
        assert B.best_region([], [p("x")], 3) == (0, [])


class TestClean:
    def test_keeps_shape_and_drops_unsafe_urls(self):
        node = {
            "type": "paragraph",
            "attrs": {"textAlign": "left", 3: "bad"},
            "content": [
                {"type": "text", "text": "ok", "marks": [
                    {"type": "bold"},
                    {"type": "link", "attrs": {"href": "javascript:alert(1)"}},
                    {"type": "link", "attrs": {"href": "https://ok.test"}},
                    "junk",
                ]},
                {"type": "image", "attrs": {"src": "data:text/html,x", "alt": "a"}},
                "junk",
                {"type": ""},
            ],
            "extra": "dropped",
        }
        out = B.clean_node(node)
        assert out == {
            "type": "paragraph",
            "attrs": {"textAlign": "left"},
            "content": [
                {"type": "text", "text": "ok", "marks": [
                    {"type": "bold"}, {"type": "link", "attrs": {"href": "https://ok.test"}},
                ]},
                {"type": "image", "attrs": {"alt": "a"}},
            ],
        }

    def test_unparseable_url_and_relative_links(self):
        assert B._safe_url("http://[::1") is False
        assert B._safe_url("/course/x") is True
        assert B._safe_url(None) is True
        assert B._safe_url("  ") is True

    def test_rejects_non_nodes_and_deep_nesting(self):
        assert B.clean_node("x") is None
        deep = {"type": "p"}
        for _ in range(B.MAX_DEPTH + 2):
            deep = {"type": "p", "content": [deep]}
        cleaned = B.clean_node(deep)
        depth = 0
        while cleaned.get("content"):
            cleaned = cleaned["content"][0]
            depth += 1
        assert depth <= B.MAX_DEPTH
        assert B.clean_blocks([p("a"), 5]) == [p("a")]

    def test_same_blocks(self):
        assert B.same_blocks([p("a")], [p("a")])
        assert not B.same_blocks([p("a")], [p("a", textAlign="center")])


class TestSummary:
    def test_lines(self):
        assert B.summarize([p("old")], [p("new")]) == "Edits paragraph: “new”"
        assert B.summarize([], [h("Fresh")]) == "Adds heading: “Fresh”"
        assert B.summarize([p("gone"), p("too")], []) == "Removes 2 blocks: “gone too”"
        assert B.summarize([IMG], []) == "Removes image"
        assert B.summarize([], [IMG, IMG]) == "Adds 2 blocks"
        assert B.summarize([p("a"), p("b")], [p("")]) == "Edits 2 blocks: “a b”"
        assert B.block_label({"type": "magicBlock"}) == "magic block"
        long = B.summarize([], [p("x" * 200)])
        assert long.endswith("…”") and len(long) < 100


class TestDeepClean:
    def test_nested_urls_and_scripts_are_dropped(self):
        node = {"type": "blockImage", "attrs": {
            "blockObject": {"content": {"imageUrl": "javascript:alert(1)", "file_id": "f1"}, 5: "x"},
            "links": [{"href": "data:text/html,<b>"}, {"href": "https://ok.test"}, "vbscript:x", "fine"],
            "caption": " JavaScript:void(0)",
        }}
        out = B.clean_node(node)
        assert out["attrs"] == {
            "blockObject": {"content": {"file_id": "f1"}},
            "links": [{}, {"href": "https://ok.test"}, "fine"],
        }

    def test_mark_attrs_are_cleaned_too(self):
        node = {"type": "text", "text": "x", "marks": [
            {"type": "link", "attrs": {"href": "https://ok.test", "meta": {"srcUrl": "javascript:x"}}},
            {"type": "link", "attrs": {"customHref": "javascript:x"}},
        ]}
        assert B.clean_node(node)["marks"] == [{"type": "link", "attrs": {"href": "https://ok.test", "meta": {}}}]

    def test_too_deep_values_are_dropped(self):
        deep: object = "ok"
        for _ in range(B.MAX_DEPTH + 3):
            deep = {"a": deep}
        assert B._clean_value(deep, 0)[0] is True
        assert B._clean_value("x", B.MAX_DEPTH + 1) == (False, None)


class TestRestricted:
    EMBED = {"type": "blockEmbed", "attrs": {"embedCode": "<iframe src='https://x'></iframe>"}}

    def test_keep_move_remove_ok_create_or_change_not(self):
        assert B.new_restricted_nodes([self.EMBED], [self.EMBED, p("x")]) == []
        assert B.new_restricted_nodes([self.EMBED], []) == []
        assert B.new_restricted_nodes([], [self.EMBED])
        changed = {"type": "blockEmbed", "attrs": {"embedCode": "<script>x</script>"}}
        assert B.new_restricted_nodes([self.EMBED], [changed])
        nested = {"type": "callout", "content": [{"type": "blockMagic", "attrs": {"htmlContent": "<b>"}}]}
        assert B.new_restricted_nodes([], [nested])
        assert B.new_restricted_nodes([self.EMBED], [self.EMBED, self.EMBED])
        assert B._restricted(["junk"]) == []
