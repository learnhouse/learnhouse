"""The Alembic revision graph stays a single, unambiguous line.

Revision ids are written by hand in this repo, so two migrations can end up
sharing one, or a branch can add a second head. Alembic only warns about the
first and refuses ``upgrade head`` on the second, and the API runs migrations
on start, so either one stops a deploy.
"""

import re
import warnings
from collections import Counter
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

MIGRATIONS = Path(__file__).resolve().parents[3] / "migrations"
_REVISION = re.compile(r"^revision(?::\s*str)?\s*=\s*['\"]([^'\"]+)['\"]", re.M)


def test_revision_ids_are_unique():
    # Alembic keeps the last file with a given id and only warns, so count
    # the declarations in the files themselves.
    revisions = [
        match.group(1)
        for path in (MIGRATIONS / "versions").glob("*.py")
        if (match := _REVISION.search(path.read_text()))
    ]
    assert revisions, f"no migrations found in {MIGRATIONS}"
    duplicates = [rev for rev, n in Counter(revisions).items() if n > 1]
    assert not duplicates, f"revision ids used by more than one migration: {duplicates}"


def test_single_head():
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        heads = ScriptDirectory.from_config(config).get_heads()
    assert len(heads) == 1, f"expected one head, found {heads}"
