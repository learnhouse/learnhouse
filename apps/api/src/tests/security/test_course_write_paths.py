"""
Regression tests for course write-path authorization:

- course import (analyze + import) is bound to the target org
- thumbnail names can't carry path traversal into update or clone
- course updates always belong to the course's org
- contributor applications need READ, and contributors can't self-promote
- cloning needs UPDATE on the source course
- CREATE on "course_x" is scoped to the target org (instructor in one org,
  learner in another can't create/import/clone into the second)
"""

from datetime import datetime
from io import BytesIO
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException, UploadFile
from sqlmodel import select

from src.db.courses.course_updates import CourseUpdate as CourseUpdateRow, CourseUpdateCreate
from src.db.courses.courses import Course, CourseCreate, CourseUpdate
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.roles import Role, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, PublicUser, User
from src.routers.courses.courses import api_apply_course_contributor
from src.services.courses.contributors import (
    apply_course_contributor,
    update_course_contributor,
)
from src.services.courses.courses import clone_course, create_course, update_course
from src.services.courses.transfer.import_service import (
    analyze_import_package,
    import_courses,
)
from src.services.courses.transfer.models import ImportOptions
from src.services.courses.updates import create_update
from src.tests.conftest import ADMIN_RIGHTS

IMPORT_MOD = "src.services.courses.transfer.import_service"
COURSES_MOD = "src.services.courses.courses"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_user(db, *, uid: int, username: str) -> PublicUser:
    u = User(
        id=uid,
        username=username,
        first_name=username,
        last_name="User",
        email=f"{username}@test.com",
        password="hashed_password",
        user_uuid=f"user_{username}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(u)
    await db.commit()
    return PublicUser(
        id=u.id,
        username=u.username,
        first_name=u.first_name,
        last_name=u.last_name,
        email=u.email,
        user_uuid=u.user_uuid,
    )


async def _add_membership(db, *, user_id: int, org_id: int, role_id: int) -> None:
    db.add(
        UserOrganization(
            user_id=user_id,
            org_id=org_id,
            role_id=role_id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()


async def _add_author(db, *, course_uuid: str, user_id: int, authorship, status=ResourceAuthorshipStatusEnum.ACTIVE):
    db.add(
        ResourceAuthor(
            resource_uuid=course_uuid,
            user_id=user_id,
            authorship=authorship,
            authorship_status=status,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()


def _zip_upload() -> UploadFile:
    return UploadFile(filename="package.zip", file=BytesIO(b"PK\x03\x04not-really"))


@pytest.fixture
async def cross_org_instructor(db, org, other_org, user_role):
    """Instructor (full course rights) in other_org, plain learner in org."""
    instructor_role = Role(
        id=50,
        name="Instructor",
        org_id=other_org.id,
        role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_other_instructor",
        rights=ADMIN_RIGHTS.model_dump(),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(instructor_role)
    await db.commit()
    user = await _make_user(db, uid=30, username="crossorg")
    await _add_membership(db, user_id=user.id, org_id=other_org.id, role_id=instructor_role.id)
    await _add_membership(db, user_id=user.id, org_id=org.id, role_id=user_role.id)
    return user


# ---------------------------------------------------------------------------
# 1. Import is bound to the target org
# ---------------------------------------------------------------------------


class TestImportTargetOrg:
    @pytest.mark.asyncio
    async def test_analyze_into_foreign_org_rejected_before_file_work(
        self, db, org, other_org, admin_user, mock_request
    ):
        # Even with the role check passing, a non-member can't import there.
        with patch(f"{IMPORT_MOD}.check_resource_access", new_callable=AsyncMock), \
                patch(f"{IMPORT_MOD}.os.makedirs") as mk:
            with pytest.raises(HTTPException) as exc:
                await analyze_import_package(mock_request, _zip_upload(), other_org.id, admin_user, db)
        assert exc.value.status_code == 403
        mk.assert_not_called()

    @pytest.mark.asyncio
    async def test_analyze_without_patching_rbac_rejected(
        self, db, org, other_org, admin_user, mock_request
    ):
        with patch(f"{IMPORT_MOD}.os.makedirs") as mk:
            with pytest.raises(HTTPException) as exc:
                await analyze_import_package(mock_request, _zip_upload(), other_org.id, admin_user, db)
        assert exc.value.status_code == 403
        mk.assert_not_called()

    @pytest.mark.asyncio
    async def test_import_into_foreign_org_rejected_before_file_work(
        self, db, org, other_org, admin_user, mock_request
    ):
        with patch(f"{IMPORT_MOD}.check_resource_access", new_callable=AsyncMock), \
                patch(f"{IMPORT_MOD}._require_temp_id") as temp_check:
            with pytest.raises(HTTPException) as exc:
                await import_courses(
                    mock_request, "00000000-0000-4000-8000-000000000000", other_org.id,
                    ImportOptions(course_uuids=[]), admin_user, db,
                )
        assert exc.value.status_code == 403
        temp_check.assert_not_called()

    @pytest.mark.asyncio
    async def test_api_token_for_other_org_rejected(
        self, db, org, other_org, admin_user, mock_request
    ):
        # Token scoped to other_org; its creator is admin of org. Still 403 on org.
        token = APITokenUser(org_id=other_org.id, created_by_user_id=admin_user.id)
        with patch(f"{IMPORT_MOD}.check_resource_access", new_callable=AsyncMock), \
                patch(f"{IMPORT_MOD}.os.makedirs") as mk:
            with pytest.raises(HTTPException) as exc:
                await analyze_import_package(mock_request, _zip_upload(), org.id, token, db)
        assert exc.value.status_code == 403
        assert "API token" in exc.value.detail
        mk.assert_not_called()

    @pytest.mark.asyncio
    async def test_cross_org_instructor_cannot_import_into_learner_org(
        self, db, org, other_org, cross_org_instructor, mock_request
    ):
        with patch(f"{IMPORT_MOD}.os.makedirs") as mk:
            with pytest.raises(HTTPException) as exc:
                await analyze_import_package(mock_request, _zip_upload(), org.id, cross_org_instructor, db)
        assert exc.value.status_code == 403
        mk.assert_not_called()


# ---------------------------------------------------------------------------
# 2. Thumbnail traversal
# ---------------------------------------------------------------------------


class TestThumbnailTraversal:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("bad", [
        "../../../etc/passwd",
        "a/b.png",
        "..\\x.png",
        "..",
        "/etc/passwd",
        "x\x00.png",
    ])
    async def test_update_rejects_non_bare_thumbnail(self, db, org, course, admin_user, mock_request, bad):
        for field in ("thumbnail_image", "thumbnail_video"):
            with pytest.raises(HTTPException) as exc:
                await update_course(
                    mock_request, CourseUpdate(**{field: bad}), course.course_uuid, admin_user, db
                )
            assert exc.value.status_code == 400

        stored = (await db.execute(select(Course).where(Course.id == course.id))).scalars().first()
        assert stored.thumbnail_image in ("", None)

    @pytest.mark.asyncio
    async def test_update_accepts_bare_and_unchanged_thumbnail(self, db, org, course, admin_user, mock_request):
        with patch(f"{COURSES_MOD}.dispatch_webhooks", new_callable=AsyncMock):
            result = await update_course(
                mock_request, CourseUpdate(thumbnail_image="cover.png"), course.course_uuid, admin_user, db
            )
            assert result.thumbnail_image == "cover.png"
            # Echoing the stored value back is fine.
            await update_course(
                mock_request, CourseUpdate(thumbnail_image="cover.png", name="Renamed"),
                course.course_uuid, admin_user, db,
            )

    @pytest.mark.asyncio
    async def test_clone_skips_traversal_thumbnail_already_in_db(
        self, db, org, course, admin_user, mock_request
    ):
        course.thumbnail_image = "../../../../etc/passwd"
        course.thumbnail_video = "../other_course/thumbnails/secret.mp4"
        db.add(course)
        await db.commit()

        with patch(f"{COURSES_MOD}.check_limits_with_usage"), \
                patch(f"{COURSES_MOD}.increase_feature_usage"), \
                patch("src.services.courses.transfer.storage_utils.is_s3_enabled", return_value=False), \
                patch("src.services.courses.transfer.storage_utils.file_exists", return_value=True), \
                patch("src.services.courses.transfer.storage_utils.list_directory", return_value=[]), \
                patch(f"{COURSES_MOD}._copy_storage_file") as copy_file, \
                patch(f"{COURSES_MOD}._copy_storage_directory"), \
                patch("os.makedirs"):
            cloned = await clone_course(mock_request, course.course_uuid, admin_user, db)

        copy_file.assert_not_called()
        assert cloned.thumbnail_image == ""
        assert cloned.thumbnail_video == ""


# ---------------------------------------------------------------------------
# 3. Course updates use the course's org
# ---------------------------------------------------------------------------


class TestCourseUpdateOrg:
    @pytest.mark.asyncio
    async def test_body_org_id_ignored(self, db, org, other_org, course, admin_user, mock_request):
        with patch("src.services.courses.updates.dispatch_webhooks", new_callable=AsyncMock) as dispatch:
            created = await create_update(
                mock_request,
                course.course_uuid,
                CourseUpdateCreate(title="t", content="c", org_id=other_org.id),
                admin_user,
                db,
            )

        assert created.org_id == org.id
        row = (await db.execute(
            select(CourseUpdateRow).where(CourseUpdateRow.courseupdate_uuid == created.courseupdate_uuid)
        )).scalars().first()
        assert row.org_id == org.id
        assert dispatch.await_args.kwargs["org_id"] == org.id


# ---------------------------------------------------------------------------
# 4. Contributors
# ---------------------------------------------------------------------------


class TestContributors:
    @pytest.mark.asyncio
    async def test_apply_to_private_course_in_other_org_denied(
        self, db, org, other_org, course, mock_request
    ):
        course.public = False
        course.open_to_contributors = True
        db.add(course)
        await db.commit()
        outsider = await _make_user(db, uid=40, username="outsider")

        with pytest.raises(HTTPException) as exc:
            await apply_course_contributor(mock_request, course.course_uuid, outsider, db)
        assert exc.value.status_code in (401, 403)

        rows = (await db.execute(
            select(ResourceAuthor).where(ResourceAuthor.user_id == outsider.id)
        )).scalars().all()
        assert rows == []

    @pytest.mark.asyncio
    async def test_apply_to_closed_course_denied(self, db, org, course, regular_user, mock_request):
        assert course.open_to_contributors is False
        with pytest.raises(HTTPException) as exc:
            await api_apply_course_contributor(mock_request, course.course_uuid, db, regular_user)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_apply_to_open_visible_course_allowed(self, db, org, course, regular_user, mock_request):
        course.open_to_contributors = True
        db.add(course)
        await db.commit()
        result = await apply_course_contributor(mock_request, course.course_uuid, regular_user, db)
        assert result["status"] == "pending"

    @pytest.mark.asyncio
    async def test_contributor_cannot_self_promote(self, db, org, course, regular_user, mock_request):
        await _add_author(
            db, course_uuid=course.course_uuid, user_id=regular_user.id,
            authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
        )
        # Even when course UPDATE is granted (contributors can edit content).
        with patch("src.services.courses.contributors.check_resource_access", new_callable=AsyncMock):
            for target in (ResourceAuthorshipEnum.MAINTAINER, ResourceAuthorshipEnum.CREATOR):
                with pytest.raises(HTTPException) as exc:
                    await update_course_contributor(
                        mock_request, course.course_uuid, regular_user.id, target,
                        ResourceAuthorshipStatusEnum.ACTIVE, regular_user, db,
                    )
                assert exc.value.status_code == 403

        row = (await db.execute(
            select(ResourceAuthor).where(ResourceAuthor.user_id == regular_user.id)
        )).scalars().first()
        assert row.authorship == ResourceAuthorshipEnum.CONTRIBUTOR

    @pytest.mark.asyncio
    async def test_maintainer_and_admin_can_manage_roles(
        self, db, org, course, admin_user, regular_user, mock_request
    ):
        await _add_author(
            db, course_uuid=course.course_uuid, user_id=regular_user.id,
            authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
            status=ResourceAuthorshipStatusEnum.PENDING,
        )
        result = await update_course_contributor(
            mock_request, course.course_uuid, regular_user.id, ResourceAuthorshipEnum.MAINTAINER,
            ResourceAuthorshipStatusEnum.ACTIVE, admin_user, db,
        )
        assert result["status"] == "success"

        # Course maintainer (not an org admin) can manage another contributor.
        maint = await _make_user(db, uid=41, username="maint")
        other = await _make_user(db, uid=42, username="contrib")
        await _add_author(db, course_uuid=course.course_uuid, user_id=maint.id,
                          authorship=ResourceAuthorshipEnum.MAINTAINER)
        await _add_author(db, course_uuid=course.course_uuid, user_id=other.id,
                          authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
                          status=ResourceAuthorshipStatusEnum.PENDING)
        with patch("src.services.courses.contributors.check_resource_access", new_callable=AsyncMock):
            result = await update_course_contributor(
                mock_request, course.course_uuid, other.id, ResourceAuthorshipEnum.CONTRIBUTOR,
                ResourceAuthorshipStatusEnum.ACTIVE, maint, db,
            )
        assert result["status"] == "success"


# ---------------------------------------------------------------------------
# 5. Clone requires UPDATE on the source; CREATE is org-scoped
# ---------------------------------------------------------------------------


def _clone_patches():
    return (
        patch(f"{COURSES_MOD}.check_limits_with_usage"),
        patch(f"{COURSES_MOD}.increase_feature_usage"),
        patch("src.services.courses.transfer.storage_utils.is_s3_enabled", return_value=False),
        patch("src.services.courses.transfer.storage_utils.file_exists", return_value=False),
        patch("src.services.courses.transfer.storage_utils.list_directory", return_value=[]),
        patch(f"{COURSES_MOD}._copy_storage_file"),
        patch(f"{COURSES_MOD}._copy_storage_directory"),
        patch("os.makedirs"),
    )


class TestCloneAndCreateScope:
    @pytest.mark.asyncio
    async def test_regular_user_cannot_clone_public_course(self, db, org, course, regular_user, mock_request):
        # Even with the create check out of the way, READ on a public course isn't enough.
        p = _clone_patches()
        with p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]:
            with pytest.raises(HTTPException) as exc:
                await clone_course(mock_request, course.course_uuid, regular_user, db)
        assert exc.value.status_code == 403
        count = len((await db.execute(select(Course))).scalars().all())
        assert count == 1

    @pytest.mark.asyncio
    async def test_admin_can_clone(self, db, org, course, admin_user, mock_request):
        p = _clone_patches()
        with p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]:
            cloned = await clone_course(mock_request, course.course_uuid, admin_user, db)
        assert cloned.course_uuid != course.course_uuid
        assert cloned.org_id == org.id

    @pytest.mark.asyncio
    async def test_cross_org_instructor_cannot_create_in_learner_org(
        self, db, org, other_org, cross_org_instructor, mock_request
    ):
        with patch(f"{COURSES_MOD}.check_limits_with_usage"):
            with pytest.raises(HTTPException) as exc:
                await create_course(
                    mock_request, org.id, CourseCreate(
                        name="x", description="x", org_id=org.id,
                        public=False, published=False, open_to_contributors=False,
                    ),
                    cross_org_instructor, db,
                )
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_cross_org_instructor_cannot_clone_in_learner_org(
        self, db, org, other_org, course, cross_org_instructor, mock_request
    ):
        p = _clone_patches()
        with p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]:
            with pytest.raises(HTTPException) as exc:
                await clone_course(mock_request, course.course_uuid, cross_org_instructor, db)
        assert exc.value.status_code == 403
