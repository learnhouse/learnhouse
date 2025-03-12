import logging
import logfire
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
engine = create_engine(
    learnhouse_config.database_config.sql_connection_string,  # type: ignore
    echo=False, 
    pool_pre_ping=True  # type: ignore
)

# Create all tables after importing all models
SQLModel.metadata.create_all(engine)
logfire.instrument_sqlalchemy(engine=engine)

async def connect_to_db(app: FastAPI):
    app.db_engine = engine  # type: ignore
    logging.info("LearnHouse database has been started.")
    SQLModel.metadata.create_all(engine)

def get_db_session():
    with Session(engine) as session:
        yield session

async def close_database(app: FastAPI):
    logging.info("LearnHouse has been shut down.")
    return app
