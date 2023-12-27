from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session
from src.tests.utils.init_data_for_tests import create_initial_data_for_tests
from src.core.events.database import get_db_session
import pytest
import asyncio
from app import app

client = TestClient(app)

# TODO : fix this later https://stackoverflow.com/questions/10253826/path-issue-with-pytest-importerror-no-module-named


@pytest.fixture(name="session", scope="session")
def session_fixture():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture(name="client")
def client_fixture(session: Session):
    def get_session_override():
        return session

    app.dependency_overrides[get_db_session] = get_session_override

    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


@pytest.fixture(scope="session", autouse=True)
def execute_before_all_tests(session: Session):
    # This function will run once before all tests.
    asyncio.run(create_initial_data_for_tests(session))


def test_create_default_elements(client: TestClient, session: Session):
    
    response = client.get(
        "/api/v1/orgs/slug/wayne",
    ) 

    assert response.status_code == 200
