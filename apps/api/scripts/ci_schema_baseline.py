"""Build the schema an existing install of an older checkout has, for CI.

Run from that checkout's apps/api directory, with LEARNHOUSE_SQL_CONNECTION_STRING
set: creates every table its models define and stamps its Alembic head, the
state a database is in right before an upgrade. Uses only what every older
checkout has (its models, alembic.ini and env.py), so it works against a base
branch that predates `cli.py migrate`.
"""

import importlib
import os
import sys
from pathlib import Path

sys.path.insert(0, os.getcwd())

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlmodel import SQLModel  # noqa: E402

for base_dir, package in (("src/db", "src.db"), ("ee/db", "ee.db")):
    for path in sorted(Path(base_dir).rglob("*.py")):
        if path.name != "__init__.py":
            importlib.import_module(".".join((package, *path.relative_to(base_dir).with_suffix("").parts)))

url = os.environ["LEARNHOUSE_SQL_CONNECTION_STRING"].replace("postgresql+asyncpg://", "postgresql://", 1)
engine = create_engine(url)
with engine.begin() as connection:
    connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    SQLModel.metadata.create_all(connection)
engine.dispose()

command.stamp(Config("alembic.ini"), "heads")
print("baseline schema created and stamped")
