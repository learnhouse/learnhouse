"""
Bulk user update from CSV.

Updates existing users in an organization based on a CSV upload. Useful for
end-of-year promotions, role changes, and adding fresh enrollments to users
who already exist (no new accounts are created — that path is bulk-import).

Semantics
---------
- Lookup is by ``email``: a row whose email is not in the org is reported in
  ``errors`` and skipped.
- Empty cells are **ignored**, never used to clear a field — partial updates
  are the common case for class lists.
- ``user_groups``, ``courses``, ``collections`` are **additive only**. To
  remove memberships or enrollments, use the bulk-unenroll endpoint.
- Each row is processed independently — failures don't abort the batch.
"""

import csv
import logging
from datetime import datetime
from io import StringIO
from typing import List
from uuid import uuid4

from fastapi import HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select

from src.db.collections import Collection
from src.db.collections_courses import CollectionCourse
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.trail_runs import TrailRun
from src.db.trails import Trail
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import AnonymousUser, PublicUser, User
from src.services.users.bulk_import import (
    CSV_INNER_SEPARATOR,
    BulkImportError,
    _split_multi,
)
from src.services.users.users import rbac_check


CSV_REQUIRED_COLUMNS = {"email"}
CSV_OPTIONAL_COLUMNS = {
    "first_name",
    "last_name",
    "username",
    "role_id",
    "user_groups",
    "courses",
    "collections",
}


class BulkUpdateResult(BaseModel):
    rows_processed: int
    users_updated: int
    users_not_found: int
    users_failed: int
    enrollments_added: int
    usergroup_assignments_added: int
    errors: List[BulkImportError]


async def bulk_update_users_from_csv(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    org_id: int,
    csv_content: str,
) -> BulkUpdateResult:
    """
    Update users that already exist in the organization, optionally adding
    them to user groups and enrolling them in courses/collections.

    Does not create new users. Does not remove memberships or enrollments
    (additive only — use bulk-unenroll for removals).
    """
    await rbac_check(request, current_user, "update", "user_x", db_session)

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
    users_updated = 0
    users_not_found = 0
    users_failed = 0
    enrollments_added = 0
    usergroup_assignments_added = 0

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

        # Verify the user actually belongs to this org before mutating anything
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

        try:
            user_changed = False
            for field in ("first_name", "last_name", "username"):
                value = (row.get(field) or "").strip()
                if value:
                    setattr(user, field, value)
                    user_changed = True

            role_id_str = (row.get("role_id") or "").strip()
            if role_id_str:
                try:
                    role_id = int(role_id_str)
                except ValueError:
                    errors.append(BulkImportError(
                        row=idx, email=email,
                        error=f"Invalid role_id (not an integer): {role_id_str}",
                    ))
                else:
                    if user_org.role_id != role_id:
                        user_org.role_id = role_id
                        user_org.update_date = str(datetime.now())
                        db_session.add(user_org)

            if user_changed:
                user.update_date = str(datetime.now())
                db_session.add(user)
                users_updated += 1
            elif role_id_str:
                # Role-only change still counts as an update
                users_updated += 1
        except Exception as e:
            logging.exception("Unexpected error updating user during bulk update")
            users_failed += 1
            errors.append(BulkImportError(
                row=idx, email=email, error=f"Unexpected error: {e}",
            ))
            continue

        # Additive user-group memberships
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

            existing_link = db_session.exec(
                select(UserGroupUser).where(
                    UserGroupUser.usergroup_id == ug_id,
                    UserGroupUser.user_id == user.id,
                )
            ).first()
            if existing_link:
                continue

            db_session.add(UserGroupUser(
                usergroup_id=ug_id,
                user_id=user.id,
                org_id=org_id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            ))
            usergroup_assignments_added += 1

        # Build course list (direct + expanded from collections)
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
        trail: Trail | None = None
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

            existing_run = db_session.exec(
                select(TrailRun).where(
                    TrailRun.course_id == course.id,
                    TrailRun.user_id == user.id,
                    TrailRun.org_id == org_id,
                )
            ).first()
            if existing_run:
                continue

            if trail is None:
                trail = db_session.exec(
                    select(Trail).where(
                        Trail.org_id == org_id,
                        Trail.user_id == user.id,
                    )
                ).first()
                if trail is None:
                    trail = Trail(
                        org_id=org_id,
                        user_id=user.id,
                        trail_uuid=f"trail_{uuid4()}",
                        creation_date=str(datetime.now()),
                        update_date=str(datetime.now()),
                    )
                    db_session.add(trail)
                    db_session.commit()
                    db_session.refresh(trail)

            db_session.add(TrailRun(
                trail_id=trail.id if trail.id is not None else 0,
                course_id=course.id if course.id is not None else 0,
                org_id=org_id,
                user_id=user.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            ))
            enrollments_added += 1

    db_session.commit()

    return BulkUpdateResult(
        rows_processed=rows_processed,
        users_updated=users_updated,
        users_not_found=users_not_found,
        users_failed=users_failed,
        enrollments_added=enrollments_added,
        usergroup_assignments_added=usergroup_assignments_added,
        errors=errors,
    )
