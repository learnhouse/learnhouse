"""Tests for src/services/nudges/catalog.py.

Predicates are pure functions of one snapshot, so the whole catalog is testable
without touching a database.
"""

from datetime import datetime, timedelta, timezone

import pytest

from src.security.features_utils.plans import PLAN_HIERARCHY, PLAN_LIMITS
from src.services.nudges.catalog import (
    CATALOG_BY_ID,
    NUDGE_CATALOG,
    ai_credit_limit,
    ai_credits_nearly_spent,
    at_resource_limit,
    get_spec,
    matching_specs,
    near_resource_limit,
    next_plan,
    plan_limit,
)
from src.services.nudges.snapshot import OrgSnapshot

NOW = datetime(2026, 7, 28, 12, 0, 0, tzinfo=timezone.utc)


def snap(**kwargs) -> OrgSnapshot:
    """A snapshot with sane defaults; override only what a test cares about."""
    base = dict(
        org_id=1,
        org_slug="acme",
        org_name="Acme",
        plan="free",
        lang="en",
        now=NOW,
        # Far enough back that nothing counts as "recently active" unless the
        # test says so.
        created_at=NOW - timedelta(days=400),
        org_updated_at=NOW - timedelta(days=400),
    )
    base.update(kwargs)
    return OrgSnapshot(**base)


def ago(days: float) -> datetime:
    return NOW - timedelta(days=days)


class TestCatalogIntegrity:
    def test_ids_are_unique(self):
        ids = [s.id for s in NUDGE_CATALOG]
        assert len(ids) == len(set(ids))

    def test_lookup_matches_the_tuple(self):
        assert len(CATALOG_BY_ID) == len(NUDGE_CATALOG)
        for spec in NUDGE_CATALOG:
            assert get_spec(spec.id) is spec

    def test_unknown_id_returns_none(self):
        assert get_spec("nope.does_not_exist") is None

    def test_every_window_is_ordered(self):
        for spec in NUDGE_CATALOG:
            assert spec.day_min <= spec.day_max, spec.id

    def test_every_window_is_at_least_two_days_wide(self):
        """Most anchors come from naive strings written by whichever pod
        handled the request, so they are accurate to roughly a day. A
        single-day window would flip on clock skew alone."""
        for spec in NUDGE_CATALOG:
            assert spec.day_max - spec.day_min >= 1, spec.id

    def test_id_prefix_matches_track(self):
        for spec in NUDGE_CATALOG:
            assert spec.id.startswith(f"{spec.track}."), spec.id

    def test_every_spec_has_english_copy(self):
        from src.services.email.translations import EMAIL_TRANSLATIONS

        english = EMAIL_TRANSLATIONS["en"]
        for spec in NUDGE_CATALOG:
            for part in ("subject", "heading", "body"):
                key = f"nudge.{spec.id}.{part}"
                assert key in english, f"missing copy: {key}"
                assert english[key] != key

    def test_cta_specs_have_a_button_label(self):
        from src.services.email.translations import EMAIL_TRANSLATIONS

        english = EMAIL_TRANSLATIONS["en"]
        for spec in NUDGE_CATALOG:
            if spec.has_cta:
                assert f"nudge.{spec.id}.cta" in english, spec.id


class TestPlanHelpers:
    def test_limits_are_read_from_the_plan_config(self):
        for plan in PLAN_HIERARCHY:
            assert plan_limit(plan, "courses") == PLAN_LIMITS[plan]["courses"]
            assert plan_limit(plan, "members") == PLAN_LIMITS[plan]["members"]

    def test_member_limits_are_not_monotonic(self):
        """The reason no threshold may be hardcoded: the free tier allows more
        members than the first paid tier."""
        assert plan_limit("free", "members") > plan_limit("personal", "members")

    def test_unknown_plan_falls_back_to_free(self):
        assert plan_limit("nonsense", "courses") == PLAN_LIMITS["free"]["courses"]

    def test_next_plan_walks_the_hierarchy(self):
        assert next_plan("free") == "personal"
        assert next_plan(PLAN_HIERARCHY[-2]) == PLAN_HIERARCHY[-1]

    def test_next_plan_at_the_top_is_none(self):
        assert next_plan(PLAN_HIERARCHY[-1]) is None

    def test_next_plan_for_an_unknown_plan_does_not_raise(self):
        assert next_plan("nonsense") == PLAN_HIERARCHY[1]

    def test_zero_limit_means_unlimited_and_never_fires(self):
        """0 encodes "unlimited". Treating it as a cap would nudge every paid
        org that it had run out of an allowance it does not have."""
        s = snap(plan="pro")
        assert plan_limit("pro", "courses") == 0
        assert at_resource_limit(s, "courses", 9999) is False
        assert near_resource_limit(s, "courses", 9999) is False

    def test_at_limit_fires_on_a_real_cap(self):
        s = snap(plan="free")
        assert at_resource_limit(s, "courses", plan_limit("free", "courses")) is True
        assert at_resource_limit(s, "courses", 0) is False

    def test_near_limit_fires_only_in_the_approach(self):
        s = snap(plan="free")
        limit = plan_limit("free", "members")  # 10
        assert near_resource_limit(s, "members", int(limit * 0.8)) is True
        assert near_resource_limit(s, "members", 1) is False
        # At the cap it is no longer "near" — the at-limit nudge owns that.
        assert near_resource_limit(s, "members", limit) is False


class TestActivationFirstCourse:
    SPEC = "activation.first_course_d1"

    def test_fires_for_a_new_org_with_no_course(self):
        s = snap(created_at=ago(1.5), org_updated_at=ago(1.5))
        assert get_spec(self.SPEC).matches(s) is True

    def test_does_not_fire_once_a_course_exists(self):
        s = snap(created_at=ago(1.5), org_updated_at=ago(1.5), course_count=1)
        assert get_spec(self.SPEC).matches(s) is False

    @pytest.mark.parametrize("age", [0.5, 3.0])
    def test_does_not_fire_outside_the_window(self, age):
        s = snap(created_at=ago(age), org_updated_at=ago(age))
        assert get_spec(self.SPEC).matches(s) is False

    def test_does_not_fire_for_a_long_dormant_org(self):
        """The backfill guarantee: switching this on must not mail years of
        history a day-one activation email."""
        s = snap(created_at=ago(400), org_updated_at=ago(400))
        assert get_spec(self.SPEC).matches(s) is False

    def test_unparseable_creation_date_never_fires(self):
        s = snap(created_at=None, org_updated_at=None)
        assert get_spec(self.SPEC).matches(s) is False


class TestContentCourseDraft:
    SPEC = "content.course_draft_d3"

    def test_fires_for_a_draft_with_content(self):
        s = snap(
            course_count=1,
            activity_count=2,
            published_course_count=0,
            last_course_updated_at=ago(4),
        )
        assert get_spec(self.SPEC).matches(s) is True

    def test_does_not_fire_once_published(self):
        s = snap(
            course_count=1,
            activity_count=2,
            published_course_count=1,
            last_course_updated_at=ago(4),
        )
        assert get_spec(self.SPEC).matches(s) is False

    def test_does_not_fire_for_an_empty_course(self):
        """Nothing to publish yet — that is the content track's job, not this."""
        s = snap(course_count=1, activity_count=0, last_course_updated_at=ago(4))
        assert get_spec(self.SPEC).matches(s) is False

    def test_links_to_the_draft_course(self):
        s = snap(
            course_count=1,
            activity_count=1,
            last_course_updated_at=ago(4),
            oldest_draft_course_uuid="course_abc",
        )
        url = get_spec(self.SPEC).cta(s, "https://acme.test")
        assert url == "https://acme.test/dash/courses/course/abc/general"


class TestAudiencePublishedNoMembers:
    SPEC = "audience.published_no_members_d1"

    def test_fires_when_published_with_nobody_to_read_it(self):
        s = snap(published_course_count=1, member_count=0, first_published_at=ago(4))
        assert get_spec(self.SPEC).matches(s) is True

    def test_does_not_fire_immediately_after_publishing(self):
        """The milestone email already congratulates them on publishing and
        points at inviting. This is the follow-up, not a duplicate."""
        s = snap(
            published_course_count=1,
            member_count=0,
            first_published_at=ago(1),
            last_course_updated_at=ago(1),
        )
        assert get_spec(self.SPEC).matches(s) is False

    def test_does_not_fire_once_someone_has_joined(self):
        s = snap(published_course_count=1, member_count=1, first_published_at=ago(4))
        assert get_spec(self.SPEC).matches(s) is False

    def test_does_not_fire_before_anything_is_published(self):
        s = snap(published_course_count=0, member_count=0, first_published_at=None)
        assert get_spec(self.SPEC).matches(s) is False


class TestMonetizationCourseLimit:
    SPEC = "monetization.course_limit_d1"

    def test_fires_at_the_free_course_cap(self):
        s = snap(
            plan="free",
            course_count=plan_limit("free", "courses"),
            last_course_created_at=ago(2),
        )
        assert get_spec(self.SPEC).matches(s) is True

    def test_does_not_fire_on_a_plan_with_unlimited_courses(self):
        s = snap(plan="pro", course_count=500, last_course_created_at=ago(2))
        assert get_spec(self.SPEC).matches(s) is False

    def test_does_not_fire_at_the_top_of_the_hierarchy(self):
        s = snap(
            plan=PLAN_HIERARCHY[-1], course_count=9999, last_course_created_at=ago(2)
        )
        assert get_spec(self.SPEC).matches(s) is False

    def test_is_not_suppressed_by_recent_activity(self):
        """They hit the wall *while* working — suppressing on activity would
        mean this never fires at all."""
        s = snap(
            plan="free",
            course_count=plan_limit("free", "courses"),
            last_course_created_at=ago(2),
            last_activity_created_at=ago(0.1),
        )
        assert s.org_active is True
        assert get_spec(self.SPEC).matches(s) is True


class TestDormancy:
    SPEC = "dormancy.no_login_30d"

    def test_fires_for_a_dormant_org_with_content(self):
        s = snap(course_count=1, created_at=ago(200), org_updated_at=ago(32))
        assert get_spec(self.SPEC).matches(s) is True

    def test_does_not_fire_for_an_empty_org(self):
        """Nothing to come back to — activation owns that case."""
        s = snap(course_count=0, activity_count=0, org_updated_at=ago(32))
        assert get_spec(self.SPEC).matches(s) is False

    def test_does_not_fire_outside_the_window(self):
        s = snap(course_count=1, created_at=ago(400), org_updated_at=ago(90))
        assert get_spec(self.SPEC).matches(s) is False

    def test_reaches_organizations_older_than_the_system(self):
        """The dormancy track is deliberately the only route to legacy orgs."""
        s = snap(course_count=1, created_at=ago(900), org_updated_at=ago(31))
        assert get_spec(self.SPEC).matches(s) is True


class TestEngagementVsCreation:
    def test_a_brand_new_org_is_not_active(self):
        """Creating an account is not engagement.

        Counting it would mark every new org active for its first days — the
        exact window the activation emails exist to cover — so they would never
        fire at all.
        """
        s = snap(created_at=ago(1.5), org_updated_at=ago(1.5))
        assert s.last_engagement is None
        assert s.org_active is False

    def test_real_work_makes_an_org_active(self):
        s = snap(created_at=ago(1.5), last_course_created_at=ago(0.1))
        assert s.org_active is True

    def test_last_touch_falls_back_to_org_dates(self):
        """Legacy orgs predate every engagement signal, but dormancy still
        needs something to anchor against."""
        s = snap(created_at=ago(400), org_updated_at=ago(400))
        assert s.last_engagement is None
        assert s.days_since_touch == pytest.approx(400, abs=0.1)


class TestCatalogComposition:
    def test_the_whole_catalog_ships(self):
        assert len(NUDGE_CATALOG) == 34

    def test_track_sizes(self):
        from collections import Counter

        counts = Counter(spec.track for spec in NUDGE_CATALOG)
        assert counts == {
            "activation": 7,
            "content": 7,
            "audience": 5,
            "monetization": 4,
            "dormancy": 4,
            "milestone": 3,
            "reactivation": 4,
        }

    def test_priorities_are_unique_so_ordering_is_deterministic(self):
        priorities = [spec.priority for spec in NUDGE_CATALOG]
        assert len(priorities) == len(set(priorities))

    def test_milestones_outrank_everything(self):
        """Congratulations that arrive late are worthless, so they claim the
        admin's single daily slot ahead of any prompt."""
        milestones = [s.priority for s in NUDGE_CATALOG if s.track == "milestone"]
        others = [s.priority for s in NUDGE_CATALOG if s.track != "milestone"]
        assert max(milestones) < min(others)

    def test_only_winback_tracks_reach_arbitrarily_old_orgs(self):
        """The structural half of the backfill guard: every other track is
        anchored to a recent event with a bounded window, so switching the
        system on cannot reach years of history."""
        for spec in NUDGE_CATALOG:
            if spec.track not in ("dormancy", "reactivation"):
                assert spec.day_max <= 90, spec.id

    def test_only_dormancy_repeats(self):
        for spec in NUDGE_CATALOG:
            if spec.repeat is not None:
                assert spec.track == "dormancy", spec.id


class TestSecondVisitDetection:
    ID = "activation.come_back_d2"

    def test_fires_when_nothing_has_happened_since_signup(self):
        s = snap(created_at=ago(3))
        assert get_spec(self.ID).matches(s) is True

    def test_does_not_fire_once_there_is_real_engagement(self):
        s = snap(created_at=ago(3), last_course_created_at=ago(2.5))
        assert get_spec(self.ID).matches(s) is False

    def test_a_login_a_week_later_counts_as_coming_back(self):
        s = snap(created_at=ago(3), last_admin_login_at=ago(0.5))
        # last_admin_login_at is an engagement signal, so this org is active.
        assert get_spec(self.ID).matches(s) is False

    def test_any_engagement_signal_counts_as_coming_back(self):
        """Including an admin login, which is itself an engagement signal —
        the reason no separate login-timing comparison is needed."""
        from src.services.nudges.catalog import _no_second_visit

        assert _no_second_visit(snap(created_at=ago(3))) is True
        assert _no_second_visit(snap(created_at=ago(3), last_admin_login_at=ago(1))) is False
        assert _no_second_visit(snap(created_at=ago(3), last_member_joined_at=ago(1))) is False


class TestAiCredits:
    from src.services.nudges.catalog import ai_credit_limit as _limit

    def test_fires_when_most_of_a_finite_allowance_is_spent(self):
        limit = ai_credit_limit("free")
        s = snap(plan="free", ai_credits_used=limit, last_activity_created_at=ago(2))
        assert get_spec("monetization.ai_credits_low").matches(s) is True

    def test_does_not_fire_early_in_the_allowance(self):
        s = snap(plan="free", ai_credits_used=1, last_activity_created_at=ago(2))
        assert get_spec("monetization.ai_credits_low").matches(s) is False

    def test_unlimited_allowance_never_warns(self):
        """enterprise is -1 (unlimited); a "running low" email would be a lie."""
        assert ai_credit_limit("enterprise") == -1
        s = snap(
            plan="enterprise", ai_credits_used=999999, last_activity_created_at=ago(2)
        )
        assert ai_credits_nearly_spent(s) is False

    def test_unknown_plan_has_no_allowance_and_never_warns(self):
        s = snap(plan="nonsense", ai_credits_used=999, last_activity_created_at=ago(2))
        assert ai_credits_nearly_spent(s) is False

    def test_missing_redis_reads_as_zero_and_stays_silent(self):
        """Usage comes from a cache that may be down. Fail closed."""
        s = snap(plan="free", ai_credits_used=0, last_activity_created_at=ago(2))
        assert ai_credits_nearly_spent(s) is False


class TestNewContentAndAudienceNudges:
    def test_course_without_chapters(self):
        s = snap(course_count=1, chapter_count=0, last_course_created_at=ago(4))
        assert get_spec("content.course_no_chapter_d1").matches(s) is True

    def test_course_without_chapters_waits_out_the_active_window(self):
        """Nagging someone who created the course yesterday, while they are
        still working on it, is exactly the wrong moment."""
        s = snap(course_count=1, chapter_count=0, last_course_created_at=ago(1))
        assert s.org_active is True
        assert get_spec("content.course_no_chapter_d1").matches(s) is False

    def test_chapters_without_lessons(self):
        s = snap(
            course_count=1,
            chapter_count=2,
            activity_count=0,
            last_chapter_created_at=ago(4),
        )
        assert get_spec("content.chapter_no_activity_d1").matches(s) is True

    def test_lessons_all_unpublished(self):
        s = snap(
            activity_count=3,
            published_activity_count=0,
            last_activity_created_at=ago(4),
        )
        assert get_spec("content.activity_unpublished_d2").matches(s) is True

    def test_thin_course_needs_at_least_one_lesson(self):
        """An empty course belongs to course_no_chapter, not here."""
        empty = snap(course_count=1, activity_count=0, last_course_created_at=ago(6))
        thin = snap(course_count=1, activity_count=2, last_course_created_at=ago(6))
        assert get_spec("content.thin_course_d5").matches(empty) is False
        assert get_spec("content.thin_course_d5").matches(thin) is True

    def test_assignment_without_submissions_needs_an_audience(self):
        """With no members there is nobody to submit — the audience track owns
        that case, and this email would just be confusing."""
        no_members = snap(
            assignment_count=1,
            assignment_submission_count=0,
            member_count=0,
            last_assignment_created_at=ago(6),
        )
        with_members = snap(
            assignment_count=1,
            assignment_submission_count=0,
            member_count=5,
            last_assignment_created_at=ago(6),
        )
        spec = get_spec("content.assignment_no_submissions_d5")
        assert spec.matches(no_members) is False
        assert spec.matches(with_members) is True

    def test_members_who_never_enrolled(self):
        s = snap(member_count=4, trailrun_count=0, first_member_joined_at=ago(4))
        assert get_spec("audience.members_no_enrollment_d3").matches(s) is True

    def test_public_share_needs_both_published_and_public(self):
        spec = get_spec("audience.share_public_page_d14")
        private = snap(
            published_course_count=1,
            public_course_count=0,
            member_count=0,
            first_published_at=ago(15),
        )
        public = snap(
            published_course_count=1,
            public_course_count=1,
            member_count=0,
            first_published_at=ago(15),
        )
        assert spec.matches(private) is False
        assert spec.matches(public) is True

    def test_share_link_points_at_the_public_course_page(self):
        s = snap(
            published_course_count=1,
            public_course_count=1,
            member_count=0,
            first_published_at=ago(15),
            newest_course_uuid="course_xyz",
        )
        url = get_spec("audience.share_public_page_d14").cta(s, "https://acme.test")
        assert url == "https://acme.test/course/xyz"

    def test_stalled_learners(self):
        s = snap(in_progress_trailrun_count=3, last_trailrun_updated_at=ago(16))
        assert get_spec("audience.stalled_learners_d14").matches(s) is True


class TestMilestones:
    def test_first_publish_fires_immediately(self):
        s = snap(published_course_count=1, first_published_at=ago(0.5))
        assert get_spec("milestone.first_course_published").matches(s) is True

    def test_milestones_are_not_suppressed_by_activity(self):
        """The org is active by definition — something just happened."""
        s = snap(
            published_course_count=1,
            first_published_at=ago(0.5),
            last_course_updated_at=ago(0.1),
        )
        assert s.org_active is True
        assert get_spec("milestone.first_course_published").matches(s) is True

    def test_first_learner(self):
        s = snap(trailrun_count=1, first_trailrun_at=ago(1))
        assert get_spec("milestone.first_learner_enrolled").matches(s) is True

    def test_first_completion(self):
        s = snap(
            completed_trailrun_count=1, first_completed_trailrun_at=ago(1)
        )
        assert get_spec("milestone.first_completion").matches(s) is True

    def test_milestones_go_stale(self):
        """Congratulating someone a week late is worse than silence."""
        s = snap(published_course_count=1, first_published_at=ago(6))
        assert get_spec("milestone.first_course_published").matches(s) is False


class TestDormancySequence:
    def test_windows_do_not_overlap(self):
        dormancy = sorted(
            (s for s in NUDGE_CATALOG if s.track == "dormancy"),
            key=lambda s: s.day_min,
        )
        for earlier, later in zip(dormancy, dormancy[1:]):
            assert earlier.day_max < later.day_min

    @pytest.mark.parametrize(
        "days,expected",
        [
            (15, "dormancy.no_login_14d"),
            (32, "dormancy.no_login_30d"),
            (65, "dormancy.no_login_60d"),
            (200, "dormancy.winback_q"),
        ],
    )
    def test_each_stage_fires_in_its_own_window(self, days, expected):
        s = snap(course_count=1, created_at=ago(400), org_updated_at=ago(days))
        matched = [x.id for x in matching_specs(s) if x.track == "dormancy"]
        assert matched == [expected]


class TestMatching:
    def test_active_orgs_are_left_alone(self):
        s = snap(created_at=ago(1.5), last_course_created_at=ago(0.1))
        assert s.org_active is True
        assert [x.id for x in matching_specs(s)] == []

    def test_results_are_ordered_by_priority(self):
        s = snap(
            created_at=ago(1.5),
            org_updated_at=ago(1.5),
            published_course_count=1,
            first_published_at=ago(2),
            member_count=0,
        )
        matched = matching_specs(s)
        priorities = [spec.priority for spec in matched]
        assert priorities == sorted(priorities)

    def test_no_match_for_a_quiet_well_run_org(self):
        s = snap(
            course_count=3,
            published_course_count=3,
            activity_count=10,
            member_count=25,
            trailrun_count=40,
            created_at=ago(200),
            org_updated_at=ago(10),
        )
        assert matching_specs(s) == []
