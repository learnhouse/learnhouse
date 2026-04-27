"""
Bulk user export to CSV.

Mirrors the columns produced by ``bulk_import.bulk_import_users_from_csv``
(minus ``password``, which is never exported) so admins can export the
current state of an organization, edit in Excel/Sheets, and feed the
result back through the bulk-import endpoint.
"""

import csv
from io import StringIO
from typing import Iterable, Optional

from fastapi import HTTPException, Request
from sqlmodel import Session, select

from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import AnonymousUser, PublicUser, User
from src.services.users.users import rbac_check


CSV_HEADERS = [
    "email",
    "first_name",
    "last_name",
    "username",
    "role_id",
    "user_groups",
]
CSV_INNER_SEPARATOR = "|"


async def export_users_to_csv(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    org_id: int,
    usergroup_id: Optional[int] = None,
) -> str:
    """
    Build a CSV string listing every user in the given organization.

    When ``usergroup_id`` is provided the export is narrowed to the members
    of that user group only (useful for exporting a class roster).

    Columns mirror the bulk-import format so the file is round-trippable
    (minus ``password``, which is intentionally omitted — password hashes
    are never exposed).
    """
    await rbac_check(request, current_user, "read", "user_x", db_session)

    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if usergroup_id is not None:
        ug = db_session.exec(
            select(UserGroup).where(
                UserGroup.id == usergroup_id, UserGroup.org_id == org_id,
            )
        ).first()
        if not ug:
            raise HTTPException(
                status_code=404,
                detail="UserGroup not found in this organization",
            )

    user_query = (
        select(User, UserOrganization)
        .join(UserOrganization, UserOrganization.user_id == User.id)  # type: ignore[arg-type]
        .where(UserOrganization.org_id == org_id)
    )
    if usergroup_id is not None:
        user_query = user_query.join(
            UserGroupUser, UserGroupUser.user_id == User.id  # type: ignore[arg-type]
        ).where(UserGroupUser.usergroup_id == usergroup_id)

    rows = db_session.exec(user_query).all()

    user_ids = [user.id for user, _ in rows if user.id is not None]
    groups_by_user: dict[int, list[int]] = {uid: [] for uid in user_ids}
    if user_ids:
        memberships = db_session.exec(
            select(UserGroupUser).where(
                UserGroupUser.user_id.in_(user_ids),  # type: ignore[attr-defined]
                UserGroupUser.org_id == org_id,
            )
        ).all()
        for m in memberships:
            groups_by_user.setdefault(m.user_id, []).append(m.usergroup_id)

    buffer = StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_HEADERS)

    for user, user_org in rows:
        ug_ids = sorted(groups_by_user.get(user.id, [])) if user.id is not None else []
        writer.writerow([
            user.email,
            user.first_name or "",
            user.last_name or "",
            user.username,
            user_org.role_id,
            CSV_INNER_SEPARATOR.join(str(gid) for gid in ug_ids),
        ])

    return buffer.getvalue()


def iter_csv_chunks(csv_content: str, chunk_size: int = 8192) -> Iterable[bytes]:
    """Yield the CSV body in chunks for StreamingResponse."""
    encoded = csv_content.encode("utf-8")
    for i in range(0, len(encoded), chunk_size):
        yield encoded[i : i + chunk_size]
