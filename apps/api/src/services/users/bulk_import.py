"""
Bulk user import from CSV.

Allows admins to create many users in a single request and optionally enroll
them into user groups, courses, and collections. Each row is processed
independently — a failure on one row does not abort the rest of the batch.

CSV format
----------
Required header: ``email``
Optional headers: ``first_name``, ``last_name``, ``username``, ``password``,
``role_id``, ``user_groups``, ``courses``, ``collections``

Multi-value cells (``user_groups``, ``courses``, ``collections``) use ``|`` as
the inner separator to avoid colliding with the CSV column delimiter.

Example::

    email,first_name,last_name,role_id,user_groups,courses,collections
    alice@school.pt,Alice,Silva,4,1|2,course_abc-123,
    bob@school.pt,Bob,Costa,4,1,,collection_xyz-456

When ``password`` is empty a strong random password is generated. The user can
recover access via the standard password-reset flow.
"""

import csv
import logging
import secrets
import string
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
from src.db.users import AnonymousUser, PublicUser, User, UserCreate
from src.services.users.users import create_user, rbac_check


CSV_REQUIRED_COLUMNS = {"email"}
CSV_OPTIONAL_COLUMNS = {
    "first_name",
    "last_name",
    "username",
    "password",
    "role_id",
    "user_groups",
    "courses",
    "collections",
}
CSV_INNER_SEPARATOR = "|"


class BulkImportError(BaseModel):
    row: int  # 1-indexed; row 1 is the first data row after the header
    email: str
    error: str


class BulkImportResult(BaseModel):
    rows_processed: int
    users_created: int
    users_skipped_existing: int
    users_failed: int
    enrollments_added: int
    usergroup_assignments_added: int
    errors: List[BulkImportError]


def _generate_random_password(length: int = 24) -> str:
    """Strong password meeting LearnHouse complexity rules (upper, lower, digit, special)."""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(length))
        if (
            any(c.islower() for c in pw)
            and any(c.isupper() for c in pw)
            and any(c.isdigit() for c in pw)
            and any(c in "!@#$%^&*" for c in pw)
        ):
            return pw


def _username_from_email(email: str) -> str:
    local = email.split("@")[0]
    safe = "".join(c if c.isalnum() or c == "_" else "_" for c in local)
    return safe.lower() or f"user_{secrets.token_hex(4)}"


def _split_multi(value: str) -> list[str]:
    if not value:
        return []
    return [v.strip() for v in value.split(CSV_INNER_SEPARATOR) if v.strip()]


async def bulk_import_users_from_csv(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    org_id: int,
    csv_content: str,
) -> BulkImportResult:
    """
    Parse CSV content and create users, then enroll them in any specified
    user groups, courses, or collections (collections are expanded to their
    constituent courses).

    Each row is processed independently. Failures are collected in
    ``errors`` and processing continues with the next row.
    """
    await rbac_check(request, current_user, "create", "user_x", db_session)

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
    users_created = 0
    users_skipped_existing = 0
    users_failed = 0
    enrollments_added = 0
    usergroup_assignments_added = 0

    # Cache resolved collection → course IDs so we don't query the same collection twice
    collection_to_course_ids: dict[str, list[int]] = {}

    for idx, row in enumerate(reader, start=1):
        rows_processed += 1
        email = (row.get("email") or "").strip()
        if not email:
            errors.append(BulkImportError(row=idx, email="", error="Empty email"))
            users_failed += 1
            continue

        existing_user = db_session.exec(select(User).where(User.email == email)).first()
        user_id_to_use: int | None = None

        if existing_user:
            users_skipped_existing += 1
            user_id_to_use = existing_user.id
        else:
            try:
                password = (row.get("password") or "").strip() or _generate_random_password()
                username = (row.get("username") or "").strip() or _username_from_email(email)
                user_create = UserCreate(
                    email=email,  # type: ignore[arg-type]  # Pydantic coerces to EmailStr
                    username=username,
                    first_name=(row.get("first_name") or "").strip(),
                    last_name=(row.get("last_name") or "").strip(),
                    password=password,
                )
                new_user = await create_user(
                    request=request,
                    db_session=db_session,
                    current_user=current_user,
                    user_object=user_create,
                    org_id=org_id,
                )
                user_id_to_use = new_user.id
                users_created += 1

                # Optional role override (create_user always assigns role 4 = User)
                role_id_str = (row.get("role_id") or "").strip()
                if role_id_str and role_id_str != "4" and new_user.id is not None:
                    try:
                        role_id = int(role_id_str)
                    except ValueError:
                        errors.append(BulkImportError(
                            row=idx, email=email,
                            error=f"Invalid role_id (not an integer): {role_id_str}",
                        ))
                    else:
                        user_org = db_session.exec(
                            select(UserOrganization).where(
                                UserOrganization.user_id == new_user.id,
                                UserOrganization.org_id == org_id,
                            )
                        ).first()
                        if user_org:
                            user_org.role_id = role_id
                            user_org.update_date = str(datetime.now())
                            db_session.add(user_org)
                            db_session.commit()
            except HTTPException as e:
                users_failed += 1
                errors.append(BulkImportError(row=idx, email=email, error=str(e.detail)))
                continue
            except Exception as e:
                logging.exception("Unexpected error creating user during bulk import")
                users_failed += 1
                errors.append(BulkImportError(row=idx, email=email, error=f"Unexpected error: {e}"))
                continue

        if user_id_to_use is None:
            continue

        # User-group assignments
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
                    UserGroupUser.user_id == user_id_to_use,
                )
            ).first()
            if existing_link:
                continue

            link = UserGroupUser(
                usergroup_id=ug_id,
                user_id=user_id_to_use,
                org_id=org_id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
            db_session.add(link)
            usergroup_assignments_added += 1

        # Build the union of explicit course UUIDs + courses unfolded from collections
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
        trail: Trail | None = None  # lazily fetched/created per user
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
                    TrailRun.user_id == user_id_to_use,
                    TrailRun.org_id == org_id,
                )
            ).first()
            if existing_run:
                continue

            if trail is None:
                trail = db_session.exec(
                    select(Trail).where(
                        Trail.org_id == org_id,
                        Trail.user_id == user_id_to_use,
                    )
                ).first()
                if trail is None:
                    trail = Trail(
                        org_id=org_id,
                        user_id=user_id_to_use,
                        trail_uuid=f"trail_{uuid4()}",
                        creation_date=str(datetime.now()),
                        update_date=str(datetime.now()),
                    )
                    db_session.add(trail)
                    db_session.commit()
                    db_session.refresh(trail)

            trail_run = TrailRun(
                trail_id=trail.id if trail.id is not None else 0,
                course_id=course.id if course.id is not None else 0,
                org_id=org_id,
                user_id=user_id_to_use,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
            db_session.add(trail_run)
            enrollments_added += 1

    db_session.commit()

    return BulkImportResult(
        rows_processed=rows_processed,
        users_created=users_created,
        users_skipped_existing=users_skipped_existing,
        users_failed=users_failed,
        enrollments_added=enrollments_added,
        usergroup_assignments_added=usergroup_assignments_added,
        errors=errors,
    )
