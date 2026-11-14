"""Router tests for src/routers/courses/certifications.py.

Services are mocked; the tests pin each endpoint's path, the arguments it
forwards, and that the learner-facing "my certificates" endpoints use the
non-API-token user dependency.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.courses.certifications import CertificationRead
from src.routers.courses.certifications import router as certifications_router
from src.security.api_token_utils import get_authenticated_non_api_token_user
from src.security.auth import get_current_user

R = "src.routers.courses.certifications"
BASE = "/api/v1/certifications"


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(certifications_router, prefix=BASE)
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    app.dependency_overrides[get_authenticated_non_api_token_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


def _cert(**overrides) -> CertificationRead:
    data = dict(
        id=1,
        certification_uuid="certification_1",
        course_id=1,
        config={"certification_name": "Finisher"},
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    data.update(overrides)
    return CertificationRead(**data)


def _mock(name: str, **kwargs):
    return patch(f"{R}.{name}", new_callable=AsyncMock, **kwargs)


class TestCertificationTemplates:
    async def test_create(self, client, admin_user):
        with _mock("create_certification", return_value=_cert()) as svc:
            resp = await client.post(
                f"{BASE}/", json={"course_id": 1, "config": {"certification_name": "Finisher"}}
            )

        assert resp.status_code == 200
        assert resp.json()["certification_uuid"] == "certification_1"
        _req, obj, user, _db = svc.await_args.args
        assert obj.course_id == 1 and obj.config == {"certification_name": "Finisher"}
        assert user is admin_user

    async def test_get(self, client):
        with _mock("get_certification", return_value=_cert()) as svc:
            resp = await client.get(f"{BASE}/certification_1")

        assert resp.status_code == 200
        assert resp.json()["id"] == 1
        assert svc.await_args.args[1] == "certification_1"

    async def test_list_by_course(self, client):
        with _mock(
            "get_certifications_by_course",
            return_value=[_cert(), _cert(id=2, certification_uuid="certification_2")],
        ) as svc:
            resp = await client.get(f"{BASE}/course/course_test")

        assert resp.status_code == 200
        assert [c["certification_uuid"] for c in resp.json()] == [
            "certification_1",
            "certification_2",
        ]
        assert svc.await_args.args[1] == "course_test"

    async def test_update(self, client):
        with _mock(
            "update_certification", return_value=_cert(config={"certification_name": "New"})
        ) as svc:
            resp = await client.put(
                f"{BASE}/certification_1", json={"config": {"certification_name": "New"}}
            )

        assert resp.status_code == 200
        assert resp.json()["config"] == {"certification_name": "New"}
        _req, uuid, obj, _user, _db = svc.await_args.args
        assert uuid == "certification_1"
        assert obj.config == {"certification_name": "New"}

    async def test_delete(self, client):
        with _mock("delete_certification", return_value={"detail": "Certification deleted"}) as svc:
            resp = await client.delete(f"{BASE}/certification_1")

        assert resp.status_code == 200
        assert resp.json() == {"detail": "Certification deleted"}
        assert svc.await_args.args[1] == "certification_1"


class TestAwardedCertificates:
    async def test_my_certificates_for_course(self, client, admin_user):
        awarded = [{"certificate_user": {"user_certification_uuid": "AB-1"}}]
        with _mock("get_user_certificates_for_course", return_value=awarded) as svc:
            resp = await client.get(f"{BASE}/user/course/course_test")

        assert resp.status_code == 200
        assert resp.json() == awarded
        _req, course_uuid, user, _db = svc.await_args.args
        assert course_uuid == "course_test" and user is admin_user

    async def test_certificate_by_uuid(self, client):
        payload = {"certificate_user": {"user_certification_uuid": "AB-1"}, "course": {}}
        with _mock("get_certificate_by_user_certification_uuid", return_value=payload) as svc:
            resp = await client.get(f"{BASE}/certificate/AB-1")

        assert resp.status_code == 200
        assert resp.json() == payload
        assert svc.await_args.args[1] == "AB-1"

    async def test_all_my_certificates(self, client, admin_user):
        with _mock("get_all_user_certificates", return_value=[]) as svc:
            resp = await client.get(f"{BASE}/user/all")

        assert resp.status_code == 200
        assert resp.json() == []
        assert svc.await_args.args[1] is admin_user
        assert svc.await_args.kwargs == {"org_id": None}

    async def test_all_my_certificates_forwards_org_id(self, client, admin_user):
        with _mock("get_all_user_certificates", return_value=[]) as svc:
            resp = await client.get(f"{BASE}/user/all", params={"org_id": 7})

        assert resp.status_code == 200
        assert svc.await_args.args[1] is admin_user
        assert svc.await_args.kwargs == {"org_id": 7}
