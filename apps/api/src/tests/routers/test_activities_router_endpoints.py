"""Router tests for src/routers/courses/activities/activities.py.

Service functions are mocked: these tests pin the HTTP contract (paths,
status codes, response shapes) and the request parsing the router does on its
own, i.e. validating ``details``/``extra_metadata`` form fields and building
the details JSON for the video update endpoints.
"""

import json
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.courses.activities import ActivityRead
from src.routers.courses.activities.activities import router as activities_router
from src.security.auth import get_current_user

R = "src.routers.courses.activities.activities"
BASE = "/api/v1/activities"


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(activities_router, prefix=BASE)
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
def activity_read(activity) -> ActivityRead:
    return ActivityRead.model_validate(activity)


def _mock(name: str, **kwargs):
    return patch(f"{R}.{name}", new_callable=AsyncMock, **kwargs)


class TestActivityCrud:
    async def test_create_activity(self, client, activity_read, chapter):
        with _mock("create_activity", return_value=activity_read) as svc:
            resp = await client.post(
                f"{BASE}/", json={"name": "New", "chapter_id": chapter.id}
            )

        assert resp.status_code == 200
        assert resp.json()["activity_uuid"] == "activity_test"
        sent = svc.await_args.args[1]
        assert sent.name == "New" and sent.chapter_id == chapter.id

    async def test_get_activity_by_uuid(self, client, activity_read):
        with _mock("get_activity", return_value=activity_read) as svc:
            resp = await client.get(f"{BASE}/activity_test")

        assert resp.status_code == 200
        assert resp.json()["name"] == "Test Activity"
        assert svc.await_args.args[1] == "activity_test"

    async def test_get_activity_by_id(self, client, activity_read):
        with _mock("get_activityby_id", return_value=activity_read) as svc:
            resp = await client.get(f"{BASE}/id/1")

        assert resp.status_code == 200
        assert resp.json()["id"] == 1
        assert svc.await_args.args[1] == 1

    async def test_get_chapter_activities(self, client, activity_read):
        with _mock("get_activities", return_value=[activity_read]) as svc:
            resp = await client.get(f"{BASE}/chapter/1")

        assert resp.status_code == 200
        assert [a["activity_uuid"] for a in resp.json()] == ["activity_test"]
        assert svc.await_args.args[1] == 1

    async def test_update_activity(self, client, activity_read):
        activity_read.name = "Renamed"
        with _mock("update_activity", return_value=activity_read) as svc:
            resp = await client.put(f"{BASE}/activity_test", json={"name": "Renamed"})

        assert resp.status_code == 200
        assert resp.json()["name"] == "Renamed"
        update_obj, uuid = svc.await_args.args[1], svc.await_args.args[2]
        assert update_obj.name == "Renamed" and uuid == "activity_test"

    async def test_delete_activity(self, client):
        with _mock("delete_activity", return_value={"detail": "Activity deleted"}) as svc:
            resp = await client.delete(f"{BASE}/activity_test")

        assert resp.status_code == 200
        assert resp.json() == {"detail": "Activity deleted"}
        assert svc.await_args.args[1] == "activity_test"


class TestVersioningEndpoints:
    def _version(self, number: int = 1) -> dict:
        return {
            "id": number,
            "activity_id": 1,
            "org_id": 1,
            "content": {"type": "doc"},
            "version_number": number,
            "created_by_id": 1,
            "created_at": datetime(2024, 1, 1),
            "created_by_username": "admin",
        }

    async def test_list_versions_forwards_pagination(self, client):
        with _mock("get_activity_versions", return_value=[self._version(2), self._version(1)]) as svc:
            resp = await client.get(f"{BASE}/activity_test/versions?limit=5&offset=3")

        assert resp.status_code == 200
        assert [v["version_number"] for v in resp.json()] == [2, 1]
        assert svc.await_args.args[1] == "activity_test"
        assert svc.await_args.args[4:] == (5, 3)

    async def test_list_versions_rejects_out_of_range_limit(self, client):
        with _mock("get_activity_versions") as svc:
            resp = await client.get(f"{BASE}/activity_test/versions?limit=500")

        assert resp.status_code == 422
        svc.assert_not_awaited()

    async def test_get_version(self, client):
        with _mock("get_activity_version", return_value=self._version(3)) as svc:
            resp = await client.get(f"{BASE}/activity_test/versions/3")

        assert resp.status_code == 200
        assert resp.json()["version_number"] == 3
        assert svc.await_args.args[1:3] == ("activity_test", 3)

    async def test_get_state(self, client):
        state = {
            "activity_uuid": "activity_test",
            "update_date": "2024-01-01",
            "current_version": 4,
            "last_modified_by_id": 1,
            "last_modified_by_username": "admin",
        }
        with _mock("get_activity_state", return_value=state):
            resp = await client.get(f"{BASE}/activity_test/state")

        assert resp.status_code == 200
        assert resp.json()["current_version"] == 4

    async def test_restore_version(self, client, activity_read):
        with _mock("restore_activity_version", return_value=activity_read) as svc:
            resp = await client.post(f"{BASE}/activity_test/versions/2/restore")

        assert resp.status_code == 200
        assert resp.json()["activity_uuid"] == "activity_test"
        assert svc.await_args.args[1:3] == ("activity_test", 2)


class TestEditorBootstrap:
    async def test_returns_activity_course_and_org(self, client, org, course, activity):
        """Runs the real service: the admin gets one payload with all three."""
        resp = await client.get(f"{BASE}/activity_test/editor-bootstrap")

        assert resp.status_code == 200
        body = resp.json()
        assert body["activity"]["activity_uuid"] == "activity_test"
        assert body["course"]["course_uuid"] == course.course_uuid
        assert body["org"]["org_uuid"] == org.org_uuid


class TestCreateVideoActivityFormParsing:
    async def test_valid_details_and_extra_metadata_are_forwarded(self, client, activity_read):
        with _mock("create_video_activity", return_value=activity_read) as svc:
            resp = await client.post(
                f"{BASE}/video",
                data={
                    "name": "Video",
                    "chapter_id": "1",
                    "details": '{"startTime": 3}',
                    "extra_metadata": '{"tags": ["a"]}',
                },
            )

        assert resp.status_code == 200
        args = svc.await_args
        assert args.args[1:3] == ("Video", 1)
        assert args.args[6] == '{"startTime": 3}'
        assert args.kwargs["extra_metadata"] == {"tags": ["a"]}

    async def test_missing_extra_metadata_is_none(self, client, activity_read):
        with _mock("create_video_activity", return_value=activity_read) as svc:
            resp = await client.post(
                f"{BASE}/video", data={"name": "Video", "chapter_id": "1"}
            )

        assert resp.status_code == 200
        assert svc.await_args.args[6] == "{}"
        assert svc.await_args.kwargs["extra_metadata"] is None

    @pytest.mark.parametrize(
        "field, value, detail",
        [
            ("details", "{not json", "details must be a JSON object"),
            ("details", "[1, 2]", "details must be a JSON object"),
            ("extra_metadata", "{not json", "extra_metadata must be a JSON object"),
            ("extra_metadata", '"a string"', "extra_metadata must be a JSON object"),
        ],
        ids=["details-malformed", "details-array", "meta-malformed", "meta-string"],
    )
    async def test_bad_json_fields_are_422_not_500(self, client, field, value, detail):
        with _mock("create_video_activity") as svc:
            resp = await client.post(
                f"{BASE}/video",
                data={"name": "Video", "chapter_id": "1", field: value},
            )

        assert resp.status_code == 422
        assert resp.json()["detail"] == detail
        svc.assert_not_awaited()


class TestOtherCreateEndpoints:
    async def test_create_external_video(self, client, activity_read):
        with _mock("create_external_video_activity", return_value=activity_read) as svc:
            resp = await client.post(
                f"{BASE}/external_video",
                json={
                    "name": "YT",
                    "uri": "https://youtu.be/x",
                    "type": "youtube",
                    "chapter_id": 1,
                },
            )

        assert resp.status_code == 200
        ext = svc.await_args.args[2]
        assert ext.uri == "https://youtu.be/x" and ext.type == "youtube"

    async def test_create_documentpdf_parses_extra_metadata(self, client, activity_read):
        with _mock("create_documentpdf_activity", return_value=activity_read) as svc:
            resp = await client.post(
                f"{BASE}/documentpdf",
                data={"name": "Doc", "chapter_id": "1", "extra_metadata": '{"k": 1}'},
                files={"pdf_file": ("doc.pdf", b"%PDF", "application/pdf")},
            )

        assert resp.status_code == 200
        args = svc.await_args
        assert args.args[1:3] == ("Doc", 1)
        assert args.args[5].filename == "doc.pdf"
        assert args.kwargs["extra_metadata"] == {"k": 1}


class TestVideoUpdates:
    async def test_hosted_video_update_builds_details(self, client, activity_read):
        with _mock("update_video_activity", return_value=activity_read) as svc:
            resp = await client.put(
                f"{BASE}/video/activity_test",
                data={
                    "name": "New name",
                    "start_time": "5",
                    "end_time": "60",
                    "autoplay": " Yes ",
                    "muted": "off",
                },
            )

        assert resp.status_code == 200
        args = svc.await_args.args
        assert args[1] == "activity_test"
        assert args[4] == "New name"
        assert json.loads(args[6]) == {
            "startTime": 5,
            "endTime": 60,
            "autoplay": True,
            "muted": False,
        }

    async def test_hosted_video_update_without_fields_sends_no_details(
        self, client, activity_read
    ):
        with _mock("update_video_activity", return_value=activity_read) as svc:
            resp = await client.put(f"{BASE}/video/activity_test", data={})

        assert resp.status_code == 200
        assert svc.await_args.args[4] is None
        assert svc.await_args.args[6] is None

    async def test_external_video_update_builds_details(self, client, activity_read):
        with _mock("update_external_video_activity", return_value=activity_read) as svc:
            resp = await client.put(
                f"{BASE}/external_video/activity_test",
                json={
                    "name": "Renamed",
                    "uri": "https://vimeo.com/1",
                    "startTime": 1,
                    "endTime": 2,
                    "autoplay": False,
                    "muted": True,
                },
            )

        assert resp.status_code == 200
        args = svc.await_args.args
        assert args[1] == "activity_test"
        assert args[4:6] == ("https://vimeo.com/1", "Renamed")
        assert json.loads(args[6]) == {
            "startTime": 1,
            "endTime": 2,
            "autoplay": False,
            "muted": True,
        }

    async def test_external_video_update_without_details(self, client, activity_read):
        with _mock("update_external_video_activity", return_value=activity_read) as svc:
            resp = await client.put(
                f"{BASE}/external_video/activity_test", json={"name": "Only name"}
            )

        assert resp.status_code == 200
        assert svc.await_args.args[4:] == (None, "Only name", None)

    async def test_configure_captions(self, client):
        stored = {"enabled": True, "languages": [{"code": "fr"}]}
        with _mock("configure_captions", return_value=stored) as svc:
            resp = await client.post(
                f"{BASE}/video/activity_test/captions",
                json={"enabled": True, "languages": [{"code": "fr"}]},
            )

        assert resp.status_code == 200
        assert resp.json() == stored
        config = svc.await_args.args[4]
        assert [lang.code for lang in config.languages] == ["fr"]

    async def test_update_documentpdf(self, client, activity_read):
        with _mock("update_documentpdf_activity", return_value=activity_read) as svc:
            resp = await client.put(
                f"{BASE}/documentpdf/activity_test",
                data={"name": "Renamed"},
                files={"pdf_file": ("new.pdf", b"%PDF", "application/pdf")},
            )

        assert resp.status_code == 200
        args = svc.await_args.args
        assert args[1] == "activity_test"
        assert args[4] == "Renamed"
        assert args[5].filename == "new.pdf"


class TestActivityUsergroups:
    async def test_list_add_remove(self, client):
        with _mock("get_activity_usergroups", return_value=[{"usergroup_uuid": "ug1"}]) as list_svc:
            listed = await client.get(f"{BASE}/activity_test/usergroups")
        with _mock("add_usergroup_to_activity", return_value={"detail": "added"}) as add_svc:
            added = await client.post(f"{BASE}/activity_test/usergroups/ug1")
        with _mock("remove_usergroup_from_activity", return_value={"detail": "removed"}) as rm_svc:
            removed = await client.delete(f"{BASE}/activity_test/usergroups/ug1")

        assert listed.status_code == 200
        assert listed.json() == [{"usergroup_uuid": "ug1"}]
        assert list_svc.await_args.args[1] == "activity_test"
        assert added.json() == {"detail": "added"}
        assert add_svc.await_args.args[1:3] == ("activity_test", "ug1")
        assert removed.json() == {"detail": "removed"}
        assert rm_svc.await_args.args[1:3] == ("activity_test", "ug1")
