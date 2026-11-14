"""Inbox rows raised by OSS features (src/services/feature_notifications.py)
and the hooks that call them.

Rows are written by ``notify`` through a sibling session on the in-memory
engine, so they are visible to ``db`` once the emitter returns. Pushes are
captured by patching ``schedule_push``.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlmodel import select

from src.db.courses.activity_comments import ActivityComment, ActivityCommentThread
from src.db.notifications import Notification
from src.db.organization_config import OrganizationConfig
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import User
from src.security.features_utils import usage
from src.services import feature_notifications as fn


@pytest.fixture(autouse=True)
def pushed():
    calls: list[list[int]] = []
    with patch("src.services.notifications.push.schedule_push", side_effect=lambda ids: calls.append(list(ids))):
        yield calls


async def _rows(db, type_=None, user_id=None):
    stmt = select(Notification).order_by(Notification.id).execution_options(populate_existing=True)
    if type_:
        stmt = stmt.where(Notification.type == type_)
    if user_id is not None:
        stmt = stmt.where(Notification.user_id == user_id)
    return (await db.execute(stmt)).scalars().all()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _member(db, org, uid, username, role_id=4):
    db.add(User(id=uid, username=username, first_name=username.title(), last_name="", email=f"{username}@t.com",
                password="x", user_uuid=f"user_{username}", creation_date=_now(), update_date=_now()))
    db.add(UserOrganization(user_id=uid, org_id=org.id, role_id=role_id, creation_date=_now(), update_date=_now()))
    await db.commit()


async def _author(db, course, user_id, kind=ResourceAuthorshipEnum.CREATOR):
    db.add(ResourceAuthor(resource_uuid=course.course_uuid, user_id=user_id, authorship=kind,
                          authorship_status=ResourceAuthorshipStatusEnum.ACTIVE))
    await db.commit()


# ---------------------------------------------------------------------------
# Assignments
# ---------------------------------------------------------------------------


async def test_submission_to_grade_goes_to_course_authors_and_collapses(db, org, admin_user, regular_user, course, chapter, activity):
    await _author(db, course, admin_user.id)
    assignment = SimpleNamespace(id=7, title="Essay", assignment_uuid="assignment_abc")

    await fn.notify_submission_to_grade(db, assignment=assignment, course=course, activity=activity,
                                        learner_id=regular_user.id)
    await fn.notify_submission_to_grade(db, assignment=assignment, course=course, activity=activity,
                                        learner_id=regular_user.id)

    rows = await _rows(db, "submission_to_grade")
    assert [r.user_id for r in rows] == [admin_user.id]  # the learner (actor) is not told
    row = rows[0]
    assert row.audience == "admin" and row.count == 2 and row.actor_id == regular_user.id
    assert row.data["params"] == {"actor": "Regular User", "assignment": "Essay", "course": "Test Course"}
    assert row.data["path"] == "/dash/assignments/abc?subpage=submissions"
    # The detail says where (course › chapter); the actor is in the title.
    assert row.title == "New submission: Essay" and row.body.startswith("Test Course › ")
    assert row.group_key == f"submit:7:{regular_user.id}"

    # Read, then resubmitted: still one row for that learner, back to unread.
    from src.services.notifications.notifications import mark_read

    await mark_read(db, admin_user.id, all_=True, audience="admin")
    await fn.notify_submission_to_grade(db, assignment=assignment, course=course, activity=activity,
                                        learner_id=regular_user.id)
    (row,) = await _rows(db, "submission_to_grade")
    assert row.read_at is None and row.count == 1


async def test_submission_to_grade_without_learner_name(db, org, admin_user, course):
    await _author(db, course, admin_user.id)
    assignment = SimpleNamespace(id=8, title="Quiz", assignment_uuid="assignment_q")
    await fn.notify_submission_to_grade(db, assignment=assignment, course=course,
                                        activity=SimpleNamespace(activity_uuid="activity_x"), learner_id=999)
    (row,) = await _rows(db, "submission_to_grade")
    assert row.body == "Test Course"


async def test_manual_submission_notifies_graders(db, org, admin_user, regular_user, course, activity):
    """The hook in create_assignment_submission fires for a hand-in that waits
    for a teacher, and passes the learner as actor."""
    from src.db.courses.assignments import Assignment, GradingTypeEnum
    from src.services.courses.activities import assignments as svc

    a = Assignment(title="Report", description="", due_date="", published=True, grading_type=GradingTypeEnum.PERCENTAGE,
                   org_id=org.id, course_id=course.id, chapter_id=1, activity_id=activity.id,
                   assignment_uuid="assignment_rep", creation_date=_now(), update_date=_now())
    db.add(a)
    await db.commit()
    request = MagicMock()
    with patch.object(svc, "authorize_assignment_access", AsyncMock()), \
         patch.object(svc, "authorization_verify_based_on_roles", AsyncMock(return_value=False)), \
         patch.object(svc, "track", AsyncMock()), patch.object(svc, "record_audit_event", AsyncMock()), \
         patch.object(svc, "dispatch_webhooks", AsyncMock()), \
         patch.object(svc, "check_course_completion_and_create_certificate", AsyncMock()), \
         patch.object(svc, "notify_ee_learner_progress", MagicMock()), \
         patch("src.services.feature_notifications.notify_submission_to_grade", AsyncMock()) as hook:
        await svc.create_assignment_submission(request, "assignment_rep", regular_user, db)
    hook.assert_awaited_once()
    assert hook.await_args.kwargs["learner_id"] == regular_user.id


async def test_grade_passes_grader_to_learner_notification(db, org, admin_user, regular_user, course, activity):
    from src.services.courses.activities import assignments as svc

    with patch.object(svc, "authorize_assignment_access", AsyncMock()), \
         patch.object(svc, "_apply_grade_and_finalize", AsyncMock(return_value={"display_grade": "A"})) as finalize, \
         patch.object(svc, "check_course_completion_and_create_certificate", AsyncMock()), \
         patch.object(svc, "are_course_assignments_passed", AsyncMock(return_value=True)):
        from src.db.courses.assignments import (
            Assignment,
            AssignmentUserSubmission,
            AssignmentUserSubmissionStatus,
            GradingTypeEnum,
        )

        a = Assignment(title="R", description="", due_date="", published=True, grading_type=GradingTypeEnum.PERCENTAGE,
                       org_id=org.id, course_id=course.id, chapter_id=1, activity_id=activity.id,
                       assignment_uuid="assignment_g", creation_date=_now(), update_date=_now())
        db.add(a)
        await db.commit()
        db.add(AssignmentUserSubmission(user_id=regular_user.id, assignment_id=a.id, grade=0,
                                        assignmentusersubmission_uuid="aus_1",
                                        submission_status=AssignmentUserSubmissionStatus.SUBMITTED,
                                        creation_date=_now(), update_date=_now()))
        await db.commit()
        await svc.grade_assignment_submission(MagicMock(), regular_user.id, "assignment_g", admin_user, db)
    assert finalize.await_args.kwargs["grader_id"] == admin_user.id


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------


async def test_path_completed_once(db, org, regular_user):
    path = SimpleNamespace(id=3, org_id=org.id, name="Data", path_uuid="path_xyz")
    await fn.notify_path_completed(db, path, regular_user.id)
    await fn.notify_path_completed(db, path, regular_user.id)
    (row,) = await _rows(db, "path_completed")
    assert row.user_id == regular_user.id and row.audience == "personal"
    assert row.data["params"] == {"path": "Data"} and row.data["path"] == "/path/xyz"


# ---------------------------------------------------------------------------
# Communities
# ---------------------------------------------------------------------------


def _discussion(org, author_id, content="", title="Hello"):
    return SimpleNamespace(id=5, org_id=org.id, title=title, content=content, author_id=author_id,
                           discussion_uuid="discussion_d")


@pytest.fixture
async def community(db, org):
    from src.db.communities.communities import Community

    row = Community(name="C", org_id=org.id, community_uuid="community_c", public=True,
                    creation_date=_now(), update_date=_now())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def test_discussion_comment_reply_and_mention(db, org, admin_user, regular_user, community):
    COMMUNITY = community
    await _member(db, org, 3, "carol")
    discussion = _discussion(org, author_id=regular_user.id)

    # carol mentions admin and the discussion's author: both get a mention, no reply row.
    c1 = SimpleNamespace(id=1, content="hey @admin and @regular, also @ghost", comment_uuid="comment_1")
    await fn.notify_discussion_comment(db, community=COMMUNITY, discussion=discussion, comment=c1, author_id=3)
    mentions = await _rows(db, "discussion_mention")
    assert sorted(r.user_id for r in mentions) == [admin_user.id, regular_user.id]
    assert mentions[0].data["params"] == {"actor": "Carol", "discussion": "Hello"}
    assert mentions[0].data["path"] == "/community/c/discussion/d"
    assert await _rows(db, "discussion_reply") == []

    # Plain replies reach the author and collapse per discussion.
    for i in (2, 3):
        c = SimpleNamespace(id=i, content="nice", comment_uuid=f"comment_{i}")
        await fn.notify_discussion_comment(db, community=COMMUNITY, discussion=discussion, comment=c, author_id=3)
    (reply,) = await _rows(db, "discussion_reply")
    assert reply.user_id == regular_user.id and reply.count == 2 and reply.actor_id == 3

    # The author replying in their own thread hears nothing.
    c4 = SimpleNamespace(id=4, content="thanks", comment_uuid="comment_4")
    await fn.notify_discussion_comment(db, community=COMMUNITY, discussion=discussion, comment=c4,
                                       author_id=regular_user.id)
    assert (await _rows(db, "discussion_reply"))[0].count == 2


async def test_discussion_posted_mentions(db, org, admin_user, regular_user, other_org, community):
    COMMUNITY = community
    await fn.notify_discussion_posted(db, community=COMMUNITY,
                                      discussion=_discussion(org, admin_user.id, content="ping @Regular"),
                                      author_id=admin_user.id)
    (row,) = await _rows(db, "discussion_mention")
    assert row.user_id == regular_user.id and row.title == "Admin User mentioned you in Hello"

    # No handle, or only the author's own: nothing.
    assert await fn.notify_discussion_posted(db, community=COMMUNITY,
                                             discussion=_discussion(org, admin_user.id, content=None),
                                             author_id=admin_user.id) == []


async def test_mentions_respect_community_visibility(db, org, admin_user, regular_user, community):
    """A restricted community (linked to a group): a mentioned member outside
    the group is not told; a group member and the org admin are."""
    from src.db.usergroup_resources import UserGroupResource

    await _member(db, org, 3, "carol")
    community.public = False
    db.add(community)
    group = UserGroup(name="G", org_id=org.id, usergroup_uuid="usergroup_g", description="",
                      creation_date=_now(), update_date=_now())
    db.add(group)
    await db.commit()
    await db.refresh(group)
    db.add(UserGroupResource(usergroup_id=group.id, resource_uuid=community.community_uuid, org_id=org.id,
                             creation_date=_now(), update_date=_now()))
    db.add(UserGroupUser(usergroup_id=group.id, user_id=3, org_id=org.id, creation_date=_now(), update_date=_now()))
    await db.commit()
    readers = await fn.community_readers(db, community, [admin_user.id, regular_user.id, 3])
    assert readers == [admin_user.id, 3]
    assert await fn.community_readers(db, community, []) == []
    await fn.notify_discussion_posted(db, community=community,
                                      discussion=_discussion(org, 3, content="@regular @admin"), author_id=3)
    assert [r.user_id for r in await _rows(db, "discussion_mention")] == [admin_user.id]


async def test_create_comment_and_discussion_call_hooks(db, org, admin_user, regular_user, community):
    from src.services.communities import comments as comments_svc, discussions as discussions_svc

    request = MagicMock()
    with patch.object(discussions_svc, "check_resource_access", AsyncMock()), \
         patch.object(discussions_svc, "require_ee_resource_paid_access", AsyncMock()), \
         patch.object(discussions_svc, "require_community_participant", AsyncMock(return_value=admin_user.id)), \
         patch.object(discussions_svc, "enforce_posting_limits", AsyncMock()), \
         patch.object(discussions_svc, "validate_discussion_content", AsyncMock()), \
         patch.object(discussions_svc, "track", AsyncMock()), \
         patch.object(discussions_svc, "dispatch_webhooks", AsyncMock()):
        d = await discussions_svc.create_discussion(request, "community_c", "Hi", "yo @regular", "general",
                                                    admin_user, db)
    with patch.object(comments_svc, "check_resource_access", AsyncMock()), \
         patch.object(comments_svc, "require_ee_resource_paid_access", AsyncMock()), \
         patch.object(comments_svc, "require_community_participant", AsyncMock(return_value=regular_user.id)), \
         patch.object(comments_svc, "validate_comment_content", AsyncMock()), \
         patch.object(comments_svc, "enforce_auto_lock", AsyncMock()), \
         patch.object(comments_svc, "track", AsyncMock()), \
         patch.object(comments_svc, "dispatch_webhooks", AsyncMock()):
        await comments_svc.create_comment(request, d.discussion_uuid, "answer", regular_user, db)
    assert [r.user_id for r in await _rows(db, "discussion_mention")] == [regular_user.id]
    assert [r.user_id for r in await _rows(db, "discussion_reply")] == [admin_user.id]


# ---------------------------------------------------------------------------
# Editor comments
# ---------------------------------------------------------------------------


async def _thread(db, org, activity, created_by):
    thread = ActivityCommentThread(thread_uuid="thread_t", activity_id=activity.id, org_id=org.id,
                                   created_by=created_by, created_at=_now(), updated_at=_now())
    db.add(thread)
    await db.commit()
    await db.refresh(thread)
    return thread


async def test_editor_comment_new_thread_reaches_course_authors(db, org, admin_user, regular_user, course, activity):
    await _member(db, org, 3, "carol")
    await _author(db, course, admin_user.id)
    await _author(db, course, 3, ResourceAuthorshipEnum.CONTRIBUTOR)
    thread = await _thread(db, org, activity, regular_user.id)

    await fn.notify_editor_comment(db, course=course, activity=activity, thread=thread, author_id=regular_user.id,
                                   body="look @carol", mention_ids=[3], new_thread=True)
    (mention,) = await _rows(db, "editor_mention")
    assert mention.user_id == 3
    assert mention.data["params"] == {"actor": "Regular User", "activity": "Test Activity"}
    assert mention.data["path"] == "/course/test/activity/test/edit?thread=thread_t"
    (comment,) = await _rows(db, "editor_comment")
    assert comment.user_id == admin_user.id  # carol got the mention instead; the author nothing


async def test_editor_comment_reply_reaches_thread_and_mentions_only_on_edit(
    db, org, admin_user, regular_user, course, activity
):
    await _member(db, org, 3, "carol")
    thread = await _thread(db, org, activity, admin_user.id)
    db.add(ActivityComment(comment_uuid="comment_a", thread_id=thread.id, author_id=3, body="x"))
    db.add(ActivityComment(comment_uuid="comment_b", thread_id=thread.id, author_id=99, body="", deleted=True))
    await db.commit()

    for _ in range(2):
        await fn.notify_editor_comment(db, course=course, activity=activity, thread=thread,
                                       author_id=regular_user.id, body="reply", mention_ids=[])
    rows = await _rows(db, "editor_comment")
    assert sorted(r.user_id for r in rows) == [admin_user.id, 3]
    assert all(r.count == 2 for r in rows)

    await fn.notify_editor_comment(db, course=course, activity=activity, thread=thread, author_id=regular_user.id,
                                   body="@admin", mention_ids=[admin_user.id], mentions_only=True)
    assert [r.user_id for r in await _rows(db, "editor_mention")] == [admin_user.id]
    assert len(await _rows(db, "editor_comment")) == 2


async def test_activity_comment_endpoints_call_inbox_hook(db, org, admin_user, course, activity):
    from src.db.courses.activity_comments import CommentCreate, CommentUpdate, ThreadCreate
    from src.services.courses.activities import comments as svc

    request = MagicMock()
    with patch.object(svc, "check_resource_access", AsyncMock()), \
         patch.object(svc, "_check_write_rate", MagicMock()), \
         patch("src.services.feature_notifications.notify_editor_comment", AsyncMock()) as hook:
        t = await svc.create_thread(request, "activity_test", ThreadCreate(body="first", quote="q"), admin_user, db)
        await svc.reply(request, "activity_test", t.thread_uuid, CommentCreate(body="second"), admin_user, db)
        await svc.edit_comment(request, "activity_test", t.thread_uuid, t.comments[0].comment_uuid,
                               CommentUpdate(body="first!"), admin_user, db)
    kinds = [c.kwargs for c in hook.await_args_list]
    assert kinds[0]["new_thread"] is True
    assert "new_thread" not in kinds[1] and "mentions_only" not in kinds[1]
    assert kinds[2]["mentions_only"] is True


# ---------------------------------------------------------------------------
# User groups
# ---------------------------------------------------------------------------


async def _group(db, org, **kw):
    g = UserGroup(name="Cohort A", description="", org_id=org.id, usergroup_uuid="usergroup_g",
                  creation_date=_now(), update_date=_now(), **kw)
    db.add(g)
    await db.commit()
    await db.refresh(g)
    return g


async def test_group_access_expiring_warns_once_per_membership(db, org, admin_user, regular_user):
    await _member(db, org, 3, "carol")
    group = await _group(db, org)
    now = datetime.now(timezone.utc)
    db.add(UserGroupUser(usergroup_id=group.id, user_id=regular_user.id, org_id=org.id,
                         expires_at=now + timedelta(days=1)))
    db.add(UserGroupUser(usergroup_id=group.id, user_id=admin_user.id, org_id=org.id,
                         expires_at=now + timedelta(days=10)))
    db.add(UserGroupUser(usergroup_id=group.id, user_id=3, org_id=org.id, expires_at=now - timedelta(hours=1)))
    await db.commit()

    assert await fn.warn_group_access_expiring(db, now) == 1
    assert await fn.warn_group_access_expiring(db, now) == 0
    (row,) = await _rows(db, "group_access_expiring")
    assert row.user_id == regular_user.id and row.priority == "important"
    assert row.data["params"] == {"group": "Cohort A"} and row.data["path"] == "/groups/g"


async def test_sync_all_runs_expiring_warning(db):
    from src.services.usergroups import sync

    with patch("src.services.feature_notifications.warn_group_access_expiring", AsyncMock()) as warn:
        await sync.sync_all(db)
    warn.assert_awaited_once()


async def test_group_join_and_announcement_carry_group_param(db, org, admin_user, regular_user):
    from src.services.usergroups.membership import notify_members

    group = await _group(db, org, settings={"notify_on_join": True})
    await notify_members(db, group, [regular_user.id], "joined")
    (row,) = await _rows(db, "group_joined")
    assert row.data["params"] == {"group": "Cohort A"}


# ---------------------------------------------------------------------------
# Org members
# ---------------------------------------------------------------------------


async def test_member_joined_reaches_admins_and_collapses(db, org, admin_user, regular_user):
    await _member(db, org, 3, "carol")
    carol = await db.get(User, 3)
    await fn.notify_member_joined(db, org.id, carol)
    await fn.notify_member_joined(db, org.id, await db.get(User, regular_user.id))
    (row,) = await _rows(db, "member_joined")
    assert row.user_id == admin_user.id and row.audience == "admin" and row.count == 2
    assert row.data["params"] == {"actor": "Regular User"} and row.data["path"] == fn.USERS_PATH

    # The new member never hears about themselves.
    await fn.notify_member_joined(db, org.id, await db.get(User, admin_user.id))
    assert (await _rows(db, "member_joined"))[0].count == 2


async def test_join_notification_hook(db, org, admin_user, regular_user):
    from src.services.orgs.join_notifications import notify_user_joined_org

    with patch("src.services.usergroups.sync.on_member_event"), \
         patch("src.services.feature_notifications.notify_member_joined", AsyncMock()) as hook, \
         patch("src.services.users.emails.send_org_join_email"):
        user = await db.get(User, regular_user.id)
        await notify_user_joined_org(MagicMock(), db, user, org.id)
        await notify_user_joined_org(MagicMock(), db, None, org.id)
    hook.assert_awaited_once()


# ---------------------------------------------------------------------------
# Plan usage
# ---------------------------------------------------------------------------


async def test_plan_limit_near_and_ai_credits_low_dedupe_per_day(db, org, admin_user, regular_user):
    await fn.notify_plan_limit_near(db, org.id, "members", 9, 10)
    await fn.notify_plan_limit_near(db, org.id, "members", 10, 10)
    (row,) = await _rows(db, "plan_limit_near")
    assert row.user_id == admin_user.id and row.data["params"] == {"limit": "members"}
    assert row.data["path"] == fn.PLAN_PATH and row.priority == "important"

    await fn.notify_ai_credits_low(db, org.id, -2, 100)
    await fn.notify_ai_credits_low(db, org.id, 5, 100)
    (row,) = await _rows(db, "ai_credits_low")
    assert row.data["params"] == {"remaining": 0} and row.audience == "admin"


async def _saas_config(db, org):
    db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "plan": "free"}))
    await db.commit()


async def test_warn_if_near_limit(db, org, admin_user, regular_user):
    await _saas_config(db, org)
    hook = AsyncMock()
    resolve = "src.security.features_utils.resolve.resolve_feature"
    with patch.object(usage, "_is_non_saas", return_value=False), \
         patch("src.services.feature_notifications.notify_plan_limit_near", hook):
        with patch(resolve, return_value={"enabled": True, "limit": 2}):
            await usage._warn_if_near_limit("members", org.id, db)  # 2 of 2
        hook.assert_awaited_once_with(db, org.id, "members", 2, 2)
        hook.reset_mock()
        with patch(resolve, return_value={"enabled": True, "limit": 10}):
            await usage._warn_if_near_limit("members", org.id, db)  # 2 of 10
        with patch(resolve, return_value={"enabled": True, "limit": 0}):
            await usage._warn_if_near_limit("members", org.id, db)  # unlimited
        with patch(resolve, return_value={"enabled": False, "limit": 2}):
            await usage._warn_if_near_limit("members", org.id, db)
        with patch(resolve, side_effect=RuntimeError("boom")):
            await usage._warn_if_near_limit("members", org.id, db)  # swallowed
        await usage._warn_if_near_limit("ai", org.id, db)  # not count-limited
        await usage._warn_if_near_limit("members", 999, db)  # no config
    hook.assert_not_awaited()

    with patch("src.services.feature_notifications.notify_plan_limit_near", hook):
        await usage._warn_if_near_limit("members", org.id, db)  # self-hosted: no limits
    hook.assert_not_awaited()


async def test_increase_feature_usage_checks_limit(db, org):
    redis = MagicMock()
    redis.get.return_value = b"1"
    with patch.object(usage, "_warn_if_near_limit", AsyncMock()) as warn, \
         patch.object(usage, "log_usage_event", AsyncMock()), \
         patch.object(usage, "_get_redis_client", return_value=redis):
        await usage.increase_feature_usage("members", org.id, db)
        await usage.increase_feature_usage("usergroups", org.id, db)
    assert [c.args[0] for c in warn.await_args_list] == ["members", "usergroups"]


async def test_warn_if_ai_credits_low():
    redis = MagicMock()
    redis.get.return_value = b"0"
    with patch("src.services.feature_notifications.notify_ai_credits_low", AsyncMock()) as hook:
        # 100 credits, 85 -> 95 used: crosses below 10 left.
        await usage._warn_if_ai_credits_low(redis, 1, "db", 100, 0, 95, 10)
        hook.assert_awaited_once_with("db", 1, 5, 100)
        hook.reset_mock()
        await usage._warn_if_ai_credits_low(redis, 1, "db", 100, 0, 50, 10)  # plenty left
        await usage._warn_if_ai_credits_low(redis, 1, "db", 100, 0, 97, 1)  # was already low
        await usage._warn_if_ai_credits_low(redis, 1, "db", 0, 0, 0, 1)  # no credits at all
        redis.get.side_effect = RuntimeError("redis down")
        await usage._warn_if_ai_credits_low(redis, 1, "db", 100, 0, 95, 10)  # swallowed
    hook.assert_not_awaited()


async def test_reserve_ai_credit_runs_low_check():
    redis = MagicMock()
    redis.register_script.return_value = lambda keys, args: 9
    with patch.object(usage, "_get_redis_client", return_value=redis), \
         patch.object(usage, "_is_non_saas", return_value=False), \
         patch.object(usage, "_load_org_config_for_ai", AsyncMock(return_value=MagicMock(config={"plan": "pro"}))), \
         patch.object(usage, "_get_org_plan", return_value="pro"), \
         patch.object(usage, "get_ai_credit_limit", return_value=10), \
         patch.object(usage, "_enforce_demo_visitor_ai_cap", AsyncMock()), \
         patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 10}), \
         patch.object(usage, "_warn_if_ai_credits_low", AsyncMock()) as warn:
        assert await usage.reserve_ai_credit(1, "db", amount=2) == 9
    warn.assert_awaited_once_with(redis, 1, "db", 10, 0, 9, 2)


# ---------------------------------------------------------------------------
# Failures never reach the feature
# ---------------------------------------------------------------------------


async def test_emitters_never_raise(db, org, regular_user):
    boom = AsyncMock(side_effect=RuntimeError("boom"))
    with patch("src.services.notifications.emit.emit", boom), \
         patch("src.services.notifications.emit.emit_admin", boom):
        assert await fn.notify_path_completed(db, SimpleNamespace(id=1, org_id=1, name="P", path_uuid="path_p"), 2) == []
        assert await fn.notify_member_joined(db, org.id, await db.get(User, regular_user.id)) == []
        assert await fn.notify_ai_credits_low(db, org.id, 1, 10) == []
    assert await _rows(db) == []


async def test_path_completion_survives_a_broken_emitter(db, org, regular_user):
    from src.services.paths import paths as svc

    path = SimpleNamespace(id=1, org_id=org.id, name="P", path_uuid="path_p", published=True, certificate_enabled=False)
    enrollment = SimpleNamespace(completed_at=None)
    with patch.object(svc, "_load_path_courses", AsyncMock(return_value=[])), \
         patch.object(svc, "_completed_course_ids", AsyncMock(return_value=set())), \
         patch.object(svc, "_summarize", return_value={"complete": True}), \
         patch.object(svc, "track", AsyncMock()), patch.object(svc, "dispatch_webhooks", AsyncMock()), \
         patch("src.services.notifications.emit.emit", AsyncMock(side_effect=RuntimeError("boom"))):
        fake_db = MagicMock()
        fake_db.commit = AsyncMock()
        first = MagicMock()
        first.scalars.return_value.first.return_value = enrollment
        user = MagicMock()
        user.scalars.return_value.first.return_value = None
        cert = MagicMock()
        cert.scalars.return_value.first.return_value = None
        fake_db.execute = AsyncMock(side_effect=[first, user, cert])
        assert await svc.check_path_completion(None, path, regular_user.id, fake_db) is True
    assert enrollment.completed_at
