"""File sniffing and text extraction for AI grading (src/services/ai/grading/documents.py)."""

import io
import zipfile

import pytest

from src.services.ai.grading import documents as docs

pytestmark = pytest.mark.asyncio


def _zip(members: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in members.items():
            z.writestr(name, data)
    return buf.getvalue()


W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
SS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'

DOCX = _zip({
    "word/document.xml": (
        f'<w:document {W}><w:body>'
        '<w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p>'
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
        '<w:sectPr/></w:body></w:document>'
    )
})
PPTX = _zip({
    "ppt/presentation.xml": "<p/>",
    "ppt/slides/slide2.xml": f"<s {A}><a:p><a:t>Second</a:t></a:p></s>",
    "ppt/slides/slide1.xml": f"<s {A}><a:p><a:t>First</a:t></a:p><a:p><a:t> </a:t></a:p></s>",
})
XLSX = _zip({
    "xl/workbook.xml": "<w/>",
    "xl/sharedStrings.xml": f"<sst {SS}><si><t>Name</t></si><si><t>Ada</t></si></sst>",
    "xl/worksheets/sheet1.xml": (
        f'<worksheet {SS}><sheetData>'
        '<row><c t="s"><v>0</v></c><c><v>42</v></c></row>'
        '<row><c t="s"><v>1</v></c><c t="inlineStr"><is><t>inline</t></is></c></row>'
        '<row><c><v></v></c></row>'
        '</sheetData></worksheet>'
    ),
})
XLSX_NO_STRINGS = _zip({
    "xl/workbook.xml": "<w/>",
    "xl/worksheets/sheet1.xml": f'<worksheet {SS}><sheetData><row><c><v>7</v></c></row></sheetData></worksheet>',
})


@pytest.mark.parametrize(
    "data,name,kind",
    [
        (b"%PDF-1.4 x", "a.pdf", "pdf"),
        (b"\xff\xd8\xff\xe0rest", "a.jpg", "image"),
        (b"\x89PNG\r\n\x1a\nrest", "a.png", "image"),
        (b"GIF89a....", "a.gif", "image"),
        (b"RIFF\x00\x00\x00\x00WEBPVP8 ", "a.webp", "image"),
        (b"RIFF\x00\x00\x00\x00WAVEfmt ", "a.wav", "audio"),
        (b"ID3\x03\x00rest", "a.mp3", "audio"),
        (b"\xff\xfb\x90\x00rest", "a.mp3", "audio"),
        (b"OggS\x00rest", "a.ogg", "audio"),
        (b"\x1a\x45\xdf\xa3rest", "a.webm", "video"),
        (b"\x00\x00\x00\x20ftypM4A rest", "a.m4a", "audio"),
        (b"\x00\x00\x00\x20ftypisomrest", "a.m4a", "audio"),
        (b"\x00\x00\x00\x20ftypisomrest", "a.mp4", "video"),
        (DOCX, "a.docx", "document"),
        (PPTX, "a.pptx", "slides"),
        (XLSX, "a.xlsx", "spreadsheet"),
        (_zip({"x.txt": "hi"}), "a.zip", "archive"),
        (b"PK\x03\x04broken", "a.zip", "unknown"),
        (b"<!DOCTYPE html><p>hi</p>", "a.txt", "html"),
        (b"hello", "page.htm", "html"),
        (b"just text", "notes", "text"),
        (b"\xff\xfeh\x00i\x00", "u16.txt", "text"),
        (b"\x00\x01\x02binary", "a.bin", "unknown"),
        (b"\xff\xfe\x00\xd8", "badu16.txt", "unknown"),
        (b"\xc3\x28 invalid utf8", "a.txt", "unknown"),
    ],
)
async def test_sniff(data, name, kind):
    assert docs.sniff(data, name)[0] == kind


async def test_extract_docx_pptx_xlsx():
    d = docs.extract("document", DOCX, "a.docx")
    assert "Hello world" in d.text and "a | b" in d.text
    p = docs.extract("slides", PPTX, "a.pptx")
    assert p.text.index("First") < p.text.index("Second") and p.pages == 2
    x = docs.extract("spreadsheet", XLSX, "a.xlsx")
    assert "Name | 42" in x.text and "Ada | inline" in x.text
    assert docs.extract("spreadsheet", XLSX_NO_STRINGS, "a.xlsx").text.endswith("7")


async def test_extract_empty_docx_has_note():
    empty = _zip({"word/document.xml": f"<w:document {W}><w:body/></w:document>"})
    assert docs.extract("document", empty, "a.docx").note
    assert docs.extract("document", _zip({"other.xml": "x"}), "a.docx").note  # no document.xml


async def test_extract_archive_reads_text_members_only():
    data = _zip({"src/main.py": "print('hi')", "img.png": b"\x89PNG", "big.txt": "x" * (docs.MAX_ZIP_MEMBER_BYTES + 1), "bad.txt": b"\x00\x01"})
    out = docs.extract("archive", data, "a.zip")
    assert "src/main.py" in out.text and "print('hi')" in out.text
    assert "x" * 100 not in out.text


async def test_extract_bad_zip_and_xml():
    assert docs.extract("document", b"PK\x03\x04nope", "a.docx").note
    broken = _zip({"word/document.xml": "<not closed"})
    assert docs.extract("document", broken, "a.docx").note


async def test_extract_text_html_and_media():
    assert docs.extract("text", b"plain", "a.txt").text == "plain"
    assert "Title" in docs.extract("html", b"<html><script>x()</script><h1>Title</h1></html>", "a.html").text
    assert docs.extract("image", b"x", "a.png").text == ""


async def test_extract_truncates_long_text():
    out = docs.extract("text", b"a" * (docs.MAX_CHARS + 10), "a.txt")
    assert out.truncated and len(out.text) == docs.MAX_CHARS


async def test_member_too_big_is_skipped():
    with zipfile.ZipFile(io.BytesIO(DOCX)) as z:
        assert docs._member(z, "word/document.xml", limit=1) is None


async def test_pdf_extraction(monkeypatch):
    from src.services.ai.rag import formats

    monkeypatch.setattr(formats, "pdf_pages", lambda data, max_chars: [(1, "page one")])
    out = docs.extract("pdf", b"%PDF-not-really", "a.pdf")
    assert "page one" in out.text and out.pages is None  # pypdf can't count a fake PDF

    monkeypatch.setattr(formats, "pdf_pages", lambda data, max_chars: [])
    assert docs.extract("pdf", b"%PDF", "a.pdf").note


async def test_pdf_page_count(monkeypatch):
    import sys
    import types

    from src.services.ai.rag import formats

    monkeypatch.setattr(formats, "pdf_pages", lambda data, max_chars: [(1, "t")])
    fake = types.SimpleNamespace(PdfReader=lambda _b: types.SimpleNamespace(pages=[1, 2, 3]))
    monkeypatch.setitem(sys.modules, "pypdf", fake)
    assert docs.extract("pdf", b"%PDF", "a.pdf").pages == 3
