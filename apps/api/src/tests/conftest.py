import sys
import os

# Ensure src/ is on the Python path for all tests
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

# Set testing environment variable to use SQLite
os.environ["TESTING"] = "true"

# Set a valid JWT secret key for tests (must be at least 32 characters)
os.environ["LEARNHOUSE_AUTH_JWT_SECRET_KEY"] = "test-secret-key-for-unit-tests-32chars!"
