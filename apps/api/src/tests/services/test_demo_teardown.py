"""Cascade coverage for the demo organization.

Tearing the demo org down — and deleting a visitor-created course as drift —
relies entirely on ``ON DELETE CASCADE``. If a foreign key to ``organization``
or ``user`` silently loses its cascade, teardown stops being complete and the
database accumulates rows belonging to an org that no longer exists.

These are metadata assertions rather than runtime deletes on purpose. The
suite runs against in-memory SQLite, which does not enforce foreign keys
unless explicitly asked, so a runtime test here would prove nothing about the
Postgres schema the application actually runs on. Asserting on the SQLAlchemy
metadata catches the regression at its source — the model definition — and is
what the migrations are generated from.
"""

import importlib
import os

import pytest
from sqlmodel import SQLModel


def _import_all_models() -> None:
    """Register every model on SQLModel.metadata.

    Walks the ``src/db`` directory exactly the way ``migrations/env.py`` does,
    rather than using ``pkgutil.walk_packages``: several model directories
    (``src/db/courses`` among them) have no ``__init__.py``, and
    ``walk_packages`` skips those silently — which would drop most of the
    course and assignment tables from the metadata and let this test pass over
    the very cascades it exists to check.

    Importing a hand-written list has the same failure mode: a table nobody
    remembered to import is a table whose missing cascade goes unnoticed.
    """
    db_dir = os.path.join(os.path.dirname(__file__), "..", "..", "db")
    db_dir = os.path.abspath(db_dir)

    for root, _dirs, files in os.walk(db_dir):
        if "__pycache__" in root:
            continue
        relative = os.path.relpath(root, db_dir)
        package = "src.db" if relative == "." else f"src.db.{relative.replace(os.sep, '.')}"
        for file_name in files:
            if not file_name.endswith(".py") or file_name == "__init__.py":
                continue
            importlib.import_module(f"{package}.{file_name[:-3]}")


_import_all_models()


def _foreign_keys_to(table_name: str):
    """Yield (child_table, column, fk) for every FK pointing at `table_name`."""
    for table in SQLModel.metadata.tables.values():
        for column in table.columns:
            for fk in column.foreign_keys:
                if fk.column.table.name == table_name:
                    yield table.name, column.name, fk


# Columns that intentionally survive their parent instead of cascading. Each
# one is a nullable back-reference where losing the row would destroy
# independent history, so SET NULL is the correct behaviour.
_SET_NULL_ALLOWED = {
    ("auditlog", "org_id"),
    ("auditlog", "user_id"),
    ("board", "created_by"),
    ("playground", "created_by"),
    ("activity", "last_modified_by_id"),
    ("activityversion", "created_by_id"),
    # The demo state row deliberately outlives its organization so the next
    # provision can read last_error and bundle_version off it.
    ("demo_state", "org_id"),
}


@pytest.mark.parametrize("parent", ["organization", "user"])
def test_every_foreign_key_cascades_or_is_explicitly_allowed(parent):
    """No FK to org/user may quietly default to NO ACTION.

    A NO ACTION foreign key does not merely leak rows: it makes the parent
    delete *fail*, so a teardown would abort partway and leave the demo org
    half-removed.
    """
    offenders = []
    for child_table, column, fk in _foreign_keys_to(parent):
        if (child_table, column) in _SET_NULL_ALLOWED:
            assert fk.ondelete == "SET NULL", (
                f"{child_table}.{column} is allowlisted as SET NULL but "
                f"declares ondelete={fk.ondelete!r}"
            )
            continue
        if fk.ondelete != "CASCADE":
            offenders.append(f"{child_table}.{column} (ondelete={fk.ondelete!r})")

    assert not offenders, (
        f"Foreign keys to {parent!r} without ON DELETE CASCADE — demo teardown "
        f"would leave these rows behind or fail outright:\n  "
        + "\n  ".join(sorted(offenders))
    )


def test_demo_tables_cascade_from_organization():
    """The registry must not outlive the org whose rows it claims to own."""
    entity_fks = {
        (col, fk.ondelete)
        for tbl, col, fk in _foreign_keys_to("organization")
        if tbl == "demo_entity"
    }
    assert entity_fks == {("org_id", "CASCADE")}


def test_progress_tables_reach_organization():
    """Every table the demo seeds progress into must be reachable from the org.

    Submissions and certificates carry no ``org_id`` of their own, so they can
    only be removed through their parent chain. This pins the specific links
    that chain depends on; if one is dropped, teardown silently starts leaving
    graded submissions behind for a deleted organization.
    """
    required_links = [
        ("trailstep", "org_id", "organization"),
        ("trailrun", "org_id", "organization"),
        ("trail", "org_id", "organization"),
        ("user_activity_day", "org_id", "organization"),
        # No org_id — these reach the org via assignment/course.
        ("assignmentusersubmission", "assignment_id", "assignment"),
        ("assignmenttasksubmission", "assignment_task_id", "assignmenttask"),
        ("certifications", "course_id", "course"),
        ("certificateuser", "certification_id", "certifications"),
    ]

    missing = []
    for child, column, parent in required_links:
        table = SQLModel.metadata.tables.get(child)
        if table is None:
            missing.append(f"{child} (table not registered)")
            continue
        found = any(
            fk.column.table.name == parent and fk.ondelete == "CASCADE"
            for fk in table.columns[column].foreign_keys
        )
        if not found:
            missing.append(f"{child}.{column} -> {parent}")

    assert not missing, (
        "Broken cascade chain — demo teardown would orphan rows:\n  "
        + "\n  ".join(missing)
    )


def test_resource_author_has_no_cascade_from_its_resource():
    """Regression guard for a known gap the drift deletion has to compensate for.

    ``ResourceAuthor`` links to content by a bare ``resource_uuid`` string with
    no foreign key, so deleting a course does *not* remove its author rows.
    Demo-authored rows still disappear via the user cascade, but a course a
    visitor created is authored by a real user who survives the refresh — so
    drift deletion must remove those rows explicitly.

    If this test ever fails, a real FK has been added and that manual cleanup
    can (and should) be deleted.
    """
    resource_author = SQLModel.metadata.tables["resourceauthor"]
    assert not resource_author.columns["resource_uuid"].foreign_keys, (
        "resourceauthor.resource_uuid now has a foreign key — remove the "
        "manual author cleanup in the demo drift deletion."
    )


# ---------------------------------------------------------------------------
# What the cascade cannot reach
#
# The tests above assert on schema metadata because SQLite does not enforce
# foreign keys. The ones below are runtime tests of the parts teardown does
# by hand — deletes and file removals that happen in application code and so
# behave identically on either database.
# ---------------------------------------------------------------------------

@pytest.fixture
async def torn_down_demo(db, monkeypatch):
    """A demo org with a course, a student and a visitor, then torn down.

    Returns the recorded storage paths so a test can assert on which
    directories teardown asked to remove.
    """
    from datetime import datetime

    from src.db.courses.courses import Course
    from src.db.organizations import Organization
    from src.db.resource_authors import (
        ResourceAuthor,
        ResourceAuthorshipEnum,
        ResourceAuthorshipStatusEnum,
    )
    from src.db.user_organizations import UserOrganization
    from src.db.users import User
    from src.services.demo import teardown as teardown_module

    now = str(datetime.now())

    org = Organization(
        id=77, name="Demo", slug="demo", email="demo@example.com",
        org_uuid="org_demo77", is_demo=True, creation_date=now, update_date=now,
    )
    db.add(org)
    await db.flush()

    course = Course(
        org_id=org.id, name="Course", description="", about="", learnings="",
        tags="", thumbnail_image="", public=True, open_to_contributors=False,
        course_uuid="course_demo", creation_date=now, update_date=now,
    )
    db.add(course)

    student = User(
        id=501, username="s1", first_name="S", last_name="One",
        email="demo-01@demo.example.com", password="hashed",
        user_uuid="user_student1", signup_method="demo",
        creation_date=now, update_date=now,
    )
    visitor = User(
        id=502, username="v1", first_name="V", last_name="One",
        email="visitor@example.com", password="hashed",
        user_uuid="user_visitor1", signup_method="email",
        creation_date=now, update_date=now,
    )
    db.add(student)
    db.add(visitor)
    await db.flush()

    for user_id in (student.id, visitor.id):
        db.add(
            UserOrganization(
                user_id=user_id, org_id=org.id, role_id=1,
                creation_date=now, update_date=now,
            )
        )
        # Both authored the course: the student's row would go with the student
        # anyway, the visitor's is the one that orphans.
        db.add(
            ResourceAuthor(
                resource_uuid=course.course_uuid,
                user_id=user_id,
                authorship=ResourceAuthorshipEnum.CREATOR,
                authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
                creation_date=now, update_date=now,
            )
        )
    await db.commit()

    deleted_paths: list[str] = []
    monkeypatch.setattr(
        "src.services.courses.transfer.storage_utils.delete_storage_directory",
        lambda path: deleted_paths.append(path) or True,
    )

    await teardown_module.teardown_demo(db)
    await db.commit()

    return deleted_paths


async def test_teardown_removes_authorship_rows_pointing_at_demo_content(
    db, torn_down_demo
):
    """Nothing may be left referencing a course that no longer exists."""
    from sqlmodel import select

    from src.db.resource_authors import ResourceAuthor

    remaining = (await db.execute(select(ResourceAuthor))).scalars().all()
    assert remaining == []


async def test_teardown_removes_the_seeded_students_but_not_visitors(
    db, torn_down_demo
):
    from sqlmodel import select

    from src.db.users import User

    emails = set((await db.execute(select(User.email))).scalars().all())
    assert "demo-01@demo.example.com" not in emails
    assert "visitor@example.com" in emails, "a visitor is a real user account"


async def test_teardown_removes_uploaded_files(torn_down_demo):
    """Course media, org branding and student avatars are not database rows."""
    assert "content/orgs/org_demo77" in torn_down_demo
    assert "content/users/user_student1" in torn_down_demo
    assert "content/users/user_visitor1" not in torn_down_demo


async def test_teardown_survives_unreachable_storage(db, monkeypatch):
    """A failing bucket must not abort a teardown that already deleted rows.

    Half a torn-down org is worse than orphaned files: the next provision
    collides with what is left.
    """
    from datetime import datetime

    from sqlmodel import select

    from src.db.organizations import Organization
    from src.services.demo.teardown import teardown_demo

    now = str(datetime.now())
    db.add(
        Organization(
            id=78, name="Demo", slug="demo2", email="d2@example.com",
            org_uuid="org_demo78", is_demo=True, creation_date=now, update_date=now,
        )
    )
    await db.commit()

    def _boom(path):
        raise OSError("bucket unreachable")

    monkeypatch.setattr(
        "src.services.courses.transfer.storage_utils.delete_storage_directory", _boom
    )

    await teardown_demo(db)
    await db.commit()

    remaining = (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().all()
    assert remaining == []
