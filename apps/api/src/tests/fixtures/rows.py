"""Row builders for tests that need more rows than the conftest fixtures give."""

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum


def activity_row(id, org_id, course_id, uuid, published=True) -> Activity:
    return Activity(
        id=id,
        name=uuid,
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={},
        published=published,
        org_id=org_id,
        course_id=course_id,
        activity_uuid=uuid,
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
