import importlib
from logging.config import fileConfig
import os

from sqlalchemy import engine_from_config
from sqlalchemy import pool
from sqlmodel import SQLModel
from alembic import context

from config.config import get_learnhouse_config

# LearnHouse config

lh_config = get_learnhouse_config()

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata

# IMPORTING ALL SCHEMAS
base_dir = 'src/db'
base_module_path = 'src.db'

# Recursively walk through the base directory
for root, dirs, files in os.walk(base_dir):
    # Filter out __init__.py and non-Python files
    module_files = [f for f in files if f.endswith('.py') and f != '__init__.py']
    # Calculate the module's base path from its directory structure
    path_diff = os.path.relpath(root, base_dir)
    if path_diff == '.':
        # Root of the base_dir, no additional path to add
        current_module_base = base_module_path
    else:
        # Convert directory path to a module path
        current_module_base = f"{base_module_path}.{path_diff.replace(os.sep, '.')}"
    
    # Dynamically import each module
    for file_name in module_files:
        module_name = file_name[:-3]  # Remove the '.py' extension
        full_module_path = f"{current_module_base}.{module_name}"
        importlib.import_module(full_module_path)

# IMPORTING ALL SCHEMAS

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
