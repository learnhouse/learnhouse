"""
Bulk user unenrollment from CSV.

Removes users from user groups and courses (and from the courses contained
in given collections) based on a CSV upload. Mirrors the additive operations
of ``bulk_import`` and ``bulk_update`` in reverse.

Semantics
---------
- Lookup is by ``email``. Rows whose email is not in the org are reported in
  ``errors`` and skipped.
- Course unenrollment **deletes** the user's ``TrailRun`` and any associated
  ``TrailStep`` rows for that course (consistent with the existing
  ``bulk_unenroll_users`` admin function and ``unenroll_user``).
- User-group membership is **deleted** (consistent with ``remove_usergroup_member``).
- Each row is processed independently — failures don't abort the batch.
- The user account itself is never deleted.
"""

import csv
import logging
from io import StringIO
from typing import List

from fastapi import HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select

from src.db.collections import Collection
from src.db.collections_courses import CollectionCourse
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import AnonymousUser, PublicUser, User
from src.services.users.bulk_import import BulkImportError, _split_multi
from src.services.users.users import rbac_check


CSV_REQUIRED_COLUMNS = {"email"}
CSV_OPTIONAL_COLUMNS = {"user_groups", "courses", "collections"}


class BulkUnenrollResult(BaseModel):
    rows_processed: int
    users_not_found: int
    users_failed: int
    enrollments_removed: int
    usergroup_assignments_removed: int
    errors: List[BulkImportError]


async def bulk_unenroll_users_from_csv(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    org_id: int,
    csv_content: str,
) -> BulkUnenrollResult:
    """
    Remove users from listed user groups and courses based on CSV input.

    Collections are expanded to their constituent courses before unenrollment.
    """
    await rbac_check(request, current_user, "delete", "user_x", db_session)

    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    try:
        reader = csv.DictReader(StringIO(csv_content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid CSV: {e}")

    if reader.fieldnames is None:
        raise HTTPException(status_code=400, detail="CSV has no header row")

    headers = {h.strip() for h in reader.fieldnames}
    missing = CSV_REQUIRED_COLUMNS - headers
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"CSV missing required columns: {sorted(missing)}",
        )
    unknown = headers - CSV_REQUIRED_COLUMNS - CSV_OPTIONAL_COLUMNS
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"CSV has unknown columns: {sorted(unknown)}",
        )

    errors: list[BulkImportError] = []
    rows_processed = 0
    users_not_found = 0
    users_failed = 0
    enrollments_removed = 0
    usergroup_assignments_removed = 0

    collection_to_course_ids: dict[str, list[int]] = {}

    for idx, row in enumerate(reader, start=1):
        rows_processed += 1
        email = (row.get("email") or "").strip()
        if not email:
            errors.append(BulkImportError(row=idx, email="", error="Empty email"))
            users_failed += 1
            continue

        user = db_session.exec(select(User).where(User.email == email)).first()
        if not user or user.id is None:
            users_not_found += 1
            errors.append(BulkImportError(
                row=idx, email=email, error="User not found in this organization",
            ))
            continue

        user_org = db_session.exec(
            select(UserOrganization).where(
                UserOrganization.user_id == user.id,
                UserOrganization.org_id == org_id,
            )
        ).first()
        if not user_org:
            users_not_found += 1
            errors.append(BulkImportError(
                row=idx, email=email, error="User not found in this organization",
            ))
            continue

        # Remove user-group memberships
        for ug_id_str in _split_multi(row.get("user_groups", "")):
            try:
                ug_id = int(ug_id_str)
            except ValueError:
                errors.append(BulkImportError(
                    row=idx, email=email,
                    error=f"Invalid user_group id (not an integer): {ug_id_str}",
                ))
                continue

            ug = db_session.exec(
                select(UserGroup).where(UserGroup.id == ug_id, UserGroup.org_id == org_id)
            ).first()
            if not ug:
                errors.append(BulkImportError(
                    row=idx, email=email,
                    error=f"UserGroup {ug_id} not found in this org",
                ))
                continue

            membership = db_session.exec(
                select(UserGroupUser).where(
                    UserGroupUser.usergroup_id == ug_id,
                    UserGroupUser.user_id == user.id,
                )
            ).first()
            if membership is None:
                continue
            db_session.delete(membership)
            usergroup_assignments_removed += 1

        # Unenroll from courses (direct + expanded from collections)
        course_uuids: list[str] = list(_split_multi(row.get("courses", "")))

        for col_uuid in _split_multi(row.get("collections", "")):
            if col_uuid not in collection_to_course_ids:
                col = db_session.exec(
                    select(Collection).where(
                        Collection.collection_uuid == col_uuid,
                        Collection.org_id == org_id,
                    )
                ).first()
                if not col:
                    errors.append(BulkImportError(
                        row=idx, email=email,
                        error=f"Collection {col_uuid} not found in this org",
                    ))
                    collection_to_course_ids[col_uuid] = []
                    continue
                course_links = db_session.exec(
                    select(CollectionCourse).where(CollectionCourse.collection_id == col.id)
                ).all()
                collection_to_course_ids[col_uuid] = [cc.course_id for cc in course_links]

            for cid in collection_to_course_ids[col_uuid]:
                course = db_session.exec(select(Course).where(Course.id == cid)).first()
                if course:
                    course_uuids.append(course.course_uuid)

        seen_courses: set[str] = set()
        for course_uuid in course_uuids:
            if course_uuid in seen_courses:
                continue
            seen_courses.add(course_uuid)

            course = db_session.exec(
                select(Course).where(
                    Course.course_uuid == course_uuid,
                    Course.org_id == org_id,
                )
            ).first()
            if not course:
                errors.append(BulkImportError(
                    row=idx, email=email,
                    error=f"Course {course_uuid} not found in this org",
                ))
                continue

            trail_run = db_session.exec(
                select(TrailRun).where(
                    TrailRun.course_id == course.id,
                    TrailRun.user_id == user.id,
                    TrailRun.org_id == org_id,
                )
            ).first()
            if trail_run is None:
                continue

            steps = db_session.exec(
                select(TrailStep).where(
                    TrailStep.course_id == course.id,
                    TrailStep.user_id == user.id,
                    TrailStep.org_id == org_id,
                )
            ).all()
            for step in steps:
                db_session.delete(step)

            db_session.delete(trail_run)
            enrollments_removed += 1

    db_session.commit()

    return BulkUnenrollResult(
        rows_processed=rows_processed,
        users_not_found=users_not_found,
        users_failed=users_failed,
        enrollments_removed=enrollments_removed,
        usergroup_assignments_removed=usergroup_assignments_removed,
        errors=errors,
    )
