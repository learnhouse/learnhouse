import logging
import os
import importlib
from config.config import get_learnhouse_config
from fastapi import FastAPI
from sqlmodel import SQLModel, Session, create_engine
from sqlalchemy import event
from urllib.parse import urlparse

def import_all_models():
    # List of directories to scan for models
    model_configs = [
        {'base_dir': 'src/db', 'base_module_path': 'src.db'},
        {'base_dir': 'ee/db', 'base_module_path': 'ee.db'}
    ]
    
    for config in model_configs:
        base_dir = config['base_dir']
        base_module_path = config['base_module_path']
        
        if not os.path.exists(base_dir):
            continue

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
                try:
                    importlib.import_module(full_module_path)
                except Exception as e:
                    logging.error(f"Failed to import model {full_module_path}: {e}")

# Import all models before creating engine
import_all_models()

learnhouse_config = get_learnhouse_config()

def detect_database_type(connection_string: str) -> str:
    """Detect database type from connection string"""
    if 'neon.tech' in connection_string:
        return 'neon'
    elif 'localhost' in connection_string or '127.0.0.1' in connection_string:
        return 'docker'
    else:
        return 'postgresql'  # Generic PostgreSQL

def get_engine_config(connection_string: str, db_type: str):
    """Get engine configuration based on database type"""
    base_config = {
        'echo': False,
        'pool_pre_ping': True,
    }
    
    if db_type == 'neon':
        # Neon (serverless) optimized configuration
        # Neon handles scaling, so we use smaller pools
        # Connections timeout faster, so shorter recycle time
        base_config.update({
            'pool_size': 5,
            'max_overflow': 5,
            'pool_recycle': 180,  # 3 minutes - Neon connections timeout faster
            'pool_timeout': 30,
        })
        # Parse connection string to ensure SSL is required
        parsed = urlparse(connection_string)
        if 'sslmode' not in parsed.query:
            # Add sslmode=require if not present
            separator = '&' if parsed.query else '?'
            connection_string = f"{connection_string}{separator}sslmode=require"
        logging.info("Using Neon PostgreSQL (serverless) configuration")
    elif db_type == 'docker':
        # Docker/standard PostgreSQL configuration
        base_config.update({
            'pool_size': 20,
            'max_overflow': 10,
            'pool_recycle': 300,  # 5 minutes
            'pool_timeout': 30,
        })
        logging.info("Using Docker PostgreSQL configuration")
    else:
        # Generic PostgreSQL configuration (default)
        base_config.update({
            'pool_size': 20,
            'max_overflow': 10,
            'pool_recycle': 300,
            'pool_timeout': 30,
        })
        logging.info("Using standard PostgreSQL configuration")
    
    return connection_string, base_config

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
    connection_string = learnhouse_config.database_config.sql_connection_string  # type: ignore
    db_type = detect_database_type(connection_string)
    connection_string, engine_config = get_engine_config(connection_string, db_type)
    
    engine = create_engine(
        connection_string,
        **engine_config
    )
    
    # Add connection pool monitoring for debugging
    @event.listens_for(engine, "connect")
    def receive_connect(dbapi_connection, connection_record):
        logging.debug("Database connection established")
    
    @event.listens_for(engine, "checkout")
    def receive_checkout(dbapi_connection, connection_record, connection_proxy):
        logging.debug("Connection checked out from pool")
    
    @event.listens_for(engine, "checkin")
    def receive_checkin(dbapi_connection, connection_record):
        logging.debug("Connection returned to pool")

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
