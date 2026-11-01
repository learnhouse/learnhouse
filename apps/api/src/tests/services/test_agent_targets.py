"""The kind and name an approval or pending action shows
(src/services/ai/tools/targets.py)."""

from datetime import datetime

from src.db.courses.chapters import Chapter
from src.services.ai.tools.targets import describe_target


async def test_create_names_the_new_item_and_its_parent(db, org, course):
    target = await describe_target(
        "create_chapter", {"course_uuid": course.course_uuid, "name": "Respiration"}, "course_uuid", org.id, db
    )
    assert target == {
        "kind": "chapter",
        "name": "Respiration",
        "parent": {"kind": "course", "uuid": course.course_uuid, "name": course.name},
    }


async def test_delete_resolves_the_real_name(db, org, course):
    chapter = Chapter(name="Respiration", org_id=org.id, course_id=course.id, chapter_uuid="chapter_r", creation_date=str(datetime.now()), update_date=str(datetime.now()))
    db.add(chapter)
    await db.commit()
    target = await describe_target("delete_chapter", {"chapter_uuid": "chapter_r"}, "chapter_uuid", org.id, db)
    assert target == {"kind": "chapter", "uuid": "chapter_r", "name": "Respiration"}


async def test_other_orgs_names_stay_hidden(db, org, other_org, course):
    target = await describe_target("delete_course", {"course_uuid": course.course_uuid}, "course_uuid", other_org.id, db)
    assert target == {"kind": "course", "uuid": course.course_uuid}


async def test_rename_keeps_both_names(db, org, course):
    target = await describe_target("update_course", {"course_uuid": course.course_uuid, "name": "New"}, "course_uuid", org.id, db)
    assert target["name"] == course.name and target["new_name"] == "New"


async def test_members_by_uuid_or_email(db, org, other_org, admin_user):
    by_uuid = await describe_target("set_member_role", {"member": admin_user.user_uuid}, None, org.id, db)
    assert by_uuid["kind"] == "user" and by_uuid["name"]
    by_email = await describe_target("remove_member", {"member": admin_user.email}, None, org.id, db)
    assert by_email["name"] == by_uuid["name"]
    # Not a member of the other org: no name.
    elsewhere = await describe_target("remove_member", {"member": admin_user.user_uuid}, None, other_org.id, db)
    assert "name" not in elsewhere or elsewhere["name"] is None


async def test_copy_and_unknown_shapes(db, org, course):
    copy = await describe_target(
        "create_course", {"name": "Copy", "copy_from_course_uuid": course.course_uuid}, None, org.id, db
    )
    assert copy["kind"] == "course" and copy["source"] == {"kind": "course", "uuid": course.course_uuid, "name": course.name}
    loose = await describe_target("update_org", {"name": "Acme"}, None, org.id, db)
    assert loose == {"kind": "org", "name": "Acme"}
    assert await describe_target("invite", {}, None, org.id, db) == {"kind": "item"}
    broken = await describe_target("delete_course", {"course_uuid": "course_x"}, "course_uuid", org.id, None)
    assert broken == {"kind": "course", "uuid": "course_x", "name": None} or broken == {"kind": "course", "uuid": "course_x"}
