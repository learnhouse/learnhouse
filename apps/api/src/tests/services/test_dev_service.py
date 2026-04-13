from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from src.services.dev.dev import isDevModeEnabled, isDevModeEnabledOrRaise


def _config(development_mode: bool):
    return SimpleNamespace(
        general_config=SimpleNamespace(development_mode=development_mode)
    )


def test_is_dev_mode_enabled_true():
    with patch("src.services.dev.dev.get_learnhouse_config", return_value=_config(True)):
        assert isDevModeEnabled() is True


def test_is_dev_mode_enabled_false():
    with patch("src.services.dev.dev.get_learnhouse_config", return_value=_config(False)):
        assert isDevModeEnabled() is False


def test_is_dev_mode_enabled_or_raise_true():
    with patch("src.services.dev.dev.get_learnhouse_config", return_value=_config(True)):
        assert isDevModeEnabledOrRaise() is True


def test_is_dev_mode_enabled_or_raise_raises_when_disabled():
    with patch("src.services.dev.dev.get_learnhouse_config", return_value=_config(False)):
        with pytest.raises(HTTPException) as exc:
            isDevModeEnabledOrRaise()

    assert exc.value.status_code == 403
    assert exc.value.detail == "Development mode is disabled"
