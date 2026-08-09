"""Authorization regression tests for the AI course-planning and migration routers.

All four issues covered here shared one shape: a bare org-membership check was
standing in for a real permission check. Membership answers "are you in this
tenant", never "may you do this thing", so any learner in the org sailed through.

- F7  ``save_activity_content``   — overwrote any activity in the org.
- F14 ``generate_activity_content`` — read another tenant's activity content back
      out over SSE, billed to the attacker's own org.
- F33 ``finalize_course_plan``    — created courses (and CREATOR authorship) with
      no create right and no plan-limit check.
- F25 ``/courses/migrate/*``      — org_id was accepted and ignored entirely, so
      the endpoints burned the server's provider key with no tenant, no rights,
      no credits and no rate limit.

Each finding is tested in both directions: the attack is refused, and the
legitimate caller still gets through.
"""

import json
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.activities import (
    Activity,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.courses import Course
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User
from src.routers.ai import courseplanning as cp
from src.routers.courses import migration as mig
from src.services.ai.schemas.courseplanning import (
    ChapterPlan,
    ActivityPlan,
    CoursePlan,
    CoursePlanningSessionData,
    FinalizeCoursePlanRequest,
    GenerateActivityContentRequest,
    SaveActivityContentRequest,
)
from src.services.courses.migration import migration_service as migrations
from src.services.courses.migration.models import (
    CreateFromMigrationRequest,
    MigrationTreeStructure,
    SuggestStructureRequest,
)

VALID_DOC = {"type": "doc", "content": [{"type": "paragraph"}]}
SECRET_DOC = {"type": "doc", "content": [{"type": "text", "text": "TENANT-B-SECRET"}]}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _mk_course(db, *, cid: int, org_id: int, uuid: str) -> Course:
    c = Course(
        id=cid,
        name=f"Course {cid}",
        description="x",
        public=False,
        published=False,
        open_to_contributors=False,
        org_id=org_id,
        course_uuid=uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return c


async def _mk_activity(db, *, aid: int, org_id: int, course_id: int, uuid: str, content: dict) -> Activity:
    a = Activity(
        id=aid,
        name=f"Activity {aid}",
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content=content,
        published=False,
        org_id=org_id,
        course_id=course_id,
        activity_uuid=uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


async def _mk_outsider(db, other_org, user_role) -> PublicUser:
    """A real account that belongs to `other_org` only."""
    u = User(
        id=99,
        username="outsider",
        first_name="Out",
        last_name="Sider",
        email="outsider@test.com",
        password="x",
        user_uuid="user_outsider",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(u)
    await db.commit()
    db.add(
        UserOrganization(
            user_id=u.id,
            org_id=other_org.id,
            role_id=user_role.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()
    return PublicUser(
        id=u.id,
        username=u.username,
        first_name=u.first_name,
        last_name=u.last_name,
        email=u.email,
        user_uuid=u.user_uuid,
    )


def _session(org_id: int, **kwargs) -> CoursePlanningSessionData:
    return CoursePlanningSessionData(
        session_uuid=f"cp_{uuid4()}",
        org_id=org_id,
        **kwargs,
    )


async def _drain(response) -> str:
    return "".join([chunk async for chunk in response.body_iterator])


# ===========================================================================
# F7 — save_activity_content
# ===========================================================================


class TestSaveActivityContentRequiresWriteAccess:
    async def test_plain_member_cannot_overwrite_activity_content(
        self, db, org, user_role, regular_user, course, activity, mock_request
    ):
        """A learner in the org may not rewrite an activity they don't own."""
        uuid = activity.activity_uuid
        original = dict(activity.content)

        with pytest.raises(HTTPException) as exc:
            await cp.save_activity_content(
                mock_request,
                SaveActivityContentRequest(activity_uuid=uuid, content=VALID_DOC),
                regular_user,
                db,
            )

        assert exc.value.status_code == 403

        db.expire_all()
        fresh = (
            await db.execute(select(Activity).where(Activity.activity_uuid == uuid))
        ).scalars().first()
        assert fresh.content == original

    async def test_admin_can_still_save_activity_content(
        self, db, org, admin_role, admin_user, course, activity, mock_request
    ):
        """The legitimate editor path is unchanged."""
        uuid = activity.activity_uuid

        result = await cp.save_activity_content(
            mock_request,
            SaveActivityContentRequest(activity_uuid=uuid, content=VALID_DOC),
            admin_user,
            db,
        )

        assert result["success"] is True

        db.expire_all()
        fresh = (
            await db.execute(select(Activity).where(Activity.activity_uuid == uuid))
        ).scalars().first()
        assert fresh.content == VALID_DOC

    async def test_orphaned_activity_is_404_not_a_silent_write(
        self, db, org, admin_role, admin_user, mock_request
    ):
        """No owning course means nothing to authorize against."""
        await _mk_activity(
            db, aid=77, org_id=org.id, course_id=4242, uuid="activity_orphan", content={}
        )

        with pytest.raises(HTTPException) as exc:
            await cp.save_activity_content(
                mock_request,
                SaveActivityContentRequest(
                    activity_uuid="activity_orphan", content=VALID_DOC
                ),
                admin_user,
                db,
            )

        assert exc.value.status_code == 404


# ===========================================================================
# F14 — generate_activity_content
# ===========================================================================


def _stream_spy(session: CoursePlanningSessionData):
    """Stand-in for generate_activity_content_stream.

    Echoes whatever ``current_content`` the router hands it — the real service
    does the same thing via the prompt — and bumps the per-activity iteration
    count exactly like the real one, so a second call reaches the branch where
    existing content is fed back in.
    """
    calls = []

    def factory(**kwargs):
        calls.append(kwargs)

        async def gen():
            yield kwargs.get("current_content") or "FRESH"
            uuid = kwargs["activity_uuid"]
            session.activity_iteration_counts[uuid] = (
                session.activity_iteration_counts.get(uuid, 0) + 1
            )

        return gen()

    factory.calls = calls
    return factory


class TestGenerateActivityContentIsTenantScoped:
    def _request(self, activity_uuid: str, session_uuid: str):
        return GenerateActivityContentRequest(
            session_uuid=session_uuid,
            activity_uuid=activity_uuid,
            activity_name="A",
            activity_description="D",
            chapter_name="C",
            course_name="Course",
            course_description="CD",
        )

    async def test_session_in_org_a_cannot_reach_activity_in_org_b(
        self, db, org, other_org, admin_role, admin_user, user_role, mock_request
    ):
        """Cross-tenant read: two sequential calls, both refused, nothing leaked.

        The second call matters — under the old code the first call only bumped
        ``iteration_count`` to 1, and it was the *second* that serialized the
        victim's content into the prompt and streamed it straight back.
        """
        victim_course = await _mk_course(
            db, cid=50, org_id=other_org.id, uuid="course_victim"
        )
        victim = await _mk_activity(
            db,
            aid=50,
            org_id=other_org.id,
            course_id=victim_course.id,
            uuid="activity_victim",
            content=SECRET_DOC,
        )

        # The attacker owns this session: they picked org A when they created it.
        session = _session(org.id)
        stream = _stream_spy(session)
        reserve = AsyncMock()

        with patch.object(cp, "get_course_planning_session", return_value=session), \
             patch.object(cp, "generate_activity_content_stream", new=stream), \
             patch.object(cp, "get_org_ai_model", new=AsyncMock(return_value="m")), \
             patch.object(cp, "reserve_ai_credit", new=reserve), \
             patch("src.services.security.rate_limiting.enforce_ai_rate_limit"):
            for _ in range(2):
                with pytest.raises(HTTPException) as exc:
                    await cp.generate_activity_content(
                        mock_request,
                        self._request(victim.activity_uuid, session.session_uuid),
                        admin_user,
                        db,
                    )
                assert exc.value.status_code == 404

        # No generation, no credits, and the victim's content never left org B.
        assert stream.calls == []
        assert "TENANT-B-SECRET" not in str(exc.value.detail)
        reserve.assert_not_called()
        assert session.activity_iteration_counts == {}

    async def test_plain_member_cannot_generate_into_someone_elses_course(
        self, db, org, user_role, regular_user, course, activity, mock_request
    ):
        """Same-org, but no write rights on the owning course."""
        session = _session(org.id)
        stream = _stream_spy(session)
        reserve = AsyncMock()

        with patch.object(cp, "get_course_planning_session", return_value=session), \
             patch.object(cp, "generate_activity_content_stream", new=stream), \
             patch.object(cp, "get_org_ai_model", new=AsyncMock(return_value="m")), \
             patch.object(cp, "reserve_ai_credit", new=reserve), \
             patch("src.services.security.rate_limiting.enforce_ai_rate_limit"):
            with pytest.raises(HTTPException) as exc:
                await cp.generate_activity_content(
                    mock_request,
                    self._request(activity.activity_uuid, session.session_uuid),
                    regular_user,
                    db,
                )

        assert exc.value.status_code == 403
        assert stream.calls == []
        reserve.assert_not_called()

    async def test_admin_iterates_on_their_own_activity(
        self, db, org, admin_role, admin_user, course, activity, mock_request
    ):
        """Legitimate two-call iteration still works and still echoes content."""
        uuid = activity.activity_uuid
        content = dict(activity.content)
        session = _session(org.id)
        stream = _stream_spy(session)

        with patch.object(cp, "get_course_planning_session", return_value=session), \
             patch.object(cp, "generate_activity_content_stream", new=stream), \
             patch.object(cp, "get_org_ai_model", new=AsyncMock(return_value="m")), \
             patch.object(cp, "reserve_ai_credit", new=AsyncMock()), \
             patch("src.services.security.rate_limiting.enforce_ai_rate_limit"):
            first = await cp.generate_activity_content(
                mock_request,
                self._request(uuid, session.session_uuid),
                admin_user,
                db,
            )
            await _drain(first)

            assert session.activity_iteration_counts[uuid] == 1

            second = await cp.generate_activity_content(
                mock_request,
                self._request(uuid, session.session_uuid),
                admin_user,
                db,
            )
            body = await _drain(second)

        # First call has nothing to iterate on; the second feeds the existing
        # content back in — the exact branch the cross-tenant test must not reach.
        assert stream.calls[0]["current_content"] is None
        assert stream.calls[1]["current_content"] == json.dumps(content)
        assert "doc" in body


# ===========================================================================
# F33 — finalize_course_plan
# ===========================================================================


def _plan() -> CoursePlan:
    return CoursePlan(
        name="Planned Course",
        description="desc",
        learnings="l",
        tags="t",
        chapters=[
            ChapterPlan(
                name="Chapter 1",
                description="cd",
                activities=[ActivityPlan(name="Act 1", description="ad")],
            )
        ],
    )


class TestFinalizeCoursePlanRequiresCreateRight:
    async def test_member_without_create_right_is_refused(
        self, db, org, user_role, regular_user, mock_request
    ):
        session = _session(org.id)

        with patch.object(cp, "get_course_planning_session", return_value=session), \
             patch.object(cp, "save_course_planning_session"):
            with pytest.raises(HTTPException) as exc:
                await cp.finalize_course_plan(
                    mock_request,
                    FinalizeCoursePlanRequest(
                        session_uuid=session.session_uuid, plan=_plan()
                    ),
                    regular_user,
                    db,
                )

        assert exc.value.status_code == 403
        # Denied before anything is written.
        courses = (await db.execute(select(Course))).scalars().all()
        assert courses == []
        authors = (await db.execute(select(ResourceAuthor))).scalars().all()
        assert authors == []

    async def test_admin_still_finalizes_and_becomes_the_creator(
        self, db, org, admin_role, admin_user, mock_request
    ):
        session = _session(org.id)

        with patch.object(cp, "get_course_planning_session", return_value=session), \
             patch.object(cp, "save_course_planning_session"):
            result = await cp.finalize_course_plan(
                mock_request,
                FinalizeCoursePlanRequest(
                    session_uuid=session.session_uuid, plan=_plan()
                ),
                admin_user,
                db,
            )

        assert result.course_uuid.startswith("course_")
        assert len(result.chapters) == 1

        author = (
            await db.execute(
                select(ResourceAuthor).where(
                    ResourceAuthor.resource_uuid == result.course_uuid
                )
            )
        ).scalars().first()
        assert author is not None
        assert author.user_id == admin_user.id
        assert author.authorship == ResourceAuthorshipEnum.CREATOR

    async def test_plan_course_limit_is_not_enforced_here(
        self, db, org, admin_role, admin_user, mock_request
    ):
        """This path skips the plan's course limit that `create_course` applies.
        That is a billing gap, not an authorization one, and enforcing it would
        start refusing a call that works today — so it stays out of the fix and
        is pinned here so the choice is visible rather than accidental."""
        session = _session(org.id)

        with patch.object(cp, "get_course_planning_session", return_value=session), \
             patch.object(cp, "save_course_planning_session"), \
             patch("src.security.features_utils.usage.check_limits_with_usage") as limits:
            result = await cp.finalize_course_plan(
                mock_request,
                FinalizeCoursePlanRequest(
                    session_uuid=session.session_uuid, plan=_plan()
                ),
                admin_user,
                db,
            )

        assert result.course_uuid.startswith("course_")
        limits.assert_not_called()



# ===========================================================================
# F25 — /courses/migrate/*
# ===========================================================================


@pytest.fixture
def migration_package(monkeypatch, tmp_path):
    """A real manifest on disk, so an ungated call would genuinely reach the LLM."""
    base = tmp_path / "migrations"
    monkeypatch.setattr(migrations, "_TEMP_BASE_REAL", str(base))

    temp_id = str(uuid4())
    temp_dir = base / temp_id
    temp_dir.mkdir(parents=True)
    (temp_dir / "manifest.json").write_text(
        json.dumps(
            {
                "temp_id": temp_id,
                "created_at": "2024-01-01T00:00:00+00:00",
                "files": [
                    {
                        "file_id": "11111111-1111-1111-1111-111111111111",
                        "filename": "intro.mp4",
                        "file_type": "video/mp4",
                        "size": 12,
                        "extension": "mp4",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    return temp_id


@pytest.fixture
def llm_generate():
    """Patches the shared LLM entrypoint. Never makes a real call."""
    payload = {
        "course_name": "Suggested Course",
        "course_description": "Generated",
        "chapters": [
            {
                "name": "Chapter 1",
                "activities": [
                    {
                        "name": "Intro",
                        "activity_type": "TYPE_VIDEO",
                        "activity_sub_type": "SUBTYPE_VIDEO_HOSTED",
                        "file_ids": ["11111111-1111-1111-1111-111111111111"],
                    }
                ],
            }
        ],
    }
    with patch(
        "src.services.ai.llm.generate",
        new=AsyncMock(return_value=json.dumps(payload)),
    ) as mock:
        yield mock


@pytest.fixture
def no_redis():
    """Deployments without Redis keep working; the owner claim is best-effort."""
    with patch.object(mig, "get_redis_client", return_value=None):
        yield


class TestSuggestStructureIsGated:
    def _body(self, temp_id: str) -> SuggestStructureRequest:
        return SuggestStructureRequest(
            temp_id=temp_id, course_name="Course", description="d"
        )

    async def test_unknown_org_is_404(
        self, db, org, admin_role, admin_user, migration_package, llm_generate,
        no_redis, mock_request,
    ):
        with pytest.raises(HTTPException) as exc:
            await mig.api_suggest_structure(
                mock_request, 4242, self._body(migration_package), admin_user, db
            )

        assert exc.value.status_code == 404
        llm_generate.assert_not_awaited()

    async def test_non_member_is_refused_and_never_reaches_the_model(
        self, db, org, other_org, user_role, admin_role, migration_package,
        llm_generate, no_redis, mock_request,
    ):
        """The proof is the mock: no provider key spent for a foreign tenant."""
        outsider = await _mk_outsider(db, other_org, user_role)

        with pytest.raises(HTTPException) as exc:
            await mig.api_suggest_structure(
                mock_request, org.id, self._body(migration_package), outsider, db
            )

        assert exc.value.status_code == 403
        llm_generate.assert_not_awaited()

    async def test_member_without_course_create_right_is_refused(
        self, db, org, user_role, regular_user, migration_package, llm_generate,
        no_redis, mock_request,
    ):
        with pytest.raises(HTTPException) as exc:
            await mig.api_suggest_structure(
                mock_request, org.id, self._body(migration_package), regular_user, db
            )

        assert exc.value.status_code == 403
        llm_generate.assert_not_awaited()

    async def test_authorized_member_still_gets_a_suggestion(
        self, db, org, admin_role, admin_user, migration_package, llm_generate,
        no_redis, mock_request,
    ):
        with patch.object(mig, "enforce_ai_rate_limit") as rate:
            result = await mig.api_suggest_structure(
                mock_request, org.id, self._body(migration_package), admin_user, db
            )

        assert result.course_name == "Suggested Course"
        llm_generate.assert_awaited_once()
        # Rate limited per user+org — that is what bounds the spend the missing
        # authorization allowed.
        rate.assert_called_once_with(admin_user.id, org.id)

    async def test_suggestion_is_not_billed_as_an_ai_credit(
        self, db, org, admin_role, admin_user, migration_package, llm_generate,
        no_redis, mock_request,
    ):
        """Metering this would match the /ai routers, but it would also start
        refusing a call that is free today (orgs out of credits, and orgs with
        no config row, which reserve_ai_credit answers 404 for). Pinned so the
        choice stays deliberate."""
        with patch.object(mig, "enforce_ai_rate_limit"), \
             patch("src.security.features_utils.usage.reserve_ai_credit") as reserve:
            result = await mig.api_suggest_structure(
                mock_request, org.id, self._body(migration_package), admin_user, db
            )

        assert result.course_name == "Suggested Course"
        reserve.assert_not_called()


class TestUploadAndCreateAreGated:
    async def test_upload_refuses_a_non_member(
        self, db, org, other_org, user_role, admin_role, no_redis, mock_request
    ):
        outsider = await _mk_outsider(db, other_org, user_role)
        upload = AsyncMock()

        with patch.object(mig, "upload_migration_files", new=upload):
            with pytest.raises(HTTPException) as exc:
                await mig.api_upload_migration_files(
                    mock_request, org.id, [], None, outsider, db
                )

        assert exc.value.status_code == 403
        upload.assert_not_awaited()

    async def test_upload_still_works_for_an_authorized_member(
        self, db, org, admin_role, admin_user, no_redis, mock_request
    ):
        response = MagicMock(temp_id="11111111-1111-1111-1111-111111111111")

        with patch.object(
            mig, "upload_migration_files", new=AsyncMock(return_value=response)
        ) as upload:
            result = await mig.api_upload_migration_files(
                mock_request, org.id, [], None, admin_user, db
            )

        assert result is response
        upload.assert_awaited_once()

    async def test_create_refuses_a_member_without_create_right(
        self, db, org, user_role, regular_user, no_redis, mock_request
    ):
        from src.services.courses.migration.models import (
            CreateFromMigrationRequest,
            MigrationTreeStructure,
        )

        create = AsyncMock()
        body = CreateFromMigrationRequest(
            temp_id=str(uuid4()),
            structure=MigrationTreeStructure(course_name="C", chapters=[]),
        )

        with patch.object(mig, "create_course_from_migration", new=create):
            with pytest.raises(HTTPException) as exc:
                await mig.api_create_from_migration(
                    mock_request, org.id, body, regular_user, db
                )

        assert exc.value.status_code == 403
        create.assert_not_awaited()


class TestMigrationPackageOwnership:
    """One account must not be able to consume another's uploaded package."""

    class _FakeRedis:
        def __init__(self):
            self.store: dict[str, str] = {}

        def set(self, key, value, nx=False, ex=None):
            if nx and key in self.store:
                return None
            self.store[key] = value
            return True

        def get(self, key):
            value = self.store.get(key)
            return value.encode() if value is not None else None

    def test_first_caller_claims_and_keeps_the_package(self):
        redis = self._FakeRedis()
        with patch.object(mig, "get_redis_client", return_value=redis):
            mig.claim_migration_package("temp-1", 7)
            mig.claim_migration_package("temp-1", 7)  # idempotent for the owner

            with pytest.raises(HTTPException) as exc:
                mig.claim_migration_package("temp-1", 8)

        assert exc.value.status_code == 404

    def test_missing_redis_is_a_no_op(self):
        with patch.object(mig, "get_redis_client", return_value=None):
            mig.claim_migration_package("temp-2", 7)

    def test_redis_errors_do_not_break_uploads(self):
        broken = MagicMock()
        broken.set.side_effect = RuntimeError("redis down")
        with patch.object(mig, "get_redis_client", return_value=broken):
            mig.claim_migration_package("temp-3", 7)

    def test_a_claim_that_expired_mid_flight_is_not_treated_as_a_foreign_owner(self):
        """The TTL can lapse between the SET NX and the GET. An absent owner is
        nobody's package, so the caller must not be locked out of their own."""
        racing = MagicMock()
        racing.set.return_value = None  # key existed at SET time
        racing.get.return_value = None  # ...and expired before the GET
        with patch.object(mig, "get_redis_client", return_value=racing):
            mig.claim_migration_package("temp-4", 7)

    async def test_appending_files_to_a_foreign_package_is_refused_before_upload(
        self, db, org, admin_role, admin_user, mock_request
    ):
        """The point of claiming on the way in: no bytes reach disk for a package
        this user does not own."""
        redis = self._FakeRedis()
        redis.store[mig.MIGRATION_OWNER_KEY.format(temp_id="foreign-pkg")] = "999999"
        upload = AsyncMock()

        with patch.object(mig, "get_redis_client", return_value=redis), \
             patch.object(mig, "upload_migration_files", new=upload):
            with pytest.raises(HTTPException) as exc:
                await mig.api_upload_migration_files(
                    mock_request, org.id, [], "foreign-pkg", admin_user, db
                )

        assert exc.value.status_code == 404
        upload.assert_not_awaited()

    async def test_creating_a_course_from_a_foreign_package_is_refused(
        self, db, org, admin_role, admin_user, mock_request
    ):
        temp_id = str(uuid4())
        redis = self._FakeRedis()
        redis.store[mig.MIGRATION_OWNER_KEY.format(temp_id=temp_id)] = "999999"
        create = AsyncMock()
        body = CreateFromMigrationRequest(
            temp_id=temp_id,
            structure=MigrationTreeStructure(course_name="C", chapters=[]),
        )

        with patch.object(mig, "get_redis_client", return_value=redis), \
             patch.object(mig, "create_course_from_migration", new=create):
            with pytest.raises(HTTPException) as exc:
                await mig.api_create_from_migration(
                    mock_request, org.id, body, admin_user, db
                )

        assert exc.value.status_code == 404
        create.assert_not_awaited()
