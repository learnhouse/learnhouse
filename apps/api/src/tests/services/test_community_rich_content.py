import json

import pytest
from fastapi import HTTPException

from src.db.communities.communities import DEFAULT_MODERATION_SETTINGS
from src.services.communities.moderation import (
    extract_youtube_video_id,
    validate_rich_content,
)


def _doc(*nodes):
    return json.dumps({"type": "doc", "content": list(nodes)})


def _paragraph(text="hello", marks=None):
    node = {"type": "text", "text": text}
    if marks:
        node["marks"] = marks
    return {"type": "paragraph", "content": [node]}


def _youtube(src="https://www.youtube.com/watch?v=dQw4w9WgXcQ"):
    return {"type": "youtube", "attrs": {"src": src, "start": 0, "width": 640, "height": 480}}


def _settings(**overrides):
    merged = dict(DEFAULT_MODERATION_SETTINGS)
    merged.update(overrides)
    return merged


def _code(exc_info):
    return exc_info.value.detail["code"]


class TestExtractYoutubeVideoId:
    @pytest.mark.parametrize(
        "url",
        [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ?si=abc",
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
            "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
            "https://www.youtube.com/shorts/dQw4w9WgXcQ",
            "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
        ],
    )
    def test_accepts_youtube_urls(self, url):
        assert extract_youtube_video_id(url) == "dQw4w9WgXcQ"

    @pytest.mark.parametrize(
        "url",
        [
            None,
            "",
            "not a url",
            "https://vimeo.com/123456",
            "https://example.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
            "https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ",
            "javascript:alert(1)",
            "https://www.youtube.com/watch?v=short",
            "https://www.youtube.com/",
            "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
        ],
    )
    def test_rejects_non_youtube_urls(self, url):
        assert extract_youtube_video_id(url) is None


class TestValidateRichContent:
    def test_plain_text_passes(self):
        validate_rich_content("just some text", _settings())

    def test_empty_content_passes(self):
        validate_rich_content("", _settings())
        validate_rich_content(None, _settings())

    def test_non_doc_json_passes(self):
        validate_rich_content(json.dumps({"foo": "bar"}), _settings())
        validate_rich_content(json.dumps([1, 2, 3]), _settings())

    def test_basic_formatting_passes_without_flag(self):
        content = _doc(
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Title"}]},
            _paragraph("bold", marks=[{"type": "bold"}]),
            _paragraph("link", marks=[{"type": "link", "attrs": {"href": "https://example.com"}}]),
            {"type": "bulletList", "content": [{"type": "listItem", "content": [_paragraph("item")]}]},
            {"type": "codeBlock", "content": [{"type": "text", "text": "x = 1"}]},
            {"type": "blockquote", "content": [_paragraph("quote")]},
            {"type": "horizontalRule"},
        )
        validate_rich_content(content, _settings())

    def test_youtube_rejected_when_flag_off(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_rich_content(_doc(_paragraph(), _youtube()), _settings())
        assert exc_info.value.status_code == 400
        assert _code(exc_info) == "MODERATION_RICH_CONTENT_DISABLED"

    def test_youtube_rejected_when_settings_missing_flag(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_rich_content(_doc(_youtube()), {})
        assert _code(exc_info) == "MODERATION_RICH_CONTENT_DISABLED"

    def test_youtube_accepted_when_flag_on(self):
        validate_rich_content(_doc(_paragraph(), _youtube()), _settings(allow_rich_content=True))

    def test_youtube_nested_in_list_rejected_when_flag_off(self):
        content = _doc({"type": "bulletList", "content": [{"type": "listItem", "content": [_youtube()]}]})
        with pytest.raises(HTTPException) as exc_info:
            validate_rich_content(content, _settings())
        assert _code(exc_info) == "MODERATION_RICH_CONTENT_DISABLED"

    @pytest.mark.parametrize(
        "src",
        [
            "https://vimeo.com/123456",
            "https://evil.example/embed.html",
            "javascript:alert(1)",
            "",
            None,
        ],
    )
    def test_non_youtube_embed_rejected_even_when_flag_on(self, src):
        with pytest.raises(HTTPException) as exc_info:
            validate_rich_content(_doc(_youtube(src)), _settings(allow_rich_content=True))
        assert _code(exc_info) == "MODERATION_EMBED_NOT_ALLOWED"

    def test_youtube_without_attrs_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_rich_content(_doc({"type": "youtube"}), _settings(allow_rich_content=True))
        assert _code(exc_info) == "MODERATION_EMBED_NOT_ALLOWED"

    @pytest.mark.parametrize("node_type", ["image", "iframe", "video", "html", "embed"])
    def test_unknown_node_types_rejected_regardless_of_flag(self, node_type):
        node = {"type": node_type, "attrs": {"src": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}}
        for flag in (False, True):
            with pytest.raises(HTTPException) as exc_info:
                validate_rich_content(_doc(node), _settings(allow_rich_content=flag))
            assert _code(exc_info) == "MODERATION_UNSUPPORTED_CONTENT"

    def test_unknown_mark_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_rich_content(_doc(_paragraph(marks=[{"type": "textStyle", "attrs": {"color": "red"}}])), _settings())
        assert _code(exc_info) == "MODERATION_UNSUPPORTED_CONTENT"

    def test_javascript_link_rejected(self):
        content = _doc(_paragraph("x", marks=[{"type": "link", "attrs": {"href": "javascript:alert(1)"}}]))
        with pytest.raises(HTTPException) as exc_info:
            validate_rich_content(content, _settings())
        assert _code(exc_info) == "MODERATION_LINK_NOT_ALLOWED"

    def test_relative_and_mailto_links_pass(self):
        content = _doc(
            _paragraph("x", marks=[{"type": "link", "attrs": {"href": "/courses"}}]),
            _paragraph("y", marks=[{"type": "link", "attrs": {"href": "mailto:a@example.com"}}]),
        )
        validate_rich_content(content, _settings())

    def test_malformed_structure_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_rich_content(json.dumps({"type": "doc", "content": "nope"}), _settings())
        assert _code(exc_info) == "MODERATION_UNSUPPORTED_CONTENT"
        with pytest.raises(HTTPException) as exc_info:
            validate_rich_content(json.dumps({"type": "doc", "content": ["nope"]}), _settings())
        assert _code(exc_info) == "MODERATION_UNSUPPORTED_CONTENT"
