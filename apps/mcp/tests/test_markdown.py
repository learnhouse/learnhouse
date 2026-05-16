"""Golden snapshots for the markdown → Tiptap converter."""

from learnhouse_mcp.markdown import markdown_to_tiptap


def test_empty_input_returns_empty_doc():
    doc = markdown_to_tiptap("")
    assert doc["type"] == "doc"
    assert doc["content"] == [{"type": "paragraph"}]


def test_simple_paragraph():
    doc = markdown_to_tiptap("Hello world")
    assert doc["content"][0]["type"] == "paragraph"
    assert doc["content"][0]["content"][0]["text"] == "Hello world"


def test_headings_capped_at_3():
    doc = markdown_to_tiptap("# H1\n## H2\n### H3\n#### H4")
    headings = [n for n in doc["content"] if n["type"] == "heading"]
    assert [h["attrs"]["level"] for h in headings] == [1, 2, 3, 3]


def test_bold_italic_code_marks():
    doc = markdown_to_tiptap("**bold** *italic* `code`")
    para = doc["content"][0]
    marks_seen = set()
    for node in para["content"]:
        for m in node.get("marks", []) or []:
            marks_seen.add(m["type"])
    assert {"bold", "italic", "code"} <= marks_seen


def test_link_carries_href():
    doc = markdown_to_tiptap("[link](https://example.com)")
    text_node = doc["content"][0]["content"][0]
    link_mark = next(m for m in text_node["marks"] if m["type"] == "link")
    assert link_mark["attrs"]["href"] == "https://example.com"


def test_bullet_list_structure():
    doc = markdown_to_tiptap("- one\n- two\n- three")
    lst = doc["content"][0]
    assert lst["type"] == "bulletList"
    assert len(lst["content"]) == 3
    assert lst["content"][0]["type"] == "listItem"


def test_code_block_with_language():
    doc = markdown_to_tiptap("```python\nprint('hi')\n```")
    block = doc["content"][0]
    assert block["type"] == "codeBlock"
    assert block["attrs"]["language"] == "python"
    assert block["content"][0]["text"] == "print('hi')"


def test_horizontal_rule():
    doc = markdown_to_tiptap("text\n\n---\n\nmore")
    types = [n["type"] for n in doc["content"]]
    assert "horizontalRule" in types
