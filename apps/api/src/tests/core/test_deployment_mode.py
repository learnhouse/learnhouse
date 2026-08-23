from types import SimpleNamespace
from unittest.mock import patch

from src.core.deployment_mode import get_deployment_mode


def _config(saas_mode: bool):
    return SimpleNamespace(general_config=SimpleNamespace(saas_mode=saas_mode))


def test_get_deployment_mode_prefers_saas_over_ee():
    with (
        patch("src.core.deployment_mode.get_learnhouse_config", return_value=_config(True)),
        patch("src.core.deployment_mode.is_ee_available", return_value=True),
    ):
        assert get_deployment_mode() == "saas"


def test_get_deployment_mode_fails_closed_when_ee_hooks_do_not_load():
    """An unimportable EE package must NOT grant EE.

    This used to assert "ee". is_ee_available() only checks that an `ee`
    directory exists, so any import error in the EE tree — a missing
    dependency, a broken submodule, a stray empty directory — reached this
    branch and unlocked every EE feature with the license check never run and
    verify_manifest() never called, since its only caller lives inside the
    module that failed to import.
    """
    with (
        patch("src.core.deployment_mode.get_learnhouse_config", return_value=_config(False)),
        patch("src.core.deployment_mode.is_ee_available", return_value=True),
        patch("src.core.deployment_mode.get_ee_hooks", return_value=None),
    ):
        assert get_deployment_mode() == "oss"


def test_get_deployment_mode_returns_oss_when_ee_unavailable():
    with (
        patch("src.core.deployment_mode.get_learnhouse_config", return_value=_config(False)),
        patch("src.core.deployment_mode.is_ee_available", return_value=False),
    ):
        assert get_deployment_mode() == "oss"


def test_get_deployment_mode_returns_ee_when_license_active():
    hooks = SimpleNamespace(is_license_active=lambda: True)
    with (
        patch("src.core.deployment_mode.get_learnhouse_config", return_value=_config(False)),
        patch("src.core.deployment_mode.is_ee_available", return_value=True),
        patch("src.core.deployment_mode.get_ee_hooks", return_value=hooks),
    ):
        assert get_deployment_mode() == "ee"


def test_get_deployment_mode_degrades_to_oss_when_license_inactive():
    hooks = SimpleNamespace(is_license_active=lambda: False)
    with (
        patch("src.core.deployment_mode.get_learnhouse_config", return_value=_config(False)),
        patch("src.core.deployment_mode.is_ee_available", return_value=True),
        patch("src.core.deployment_mode.get_ee_hooks", return_value=hooks),
    ):
        assert get_deployment_mode() == "oss"


def test_get_deployment_mode_fails_closed_for_hooks_without_license_check():
    """Hooks lacking is_license_active must NOT grant EE.

    This also used to assert "ee", to keep pre-licensing EE builds working.
    That grace period is over — the license client shipped in 1.2.2 — and the
    branch was a license bypass anyone could reach by removing one function
    from an unsigned file. Deliberate behaviour change: an EE build older than
    1.2.2 now runs as OSS instead of unlicensed EE.
    """
    hooks = SimpleNamespace()
    with (
        patch("src.core.deployment_mode.get_learnhouse_config", return_value=_config(False)),
        patch("src.core.deployment_mode.is_ee_available", return_value=True),
        patch("src.core.deployment_mode.get_ee_hooks", return_value=hooks),
    ):
        assert get_deployment_mode() == "oss"


def test_empty_ee_dir_does_not_count_as_ee_available(tmp_path, monkeypatch):
    """A directory named "ee" with no hooks.py is not an EE install.

    get_deployment_mode() already fails closed on a hooks module it cannot
    load, but is_ee_available() is consulted on its own elsewhere, so it
    should not claim EE is present either.
    """
    from src.core.ee_hooks import is_ee_available

    monkeypatch.delenv("LEARNHOUSE_DISABLE_EE", raising=False)
    monkeypatch.chdir(tmp_path)
    (tmp_path / "ee").mkdir()
    assert is_ee_available() is False

    (tmp_path / "ee" / "hooks.py").write_text("")
    assert is_ee_available() is True
