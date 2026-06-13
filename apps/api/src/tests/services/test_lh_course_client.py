import pytest
from sqlmodel import select

from src.services.courses.lh_course_client import LhCourseClient
from src.db.courses.activities import Activity, ActivitySubTypeEnum
from src.db.courses.courses import Course


class _OneSession:
    """Adapt an existing AsyncSession into the `async with factory()` shape,
    without closing it (the db fixture owns its lifecycle)."""

    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc):
        return False


@pytest.fixture
def kb_client(db, org):
    return LhCourseClient(org.id, session_factory=lambda: _OneSession(db))


async def test_create_renders_body_md_into_markdown_activity(kb_client, db, org):
    await kb_client.upsert_course(
        org_id=org.id,
        match={"extra_metadata.kb_id": "kb-1"},
        course={
            "name": "Launch Brief",
            "description": "summary",
            "tags": "source:kb,type:product_brief",
            "public": False,
            "published": True,
            "open_to_contributors": False,
            "extra_metadata": {"source": "kb", "kb_id": "kb-1", "kb_sha": "sha1"},
        },
        body_md="# Hello\n\nThis is the brief body.",
    )

    course = (await db.execute(select(Course).where(Course.org_id == org.id))).scalars().first()
    assert course is not None

    activity = (
        await db.execute(
            select(Activity).where(
                Activity.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_DYNAMIC_MARKDOWN
            )
        )
    ).scalars().first()
    assert activity is not None
    assert activity.content == {"markdown": "# Hello\n\nThis is the brief body."}
    assert activity.published is True


async def test_update_refreshes_markdown_when_sha_changes(kb_client, db, org):
    base = dict(
        org_id=org.id,
        match={"extra_metadata.kb_id": "kb-2"},
        course={
            "name": "Brief",
            "description": "s",
            "tags": "source:kb",
            "public": False,
            "published": True,
            "open_to_contributors": False,
            "extra_metadata": {"source": "kb", "kb_id": "kb-2", "kb_sha": "sha1"},
        },
    )
    await kb_client.upsert_course(**base, body_md="original")

    updated = dict(base)
    updated["course"] = dict(base["course"])
    updated["course"]["extra_metadata"] = {"source": "kb", "kb_id": "kb-2", "kb_sha": "sha2"}
    await kb_client.upsert_course(**updated, body_md="revised body")

    activities = (
        await db.execute(
            select(Activity).where(
                Activity.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_DYNAMIC_MARKDOWN
            )
        )
    ).scalars().all()
    # exactly one markdown activity for kb-2, content refreshed
    assert len(activities) == 1
    assert activities[0].content == {"markdown": "revised body"}
