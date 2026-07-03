"""
SCORM manifest parsing + version detection + SCO extraction.

Pure-function coverage of ee/services/scorm/scorm.py. Skips cleanly when the
EE package is absent (OSS builds / worktrees without apps/api/ee).
"""

import defusedxml.ElementTree as ET
import pytest

scorm = pytest.importorskip("ee.services.scorm.scorm")
from ee.db.scorm import ScormVersionEnum  # noqa: E402

from src.tests.fixtures import scorm_packages as pkg  # noqa: E402


def _root(manifest_str: str):
    return ET.fromstring(manifest_str)


class TestVersionDetection:
    def test_detects_12(self):
        root = _root(pkg.manifest_12_single())
        assert scorm.detect_scorm_version(root) == ScormVersionEnum.SCORM_12

    def test_detects_12_multi(self):
        root = _root(pkg.manifest_12_multi())
        assert scorm.detect_scorm_version(root) == ScormVersionEnum.SCORM_12

    def test_detects_2004_via_namespace(self):
        root = _root(pkg.manifest_2004_single())
        assert scorm.detect_scorm_version(root) == ScormVersionEnum.SCORM_2004

    def test_detects_2004_multi(self):
        root = _root(pkg.manifest_2004_multi())
        assert scorm.detect_scorm_version(root) == ScormVersionEnum.SCORM_2004


class TestScoExtraction:
    def test_single_sco(self):
        root = _root(pkg.manifest_12_single())
        scos = scorm.extract_scos_from_manifest(root, ScormVersionEnum.SCORM_12)
        assert len(scos) == 1
        assert scos[0].launch_path == "index.html"

    def test_multi_sco_order_and_paths(self):
        root = _root(pkg.manifest_12_multi())
        scos = scorm.extract_scos_from_manifest(root, ScormVersionEnum.SCORM_12)
        assert [s.launch_path for s in scos] == [
            "lesson1/index.html", "lesson2/index.html", "lesson3/index.html",
        ]
        assert [s.title for s in scos] == ["Lesson A", "Lesson B", "Lesson C"]

    def test_nested_items_yield_leaf_scos_only(self):
        root = _root(pkg.manifest_nested_items())
        scos = scorm.extract_scos_from_manifest(root, ScormVersionEnum.SCORM_12)
        # The wrapping chapter item has no launch path; only the two leaves count.
        assert len(scos) == 2
        assert {s.launch_path for s in scos} == {"a.html", "b.html"}

    def test_resource_without_type_still_detected(self):
        root = _root(pkg.manifest_no_type_resource())
        scos = scorm.extract_scos_from_manifest(root, ScormVersionEnum.SCORM_12)
        assert len(scos) == 1
        assert scos[0].launch_path == "start.html"

    def test_2004_scormtype_camelcase_detected(self):
        # 2004 manifests commonly use adlcp:scormType (capital T).
        root = _root(pkg.manifest_2004_single())
        scos = scorm.extract_scos_from_manifest(root, ScormVersionEnum.SCORM_2004)
        assert len(scos) == 1
        assert scos[0].launch_path == "index.html"

    def test_unicode_title_preserved(self):
        root = _root(pkg.manifest_unicode())
        title = scorm.get_package_title(root)
        assert "日本語" in title and "Café" in title

    def test_xml_base_prepended_to_href(self):
        manifest = (
            '<?xml version="1.0"?>'
            '<manifest identifier="M" version="1.0" '
            'xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" '
            'xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">'
            '<organizations default="O"><organization identifier="O"><title>T</title>'
            '<item identifier="I" identifierref="R"><title>S</title></item>'
            '</organization></organizations>'
            '<resources xml:base="content/">'
            '<resource identifier="R" type="webcontent" adlcp:scormtype="sco" '
            'xml:base="mod1/" href="index.html"><file href="index.html"/></resource>'
            '</resources></manifest>'
        )
        root = _root(manifest)
        scos = scorm.extract_scos_from_manifest(root, ScormVersionEnum.SCORM_12)
        assert scos[0].launch_path == "content/mod1/index.html"

    def test_mastery_score_parsed(self):
        manifest = (
            '<?xml version="1.0"?>'
            '<manifest identifier="M" version="1.0" '
            'xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" '
            'xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">'
            '<organizations default="O"><organization identifier="O"><title>T</title>'
            '<item identifier="I" identifierref="R"><title>S</title>'
            '<adlcp:masteryscore>80</adlcp:masteryscore></item>'
            '</organization></organizations>'
            '<resources><resource identifier="R" type="webcontent" adlcp:scormtype="sco" '
            'href="index.html"><file href="index.html"/></resource></resources></manifest>'
        )
        root = _root(manifest)
        scos = scorm.extract_scos_from_manifest(root, ScormVersionEnum.SCORM_12)
        assert scos[0].mastery_score == "80"


    def test_resource_without_href_uses_first_file(self):
        # IMS CP: a <resource> may omit href and declare the entry point as its
        # first <file> — common in some authoring-tool exports.
        manifest = (
            '<?xml version="1.0"?>'
            '<manifest identifier="M" version="1.0" '
            'xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" '
            'xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">'
            '<organizations default="O"><organization identifier="O"><title>T</title>'
            '<item identifier="I" identifierref="R"><title>S</title></item>'
            '</organization></organizations>'
            '<resources><resource identifier="R" type="webcontent" adlcp:scormtype="sco">'
            '<file href="launch/index.html"/><file href="a.js"/></resource>'
            '</resources></manifest>'
        )
        root = _root(manifest)
        scos = scorm.extract_scos_from_manifest(root, ScormVersionEnum.SCORM_12)
        assert len(scos) == 1
        assert scos[0].launch_path == "launch/index.html"

    def test_rise_dot_slash_href_normalized(self):
        # Articulate Rise emits href="./scormcontent/index.html".
        manifest = pkg.manifest_12_single(href="./scormcontent/index.html")
        root = _root(manifest)
        scos = scorm.extract_scos_from_manifest(root, ScormVersionEnum.SCORM_12)
        assert scos[0].launch_path == "scormcontent/index.html"

    def test_windows_backslash_href_normalized(self):
        manifest = pkg.manifest_12_single(href="content\\\\index.html")
        root = _root(manifest)
        scos = scorm.extract_scos_from_manifest(root, ScormVersionEnum.SCORM_12)
        assert scos[0].launch_path == "content/index.html"


class TestSanitizePath:
    def test_strips_traversal(self):
        assert scorm.sanitize_path("../../etc/passwd") == "etc/passwd"

    def test_strips_leading_slash(self):
        assert scorm.sanitize_path("/abs/path.html") == "abs/path.html"

    def test_backslashes_normalized(self):
        assert scorm.sanitize_path("a\\b\\c.html") == "a/b/c.html"

    def test_dot_segments_dropped(self):
        assert scorm.sanitize_path("./scormcontent/index.html") == "scormcontent/index.html"
        assert scorm.sanitize_path("a/./b.html") == "a/b.html"


class TestZipValidation:
    def test_valid_zip_magic(self):
        assert scorm.validate_scorm_zip(pkg.valid_12_single()) is True

    def test_not_a_zip_rejected(self):
        assert scorm.validate_scorm_zip(pkg.adv_not_a_zip()) is False
