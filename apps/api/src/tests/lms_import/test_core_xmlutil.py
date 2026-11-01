"""xmlutil: safe parsing of untrusted export XML and small element helpers."""

from __future__ import annotations

import pytest

from src.services.courses.lms_import import xmlutil
from src.services.courses.lms_import.xmlutil import (
    XmlError,
    attr,
    children,
    first,
    inner_text,
    local,
    parse_bytes,
    parse_file,
    text,
    to_bool,
    to_float,
    to_int,
    try_parse_file,
)


def test_namespaces_are_stripped_from_tags_and_attributes():
    root = parse_bytes(b"""<?xml version="1.0"?>
    <manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
              xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
              xmlns:xlink="http://www.w3.org/1999/xlink">
      <resources><resource adlcp:scormtype="sco" xlink:href="a.html" xml:lang="fr" identifier="r1"/></resources>
    </manifest>""")
    assert root.tag == "manifest"
    res = root.find("resources/resource")
    assert res is not None
    assert res.get("scormtype") == "sco"
    assert res.get("href") == "a.html"
    assert res.get("lang") == "fr"
    assert res.get("identifier") == "r1"
    # the namespaced key is kept as well
    assert res.get("{http://www.adlnet.org/xsd/adlcp_rootv1p2}scormtype") == "sco"


def test_local_attribute_does_not_override_plain_one():
    root = parse_bytes(b'<a xmlns:x="urn:x" href="plain" x:href="ns"/>')
    assert root.get("href") == "plain"


def test_invalid_control_characters_are_removed():
    root = parse_bytes(b"<a>x\x01y\x08z\x0b\x0c\x1f</a>")
    assert root.text == "xyz"


def test_invalid_character_references_are_removed():
    root = parse_bytes(b"<a>x&#8;y&#x1B;z&#11;&#31;&#X0c;&#x0001F;</a>")
    assert root.text == "xyz"
    # valid references survive
    assert parse_bytes(b"<a>&#9;&#10;&#65;&#x42;&#13;</a>").text == "\t\nAB\r"


def test_utf16_documents_parse():
    xml = '<?xml version="1.0" encoding="UTF-16"?><a>héllo\x01</a>'
    for encoding in ("utf-16", "utf-16-be"):
        data = xml.encode(encoding)
        if encoding == "utf-16-be":
            data = b"\xfe\xff" + data
        assert parse_bytes(data).text == "héllo"


def test_broken_utf16_is_reported():
    with pytest.raises(XmlError):
        parse_bytes(b"\xff\xfe<\x00a\x00\x00\xd8")  # lone surrogate


def test_utf8_bom_is_fine():
    assert parse_bytes("﻿<a>ok</a>".encode("utf-8")).text == "ok"


def test_malformed_xml_raises_xml_error():
    with pytest.raises(XmlError):
        parse_bytes(b"<a><b></a>")
    with pytest.raises(XmlError):
        parse_bytes(b"")


def test_billion_laughs_is_refused():
    bomb = b"""<?xml version="1.0"?>
    <!DOCTYPE lolz [
      <!ENTITY lol "lol">
      <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
      <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
    ]>
    <lolz>&lol3;</lolz>"""
    with pytest.raises(XmlError):
        parse_bytes(bomb)


def test_external_entity_is_refused(tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("TOPSECRET")
    xxe = f"""<?xml version="1.0"?>
    <!DOCTYPE r [<!ENTITY x SYSTEM "file://{secret}">]><r>&x;</r>""".encode()
    with pytest.raises(XmlError):
        parse_bytes(xxe)


def test_parse_file_and_try_parse_file(tmp_path):
    good = tmp_path / "good.xml"
    good.write_bytes(b"<r><c>1</c></r>")
    bad = tmp_path / "bad.xml"
    bad.write_bytes(b"<r>")
    assert parse_file(str(good)).find("c").text == "1"
    assert try_parse_file(str(good)) is not None
    assert try_parse_file(str(bad)) is None
    assert try_parse_file(str(tmp_path / "missing.xml")) is None
    with pytest.raises(OSError):
        parse_file(str(tmp_path / "missing.xml"))


def test_local():
    assert local("{urn:x}tag") == "tag"
    assert local("tag") == "tag"


def test_text_helper():
    root = parse_bytes(b"<r><a>  hi  </a><b/><c><d>deep</d></c></r>")
    assert text(root, "a") == "hi"
    assert text(root, "b", "dflt") == "dflt"
    assert text(root, "missing", "x") == "x"
    assert text(root, "c/d") == "deep"
    assert text(root.find("a")) == "hi"
    assert text(None, "a", "n") == "n"


def test_inner_text_attr_children_first():
    root = parse_bytes(b'<r k="v"><i>a<b>b</b>c</i><i>d</i><j/></r>')
    assert inner_text(root) == "abcd"
    assert inner_text(None) == ""
    assert attr(root, "k") == "v"
    assert attr(root, "nope", "d") == "d"
    assert attr(None, "k", "d") == "d"
    assert [inner_text(c) for c in children(root, "i")] == ["abc", "d"]
    assert children(None, "i") == []
    assert first(children(root, "j")) is not None
    assert first([]) is None


def test_attr_keeps_empty_string():
    root = parse_bytes(b'<r k=""/>')
    assert attr(root, "k", "default") == ""


@pytest.mark.parametrize("value,expected", [("3", 3), (" 4.9 ", 4), ("-2", -2), ("x", 0), (None, 0), (7, 7),
                                            ("1e999", 0), ("inf", 0), ("nan", 0)])
def test_to_int(value, expected):
    assert to_int(value) == expected


def test_to_int_default():
    assert to_int("bad", 5) == 5


@pytest.mark.parametrize("value,expected", [("1.5", 1.5), (" 2 ", 2.0), ("nan?", 0.0), (None, 0.0),
                                            ("1e999", 0.0), ("-inf", 0.0), ("nan", 0.0)])
def test_to_float(value, expected):
    assert to_float(value) == expected


def test_to_float_default():
    assert to_float("", 9.0) == 9.0


@pytest.mark.parametrize("value,expected", [
    ("1", True), ("TRUE", True), (" yes ", True), ("y", True), ("on", True), (1, True),
    ("0", False), ("false", False), ("No", False), ("n", False), ("off", False), ("", False), (0, False),
])
def test_to_bool(value, expected):
    assert to_bool(value) is expected


def test_to_bool_default():
    assert to_bool(None) is False
    assert to_bool(None, True) is True
    assert to_bool("maybe", True) is True


def test_strip_ns_skips_non_string_tags():
    from xml.etree.ElementTree import Comment, Element

    el = Element("{urn:x}root")
    el.append(Comment("c"))
    assert xmlutil._strip_ns(el).tag == "root"
