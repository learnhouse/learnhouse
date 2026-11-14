"""The LearnHouse version this API reports (OpenAPI docs, ``app.version``).

One source of truth instead of a literal in ``app.py`` that drifted from the
release: ``LEARNHOUSE_VERSION`` when the deployment sets it (e.g. from the
release tag at image build), otherwise the version in ``pyproject.toml``,
which the release process bumps.
"""

import os
import tomllib
from functools import lru_cache
from pathlib import Path

_PYPROJECT = Path(__file__).resolve().parents[2] / "pyproject.toml"
UNKNOWN_VERSION = "0.0.0"


@lru_cache(maxsize=1)
def get_learnhouse_version() -> str:
    override = os.environ.get("LEARNHOUSE_VERSION", "").strip()
    if override:
        # Release tags are bare ("1.4.3"); tolerate a "v" prefix anyway.
        return override.removeprefix("v")
    try:
        with _PYPROJECT.open("rb") as fh:
            version = tomllib.load(fh).get("project", {}).get("version")
    except (OSError, tomllib.TOMLDecodeError):
        return UNKNOWN_VERSION
    return version if isinstance(version, str) and version else UNKNOWN_VERSION
