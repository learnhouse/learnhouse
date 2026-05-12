"""Tests for the headless extra_metadata JSONB field on Course."""

from unittest.mock import AsyncMock, patch

from sqlmodel import select

from src.db.courses.courses import (
    Course,
    CourseCreate,
    CourseRead,
    CourseUpdate,
)
from src.services.courses.courses import (
    create_course,
    get_courses_orgslug,
    update_course,
)


def _bypass_create_dependencies():
    """Patches required to run create_course in the test environment."""
    return (
        patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ),
        patch("src.services.courses.courses.check_limits_with_usage"),
        patch("src.services.courses.courses.increase_feature_usage"),
        patch(
            "src.services.courses.courses.dispatch_webhooks",
            new_callable=AsyncMock,
        ),
    )


async def test_create_course_with_extra_metadata(
    db, org, admin_user, mock_request
):
    """create_course persists extra_metadata and returns it on the read model."""
    metadata = {"sku": "ABC", "vendor": {"name": "x"}}
    rbac, limits, usage, webhooks = _bypass_create_dependencies()
    with rbac, limits, usage, webhooks:
        created = await create_course(
            mock_request,
            org.id,
            CourseCreate(
                org_id=org.id,
                name="Metadata Course",
                description="desc",
                public=False,
                published=False,
                open_to_contributors=False,
                extra_metadata=metadata,
            ),
            admin_user,
            db,
        )

    assert isinstance(created, CourseRead)
    assert created.extra_metadata == metadata

    row = db.exec(
        select(Course).where(Course.course_uuid == created.course_uuid)
    ).first()
    assert row is not None
    assert row.extra_metadata == metadata


async def test_update_course_sets_extra_metadata(
    db, org, course, admin_user, mock_request, bypass_webhooks
):
    """update_course writes extra_metadata to the row."""
    with patch(
        "src.services.courses.courses.check_resource_access",
        new_callable=AsyncMock,
    ):
        updated = await update_course(
            mock_request,
            CourseUpdate(extra_metadata={"k": "v"}),
            course.course_uuid,
            admin_user,
            db,
        )

    assert updated.extra_metadata == {"k": "v"}

    db.refresh(course)
    assert course.extra_metadata == {"k": "v"}


async def test_update_course_does_not_clobber_extra_metadata_when_omitted(
    db, org, course, admin_user, mock_request, bypass_webhooks
):
    """A CourseUpdate that omits extra_metadata must leave the prior value intact."""
    course.extra_metadata = {"preserved": True}
    db.add(course)
    db.commit()
    db.refresh(course)

    with patch(
        "src.services.courses.courses.check_resource_access",
        new_callable=AsyncMock,
    ):
        updated = await update_course(
            mock_request,
            CourseUpdate(name="Renamed Course"),
            course.course_uuid,
            admin_user,
            db,
        )

    assert updated.name == "Renamed Course"
    assert updated.extra_metadata == {"preserved": True}

    db.refresh(course)
    assert course.extra_metadata == {"preserved": True}


async def test_get_courses_orgslug_returns_extra_metadata(
    db, org, admin_user, mock_request
):
    """Listing courses by org slug includes extra_metadata on each CourseRead."""
    metadata = {"channel": "web", "tags": ["a", "b"]}
    rbac, limits, usage, webhooks = _bypass_create_dependencies()
    with rbac, limits, usage, webhooks:
        created = await create_course(
            mock_request,
            org.id,
            CourseCreate(
                org_id=org.id,
                name="Listed Course",
                description="d",
                public=True,
                published=True,
                open_to_contributors=False,
                extra_metadata=metadata,
            ),
            admin_user,
            db,
        )

    results = await get_courses_orgslug(
        mock_request, admin_user, org.slug, db, page=1, limit=10
    )

    match = next(
        (c for c in results if c.course_uuid == created.course_uuid), None
    )
    assert match is not None
    assert match.extra_metadata == metadata
