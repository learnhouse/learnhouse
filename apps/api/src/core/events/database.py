import logging
import os
import importlib
from config.config import get_learnhouse_config
from fastapi import FastAPI
from sqlmodel import SQLModel, Session, create_engine

def import_all_models():
    base_dir = 'src/db'
    base_module_path = 'src.db'
    
    # Recursively walk through the base directory
    for root, dirs, files in os.walk(base_dir):
        # Filter out __init__.py and non-Python files
        module_files = [f for f in files if f.endswith('.py') and f != '__init__.py']
        
        # Calculate the module's base path from its directory structure
        path_diff = os.path.relpath(root, base_dir)
        if path_diff == '.':
            current_module_base = base_module_path
        else:
            current_module_base = f"{base_module_path}.{path_diff.replace(os.sep, '.')}"
        
        # Dynamically import each module
        for file_name in module_files:
            module_name = file_name[:-3]  # Remove the '.py' extension
            full_module_path = f"{current_module_base}.{module_name}"
            importlib.import_module(full_module_path)

# Import all models before creating engine
import_all_models()

learnhouse_config = get_learnhouse_config()

# Check if we're in test mode
is_testing = os.getenv("TESTING", "false").lower() == "true"

if is_testing:
    # Use SQLite for tests
    engine = create_engine(
        "sqlite:///:memory:",
        echo=False,
        connect_args={"check_same_thread": False}
    )
else:
    # Use configured database for production/development
    engine = create_engine(
        learnhouse_config.database_config.sql_connection_string,  # type: ignore
        echo=False, 
        pool_pre_ping=True,  # type: ignore
        pool_size=5,  
        max_overflow=0,
        pool_recycle=300,  # Recycle connections after 5 minutes
        pool_timeout=30
    )

# Only create tables if not in test mode (tests will handle this themselves)
if not is_testing:
    SQLModel.metadata.create_all(engine)
    # Note: logfire instrumentation will be handled in app.py after configuration

async def connect_to_db(app: FastAPI):
    app.db_engine = engine  # type: ignore
    logging.info("LearnHouse database has been started.")
    # Only create tables if not in test mode
    if not is_testing:
        SQLModel.metadata.create_all(engine)

def get_db_session():
    with Session(engine) as session:
        yield session

async def close_database(app: FastAPI):
    logging.info("LearnHouse has been shut down.")
    return app
