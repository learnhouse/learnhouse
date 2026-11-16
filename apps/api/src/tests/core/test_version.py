"""The API reports the LearnHouse release version, from one source of truth."""

import tomllib
from pathlib import Path

import pytest

from src.core import version as version_mod
from src.core.version import UNKNOWN_VERSION, get_learnhouse_version

PYPROJECT = Path(__file__).resolve().parents[3] / "pyproject.toml"


@pytest.fixture(autouse=True)
def _fresh_cache(monkeypatch):
    monkeypatch.delenv("LEARNHOUSE_VERSION", raising=False)
    get_learnhouse_version.cache_clear()
    yield
    get_learnhouse_version.cache_clear()


def test_defaults_to_the_pyproject_version():
    with PYPROJECT.open("rb") as fh:
        expected = tomllib.load(fh)["project"]["version"]
    assert get_learnhouse_version() == expected


def test_app_reports_the_same_version():
    from app import app

    assert app.version == get_learnhouse_version()


def test_env_override_wins_and_drops_a_v_prefix(monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_VERSION", "v2.0.1")
    assert get_learnhouse_version() == "2.0.1"


def test_blank_override_is_ignored(monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_VERSION", "   ")
    assert get_learnhouse_version() != ""


def test_missing_pyproject_falls_back(monkeypatch, tmp_path):
    monkeypatch.setattr(version_mod, "_PYPROJECT", tmp_path / "nope.toml")
    assert get_learnhouse_version() == UNKNOWN_VERSION


def test_invalid_pyproject_falls_back(monkeypatch, tmp_path):
    bad = tmp_path / "pyproject.toml"
    bad.write_text("this is = = not toml")
    monkeypatch.setattr(version_mod, "_PYPROJECT", bad)
    assert get_learnhouse_version() == UNKNOWN_VERSION


def test_pyproject_without_a_version_falls_back(monkeypatch, tmp_path):
    empty = tmp_path / "pyproject.toml"
    empty.write_text('[project]\nname = "x"\n')
    monkeypatch.setattr(version_mod, "_PYPROJECT", empty)
    assert get_learnhouse_version() == UNKNOWN_VERSION
