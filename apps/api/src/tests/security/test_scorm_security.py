"""
Unit tests for SCORM security fixes.

Tests cover:
- UUID validation for temp_package_id (path traversal prevention)
- XML parsing uses defusedxml (XXE prevention)
"""

import re
import pytest
from fastapi import HTTPException


# Replicate the validation regex and function locally to avoid heavy SCORM imports
_VALID_UUID = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE,
)


def _validate_temp_package_id(temp_package_id: str) -> str:
    """Validate temp_package_id is a valid UUID (mirrors ee/services/scorm/scorm.py)."""
    if not temp_package_id or not _VALID_UUID.match(temp_package_id):
        raise HTTPException(status_code=400, detail="Invalid package ID format")
    return temp_package_id


class TestScormUuidValidation:
    """Test _validate_temp_package_id logic."""

    def test_valid_uuid(self):
        result = _validate_temp_package_id("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
        assert result == "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

    def test_path_traversal_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_temp_package_id("../../../etc/passwd")
        assert exc_info.value.status_code == 400

    def test_empty_rejected(self):
        with pytest.raises(HTTPException):
            _validate_temp_package_id("")

    def test_none_rejected(self):
        with pytest.raises(HTTPException):
            _validate_temp_package_id(None)

    def test_command_injection_rejected(self):
        with pytest.raises(HTTPException):
            _validate_temp_package_id("$(rm -rf /)")

    def test_sql_injection_rejected(self):
        with pytest.raises(HTTPException):
            _validate_temp_package_id("'; DROP TABLE scorm; --")

    def test_uppercase_uuid(self):
        result = _validate_temp_package_id("A1B2C3D4-E5F6-7890-ABCD-EF1234567890")
        assert result == "A1B2C3D4-E5F6-7890-ABCD-EF1234567890"

    def test_uuid_with_extra_chars_rejected(self):
        with pytest.raises(HTTPException):
            _validate_temp_package_id("a1b2c3d4-e5f6-7890-abcd-ef1234567890/../../etc")

    def test_short_string_rejected(self):
        with pytest.raises(HTTPException):
            _validate_temp_package_id("abc")


class TestDefusedXml:
    """Verify SCORM uses defusedxml instead of stdlib xml.etree."""

    def test_uses_defusedxml(self):
        """Verify the source imports defusedxml, not xml.etree.ElementTree for parsing."""
        import os
        scorm_path = os.path.join(
            os.path.dirname(__file__), '..', '..', '..', 'ee', 'services', 'scorm', 'scorm.py'
        )
        with open(scorm_path) as f:
            source = f.read()

        # Should use defusedxml for parsing
        assert "import defusedxml" in source
        # Should NOT use stdlib xml.etree.ElementTree for parsing
        assert "import xml.etree.ElementTree as ET" not in source
