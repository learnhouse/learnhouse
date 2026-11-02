from logging.config import fileConfig
import os
import alembic_postgresql_enum # noqa: F401
from sqlalchemy import engine_from_config
from sqlalchemy import pool
from sqlmodel import SQLModel
from alembic import context

from config.config import get_learnhouse_config
from src.core.migrations import load_models, sync_database_url

# LearnHouse config

lh_config = get_learnhouse_config()

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Alembic must target the same DB as the running app. The alembic.ini URL is
# only a dev fallback (hardcoded localhost). When the app runs migrations
# itself (src/core/migrations.py) it hands over a connection instead.
_connection = config.attributes.get("connection")
if _connection is None:
    _runtime_db_url = os.environ.get("LEARNHOUSE_SQL_CONNECTION_STRING")
    if not _runtime_db_url:
        _configured = lh_config.database_config.sql_connection_string
        _runtime_db_url = str(_configured) if _configured else None
    if _runtime_db_url:
        # Alembic uses psycopg2 (sync); strip the async driver suffix if present.
        config.set_main_option("sqlalchemy.url", sync_database_url(_runtime_db_url))

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata

# Every model, core and EE when present, wherever alembic is run from.
load_models()

target_metadata = SQLModel.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    if _connection is not None:
        context.configure(connection=_connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
        return

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
