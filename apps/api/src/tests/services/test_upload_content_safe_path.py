"""_safe_content_path containment check in src/services/utils/upload_content.py."""

import pytest
from fastapi import HTTPException

from src.services.utils import upload_content as uc


def test_safe_content_path_rejects_when_commonpath_cannot_compare(monkeypatch):
    """os.path.commonpath raises ValueError for paths it can't compare (e.g.
    different drives on Windows). That must be treated as "not contained" and
    rejected, never as a pass."""

    def _boom(paths):
        raise ValueError("Paths don't have the same drive")

    monkeypatch.setattr(uc.os.path, "commonpath", _boom)
    with pytest.raises(HTTPException) as exc:
        uc._safe_content_path("orgs", "org_1", "logos")
    assert exc.value.status_code == 400
    assert exc.value.detail == "Invalid file path"
