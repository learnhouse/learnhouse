"""The shared member profile model (org_member_profile)."""

from datetime import timezone

from src.db.org_member_profile import EMPLOYMENT_STATUSES, PROFILE_SOURCES, OrgMemberProfile


def test_defaults():
    p = OrgMemberProfile(org_id=1, user_id=2)
    assert p.employment_status == "active" and p.source == "manual" and p.digest_opt_out is False
    assert p.manager_user_id is None and p.updated_at.tzinfo is timezone.utc
    assert EMPLOYMENT_STATUSES == ("active", "inactive")
    assert set(PROFILE_SOURCES) == {"manual", "scim", "import", "signup"}


async def test_round_trip(db, org, admin_user, regular_user):
    db.add(OrgMemberProfile(org_id=org.id, user_id=regular_user.id, manager_user_id=admin_user.id,
                            department="Engineering", attributes={"division": "Labs"}))
    await db.commit()
    row = await db.get(OrgMemberProfile, (org.id, regular_user.id))
    assert row.department == "Engineering" and row.attributes == {"division": "Labs"}
