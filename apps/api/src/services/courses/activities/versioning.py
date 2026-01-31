from sqlmodel import Session, select
from sqlalchemy import desc
from src.db.courses.activities import Activity
from src.db.courses.activity_versions import ActivityVersion, ActivityVersionRead, ActivityStateRead
from src.db.courses.courses import Course
from src.db.users import User, PublicUser, AnonymousUser
from fastapi import HTTPException, Request
from datetime import datetime
from typing import List, Optional

from src.security.courses_security import courses_rbac_check_for_activities
from src.security.features_utils.usage import check_feature_access

# Maximum number of versions to keep per activity
# Change this constant to adjust how many saves are stored
MAX_ACTIVITY_VERSIONS = 20


async def create_activity_version(
    activity: Activity,
    user_id: Optional[int],
    db_session: Session,
) -> ActivityVersion:
    """
    Creates a new version snapshot of the activity content.
    Called before updating an activity to preserve the current state.
    """
    # Create new version
    version = ActivityVersion(
        activity_id=activity.id,
        org_id=activity.org_id,
        version_number=activity.current_version,
        content=activity.content,
        created_by_id=user_id,
        created_at=datetime.utcnow(),
    )

    db_session.add(version)
    db_session.commit()
    db_session.refresh(version)

    # Cleanup old versions
    await cleanup_old_versions(activity.id, db_session)

    return version


async def cleanup_old_versions(
    activity_id: int,
    db_session: Session,
) -> None:
    """
    Removes old versions keeping only the last MAX_ACTIVITY_VERSIONS.
    """
    # Get all versions for this activity ordered by version number descending
    statement = (
        select(ActivityVersion)
        .where(ActivityVersion.activity_id == activity_id)
        .order_by(desc(ActivityVersion.version_number))
    )
    versions = db_session.exec(statement).all()

    # Delete versions beyond the limit
    if len(versions) > MAX_ACTIVITY_VERSIONS:
        versions_to_delete = versions[MAX_ACTIVITY_VERSIONS:]
        for version in versions_to_delete:
            db_session.delete(version)
        db_session.commit()


async def get_activity_versions(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
    limit: int = 20,
    offset: int = 0,
) -> List[ActivityVersionRead]:
    """
    Gets the version history for an activity.
    Returns versions in descending order (newest first).
    """
    # Get activity
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # Check versioning feature access (requires standard plan or OSS mode)
    check_feature_access("versioning", activity.org_id, db_session)

    # RBAC check
    statement = select(Course).where(Course.id == activity.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    await courses_rbac_check_for_activities(request, course.course_uuid, current_user, "read", db_session)

    # Get versions with user info
    statement = (
        select(ActivityVersion, User)
        .outerjoin(User, ActivityVersion.created_by_id == User.id)
        .where(ActivityVersion.activity_id == activity.id)
        .order_by(desc(ActivityVersion.version_number))
        .offset(offset)
        .limit(limit)
    )
    results = db_session.exec(statement).all()

    versions = []
    for version, user in results:
        version_read = ActivityVersionRead(
            id=version.id,
            activity_id=version.activity_id,
            org_id=version.org_id,
            version_number=version.version_number,
            content=version.content,
            created_by_id=version.created_by_id,
            created_at=version.created_at,
            created_by_username=user.username if user else None,
            created_by_avatar=user.avatar_image if user else None,
        )
        versions.append(version_read)

    return versions


async def get_activity_version(
    request: Request,
    activity_uuid: str,
    version_number: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> ActivityVersionRead:
    """
    Gets a specific version of an activity by version number.
    """
    # Get activity
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # Check versioning feature access (requires standard plan or OSS mode)
    check_feature_access("versioning", activity.org_id, db_session)

    # RBAC check
    statement = select(Course).where(Course.id == activity.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    await courses_rbac_check_for_activities(request, course.course_uuid, current_user, "read", db_session)

    # Get specific version with user info
    statement = (
        select(ActivityVersion, User)
        .outerjoin(User, ActivityVersion.created_by_id == User.id)
        .where(
            ActivityVersion.activity_id == activity.id,
            ActivityVersion.version_number == version_number
        )
    )
    result = db_session.exec(statement).first()

    if not result:
        raise HTTPException(
            status_code=404,
            detail="Version not found",
        )

    version, user = result
    return ActivityVersionRead(
        id=version.id,
        activity_id=version.activity_id,
        org_id=version.org_id,
        version_number=version.version_number,
        content=version.content,
        created_by_id=version.created_by_id,
        created_at=version.created_at,
        created_by_username=user.username if user else None,
        created_by_avatar=user.avatar_image if user else None,
    )


async def get_activity_state(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> ActivityStateRead:
    """
    Gets the current state of an activity for conflict detection.
    Returns lightweight info: update_date, current_version, last_modified_by.
    Used by frontend to check if remote state has changed.
    """
    # Get activity with last modified user info
    statement = (
        select(Activity, User)
        .outerjoin(User, Activity.last_modified_by_id == User.id)
        .where(Activity.activity_uuid == activity_uuid)
    )
    result = db_session.exec(statement).first()

    if not result:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    activity, user = result

    # Check versioning feature access (requires standard plan or OSS mode)
    check_feature_access("versioning", activity.org_id, db_session)

    # RBAC check
    statement = select(Course).where(Course.id == activity.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    await courses_rbac_check_for_activities(request, course.course_uuid, current_user, "read", db_session)

    return ActivityStateRead(
        activity_uuid=activity.activity_uuid,
        update_date=activity.update_date,
        current_version=activity.current_version,
        last_modified_by_id=activity.last_modified_by_id,
        last_modified_by_username=user.username if user else None,
    )


async def restore_activity_version(
    request: Request,
    activity_uuid: str,
    version_number: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> Activity:
    """
    Restores an activity to a specific version.
    Creates a new version with the restored content.
    """
    # Get activity
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # Check versioning feature access (requires standard plan or OSS mode)
    check_feature_access("versioning", activity.org_id, db_session)

    # RBAC check
    statement = select(Course).where(Course.id == activity.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    await courses_rbac_check_for_activities(request, course.course_uuid, current_user, "update", db_session)

    # Get the version to restore
    statement = (
        select(ActivityVersion)
        .where(
            ActivityVersion.activity_id == activity.id,
            ActivityVersion.version_number == version_number
        )
    )
    version = db_session.exec(statement).first()

    if not version:
        raise HTTPException(
            status_code=404,
            detail="Version not found",
        )

    # Create a version of the current state before restoring
    user_id = current_user.id if hasattr(current_user, 'id') else None
    await create_activity_version(activity, user_id, db_session)

    # Restore content and update metadata
    activity.content = version.content
    activity.current_version = activity.current_version + 1
    activity.update_date = str(datetime.now())
    activity.last_modified_by_id = user_id

    # Mark content as modified
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(activity, "content")

    db_session.add(activity)
    db_session.commit()
    db_session.refresh(activity)

    return activity
