"""Run every analytics dashboard query on real Postgres, for CI.

The unit tests run on SQLite and mock the query runner, so nothing there
proves the SQL in ``src/services/analytics/queries.py`` is valid Postgres or
counts what it claims to. This script does:

1. Seed a small, deterministic event history (two orgs, signed-in users,
   anonymous visitors, enrollments, completions, time spent, searches,
   signups, certificates, discussions) spread over ~60 days, plus per-feature
   events (video and podcast progress, assessments, community, AI, sign-in
   methods, paths, boards, playgrounds, content creation, nudges, library).
2. Rebuild the summary tables with ``maintenance.refresh_rollups``.
3. Run every catalog query (org, course, course detail, per-user audit and
   superadmin) for one org and for all orgs, through ``store.run_query``.
4. Check known values: visitors count individually in traffic metrics, the
   anonymous ``user_id = 0`` is never reported as a learner, and the
   per-feature queries count what they claim to.

Run from apps/api against a migrated database:

    LEARNHOUSE_SQL_CONNECTION_STRING=postgresql://... \\
    LEARNHOUSE_AUTH_JWT_SECRET_KEY=... python scripts/ci_analytics_queries.py

It deletes and rewrites analytics rows for the seed orgs only (ids 9101-9103).
"""

import asyncio
import os
import sys
import warnings
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
# sqlmodel nags about session.execute(); this script runs plain SQL on purpose.
warnings.filterwarnings("ignore", category=DeprecationWarning)

from sqlalchemy import insert, text  # noqa: E402

ORG_A = 9101
ORG_B = 9102
ORG_EMPTY = 9103
SEED_ORGS = (ORG_A, ORG_B, ORG_EMPTY)

C1, C2, C3 = "course_aq_one", "course_aq_two", "course_aq_three"

NOW = datetime.now(timezone.utc)
MIDNIGHT = datetime.combine(NOW.date(), time(0), tzinfo=timezone.utc)


def day(n: int, hour: int = 12, minute: int = 0) -> datetime:
    """A timestamp on the UTC day n days ago (so day buckets are exact)."""
    return MIDNIGHT - timedelta(days=n) + timedelta(hours=hour, minutes=minute)


def event(name, ts, org=ORG_A, user=0, actor=None, **cols):
    props = cols.pop("props", {})
    row = {
        "ts": ts,
        "org_id": org,
        "event_name": name,
        "source": cols.pop("source", "api"),
        "user_id": user,
        "actor_key": actor if actor is not None else (f"u:{user}" if user else ""),
        "session_id": "",
        "course_uuid": None,
        "activity_uuid": None,
        "path": None,
        "country": None,
        "device": None,
        "referrer_domain": None,
        "seconds_spent": None,
        "properties": props,
    }
    row.update(cols)
    return row


def page_view(ts, user=0, actor=None, country="US", device="desktop", referrer=None, org=ORG_A, path="/home"):
    return event(
        "page_view", ts, org=org, user=user, actor=actor, source="web",
        country=country, device=device, referrer_domain=referrer, path=path,
    )


def seed_events() -> list[dict]:
    rows: list[dict] = []
    add = rows.append

    # Signups.
    for user, n in ((101, 55), (102, 55), (103, 40), (104, 21), (105, 10), (106, 2)):
        add(event("user_signed_up", day(n, 9), user=user, props={"signup_method": "email"}))

    # Signed-in page views (US, desktop).
    for user, days in ((101, (55, 48, 41, 27, 3)), (102, (55, 20)), (103, (40,)), (104, (21,)),
                       (105, (10,)), (106, (2,))):
        for n in days:
            add(page_view(day(n), user=user))

    # Anonymous visitors, three days ago.
    for _ in range(3):
        add(page_view(day(3, 13), actor="v:aaa", country="FR", device="mobile", referrer="google.com"))
    for _ in range(2):
        add(page_view(day(3, 14), actor="v:bbb", country="DE", device="desktop", referrer="twitter.com"))
    add(page_view(day(3, 15), actor="v:ccc", country="FR", device="tablet", referrer="google.com"))

    # Live: one member and one visitor in the last five minutes.
    add(page_view(NOW - timedelta(minutes=1), user=101, path="/course/aq"))
    add(page_view(NOW - timedelta(minutes=1), actor="v:live", country=None, device="mobile"))

    # Course views five days ago: four members and two visitors on C1, one visitor on C2.
    for user in (101, 102, 103, 104):
        add(event("course_view", day(5), user=user, source="web", course_uuid=C1))
    for actor in ("v:d5a", "v:d5b"):
        add(event("course_view", day(5), actor=actor, source="web", course_uuid=C1))
    add(event("course_view", day(5), actor="v:d5c", source="web", course_uuid=C2))

    # Enrollments.
    for user in (101, 102, 103, 104):
        add(event("course_enrolled", day(15, 10), user=user, course_uuid=C1))
    add(event("course_enrolled", day(10, 10), user=105, course_uuid=C1))
    for user in (101, 102):
        add(event("course_enrolled", day(15, 10), user=user, course_uuid=C2))

    # Activity views (members and a visitor).
    for user in (101, 102, 103):
        for act in ("act_1_1", "act_1_2"):
            add(event("activity_view", day(14, 11), user=user, source="web", course_uuid=C1,
                      activity_uuid=act, props={"activity_type": "TYPE_VIDEO"}))
    add(event("activity_view", day(14, 11), actor="v:d14a", source="web", course_uuid=C1,
              activity_uuid="act_1_1", props={"activity_type": "TYPE_VIDEO"}))

    # Activity completions.
    for user, act, ts, kind in (
        (101, "act_1_1", day(14, 12), "TYPE_VIDEO"),
        (101, "act_1_2", day(14, 15), "TYPE_VIDEO"),
        (101, "act_1_3", day(13, 12), "TYPE_DYNAMIC"),
        (101, "act_1_4", day(12, 12), "TYPE_DYNAMIC"),
        (102, "act_1_1", day(14, 12), "TYPE_VIDEO"),
        (102, "act_1_2", day(13, 12), "TYPE_VIDEO"),
        (103, "act_1_1", day(14, 12), "TYPE_VIDEO"),
    ):
        add(event("activity_completed", ts, user=user, course_uuid=C1, activity_uuid=act,
                  props={"activity_type": kind}))
    # A malformed server event without a user: must never show up as a learner.
    add(event("activity_completed", day(14, 12), user=0, actor="", course_uuid=C1,
              activity_uuid="act_1_1", props={"activity_type": "TYPE_VIDEO"}))

    # Course completions, certificates, discussion.
    add(event("course_completed", day(5, 10), user=101, course_uuid=C1))
    add(event("course_completed", day(10, 10), user=102, course_uuid=C2))
    add(event("certificate_claimed", day(5, 11), user=101, course_uuid=C1))
    add(event("discussion_posted", day(6), user=101, props={"community_uuid": "community_aq"}))

    # Time on activity.
    for user, act, seconds in ((101, "act_1_1", 300), (101, "act_1_2", 600), (102, "act_1_1", 120)):
        add(event("time_on_activity", day(14, 16), user=user, source="web", course_uuid=C1,
                  activity_uuid=act, seconds_spent=seconds, props={"activity_type": "TYPE_VIDEO"}))

    # Searches.
    add(event("search_query", day(4), user=101, source="web", props={"query": "python", "results_count": 5}))
    add(event("search_query", day(4), user=101, source="web", props={"query": "rust", "results_count": 0}))
    add(event("search_query", day(4), actor="v:d4a", source="web", props={"query": "python", "results_count": 3}))
    add(event("search_query", day(4), actor="v:d4a", source="web", props={"query": "go"}))

    # Org B: one member and one visitor.
    add(event("user_signed_up", day(30, 9), org=ORG_B, user=201))
    add(page_view(day(30), org=ORG_B, user=201))
    add(event("course_enrolled", day(30, 10), org=ORG_B, user=201, course_uuid=C3))
    add(page_view(day(3), org=ORG_B, actor="v:b1", country="GB"))
    return rows


VID = "course_aq_vid"


def seed_feature_events() -> list[dict]:
    """Per-feature events (FEATURE_QUERIES). Only users 101-106 and visitors,
    never on day 3 and never a course_view/enrollment, so the core checks
    above keep their numbers."""
    rows: list[dict] = []
    add = rows.append

    def web(name, ts, user=0, actor=None, org=ORG_A, **cols):
        add(event(name, ts, org=org, user=user, actor=actor, source="web", **cols))

    def api(name, ts, user, org=ORG_A, **props):
        add(event(name, ts, org=org, user=user, props=props))

    # Video: act_vid_1 reached 25% by 101/102/103, 50% by 101/102, 75% and 100% by 101.
    for user, percents in ((101, (25, 50, 75, 100)), (102, (25, 50)), (103, (30,)), (104, ("abc",))):
        for pct in percents:
            web("video_progress", day(12), user=user, course_uuid=VID, activity_uuid="act_vid_1",
                props={"percent": pct, "activity_type": "TYPE_VIDEO"})
    web("video_progress", day(12), user=101, course_uuid=VID, activity_uuid="act_vid_2", props={"percent": 10})
    web("video_progress", day(12), org=ORG_B, user=201, course_uuid=VID, activity_uuid="act_vid_1",
        props={"percent": 100})

    # Podcast: episode_aq_1 played by 101 (twice), 102 and a visitor; 101 reached 100%, 102 60%.
    ep1 = {"podcast_uuid": "podcast_aq", "episode_uuid": "episode_aq_1"}
    for user, actor in ((101, None), (101, None), (102, None), (0, "v:pod1")):
        web("podcast_episode_played", day(7), user=user, actor=actor, props=ep1)
    for user, actor, pct in ((101, None, 50), (101, None, 100), (102, None, 60), (0, "v:pod1", 20)):
        web("podcast_episode_progress", day(7), user=user, actor=actor, props={**ep1, "percent": pct})
    web("podcast_episode_played", day(7), user=101, props={"podcast_uuid": "podcast_aq", "episode_uuid": "episode_aq_2"})

    # Assessments (day 8).
    for user in (101, 102, 103):
        api("assignment_submitted", day(8, 10), user, assignment_uuid="assignment_aq", attempt=1)
    api("assignment_graded", day(8, 11), 101, assignment_uuid="assignment_aq", grade=8, max_grade=10, passed=True)
    api("assignment_graded", day(8, 11), 102, assignment_uuid="assignment_aq", grade=4, max_grade=10, passed=False)
    api("assignment_graded", day(8, 11), 103, assignment_uuid="assignment_aq", grade=0, max_grade=0, passed=False)
    api("quiz_submitted", day(8, 12), 101, score=9, max_score=10, passed=True)
    api("quiz_submitted", day(8, 12), 102, score=5, max_score=10, passed=False)
    api("code_submitted", day(8, 13), 101, language="python", tests_passed=3, tests_total=3, passed=True)
    api("code_submitted", day(8, 13), 105, language="python", tests_passed=1, tests_total=4, passed=False)

    # Community (day 6; the core seed already has 101's discussion in community_aq).
    aq = {"community_uuid": "community_aq", "discussion_uuid": "discussion_aq"}
    for user in (102, 106):
        api("comment_posted", day(6, 13), user, **aq)
    api("reaction_added", day(6, 13), 104, reaction="like", **aq)
    api("discussion_upvoted", day(6, 13), 105, **aq)
    api("comment_upvoted", day(6, 13), 101, **aq)
    api("comment_posted", day(6, 14), 103, community_uuid="community_two", discussion_uuid="discussion_two")
    for user, actor in ((101, None), (102, None), (0, "v:com1"), (0, "v:com1")):
        web("community_viewed", day(6), user=user, actor=actor, props={"community_uuid": "community_aq"})
    web("community_viewed", day(6), actor="v:com2", props={"community_uuid": "community_two"})

    # AI (day 11; 104 opens the assistant on day 18).
    for user in (101, 102):
        web("ai_assistant_opened", day(11), user=user, props={"surface": "course"})
    web("ai_assistant_opened", day(18), user=104, props={"surface": "course"})
    for user in (101, 101, 102):
        api("ai_message_sent", day(11, 13), user, surface="course", model="m")
    api("ai_message_sent", day(11, 13), 103, model="m")
    api("ai_message_sent", day(11, 13), 201, org=ORG_B, surface="course", model="m")

    # Acquisition (the core seed has the email signups).
    api("user_joined_org", day(21, 10), 104, join_method="invite")
    api("user_joined_org", day(10, 9), 105, join_method="")
    api("user_logged_in", day(9, 8), 101, login_method="password")
    api("user_logged_in", day(9, 9), 101, login_method="password")
    api("user_logged_in", day(9, 9), 102, login_method="google")
    api("user_invited", day(9, 10), 101, invite_method="email", count=5)
    api("user_invited", day(9, 10), 102, invite_method="email", count=2)
    api("user_invited", day(9, 10), 101, invite_method="csv")

    # Paths (day 13).
    for user, actor in ((101, None), (102, None), (0, "v:path1"), (0, "v:path1")):
        web("path_viewed", day(13), user=user, actor=actor, props={"path_uuid": "path_aq"})
    web("path_viewed", day(13), actor="v:path2", props={"path_uuid": "path_two"})
    for user in (101, 102, 102):
        api("path_enrolled", day(13, 13), user, path_uuid="path_aq")
    api("path_completed", day(13, 14), 101, path_uuid="path_aq")

    # Boards and playgrounds (day 13): board_aq leads 13 boards; only 10 are listed.
    for user in (101, 101, 101, 102):
        web("board_viewed", day(13), user=user, props={"board_uuid": "board_aq"})
    web("board_viewed", day(13), actor="v:b", props={"board_uuid": "board_two"})
    for n in range(11):
        web("board_viewed", day(13), actor="v:bulk", props={"board_uuid": f"board_bulk_{n:02d}"})
    for user, actor in ((101, None), (0, "v:p"), (0, "v:p")):
        web("playground_viewed", day(13), user=user, actor=actor, props={"playground_uuid": "playground_aq"})

    # Content creation (day 7).
    for _ in range(2):
        api("course_created", day(7, 9), 101, source="editor")
    api("course_published", day(7, 10), 101, published=True)
    api("course_published", day(7, 10), 101, published=False)
    for _ in range(3):
        api("activity_created", day(7, 11), 101, activity_type="TYPE_DYNAMIC")
    api("board_created", day(7, 12), 101, board_uuid="board_aq")
    api("playground_created", day(7, 12), 101, playground_uuid="playground_aq")
    for _ in range(2):
        api("podcast_episode_published", day(7, 13), 101, podcast_uuid="podcast_aq", episode_uuid="episode_aq_1")

    # Nudges: 101 and 103 come back in the browser within a week (103 through
    # the core seed's course view), 105 doesn't (only server events after its
    # nudge); 104 (typed only by id) opens the assistant two days after.
    for user in (101, 103, 105):
        api("nudge_sent", day(9, 12), user, nudge_type="inactive_learner", nudge_id="n1")
    api("nudge_sent", day(20, 12), 104, nudge_id="admin_onboarding")

    # Library (day 6).
    for user, actor in ((101, None), (101, None), (0, "v:lib")):
        web("library_resource_opened", day(6), user=user, actor=actor,
            props={"resource_uuid": "course_lib", "resource_type": "courses"})
    web("library_resource_opened", day(6), user=102, props={"resource_uuid": "media_lib", "resource_type": "media"})

    # Messaging and certificates, for the feature summary.
    api("message_sent", day(6, 15), 101, conversation_uuid="conv_aq", conversation_kind="direct")
    web("certificate_viewed", day(5), actor="v:cert", props={"certificate_uuid": "cert_aq"})

    # Previous 30-day window, for feature_summary's comparison.
    api("ai_message_sent", day(45), 101, surface="course", model="m")
    api("ai_message_sent", day(45), 101, surface="course", model="m")
    web("search_query", day(50), user=101, props={"query": "old", "results_count": 1})
    web("board_viewed", day(40), actor="v:old", props={"board_uuid": "board_aq"})
    return rows


class Checker:
    def __init__(self):
        self.failures: list[str] = []
        self.ran = 0

    def check(self, condition: bool, message: str) -> None:
        if not condition:
            self.failures.append(message)


def rows_for(rows: list[dict], **match) -> list[dict]:
    return [r for r in rows if all(r.get(k) == v for k, v in match.items())]


def one(rows: list[dict], **match) -> dict:
    found = rows_for(rows, **match)
    return found[0] if len(found) == 1 else {}


async def main() -> int:
    from src.core.events.database import _async_session_factory
    from src.db.analytics import AnalyticsEvent
    from src.services.analytics import maintenance, store
    from src.services.analytics.queries import (
        ALL_QUERIES,
        COURSE_DETAIL_QUERIES,
        COURSE_QUERIES,
        FEATURE_QUERIES,
        SUPERADMIN_QUERIES,
        USER_QUERIES,
    )

    seed = seed_events() + seed_feature_events()
    async with _async_session_factory() as db:
        for table in ("analytics_event", "analytics_daily_actor", "analytics_hourly_count"):
            await db.execute(text(f"DELETE FROM {table} WHERE org_id = ANY(:orgs)"), {"orgs": list(SEED_ORGS)})
        await db.execute(insert(AnalyticsEvent.__table__), seed)
        await db.commit()
    await maintenance.refresh_rollups((MIDNIGHT - timedelta(days=70)).date())
    print(f"seeded {len(seed)} events, summaries rebuilt")

    c = Checker()
    results: dict[tuple, list[dict]] = {}

    async def run(label: str, sql: str, params: dict) -> list[dict]:
        c.ran += 1
        try:
            rows = await store.run_query(sql, params)
        except Exception as exc:  # report every broken query, not just the first
            c.failures.append(f"{label} {params}: {type(exc).__name__}: {str(exc).splitlines()[0][:300]}")
            return []
        for row in rows:
            if "user_id" in row:
                c.check(row["user_id"] != 0, f"{label} {params}: reported user_id 0 as a user")
        return rows

    # Every query, for org A, for all orgs (0) and for an org with no data.
    for org in (ORG_A, 0, ORG_EMPTY):
        for name, (sql, default_days) in ALL_QUERIES.items():
            for days in sorted({max(default_days, 1), 30}):
                results[(name, org, days)] = await run(name, sql, {"org_id": org, "days": days})
        for name, (sql, default_days) in {**COURSE_QUERIES, **COURSE_DETAIL_QUERIES}.items():
            for course in (C1, "course_missing"):
                params = {"org_id": org, "days": default_days, "course_uuid": course}
                results[(name, org, course)] = await run(name, sql, params)
        for name, (sql, default_days) in SUPERADMIN_QUERIES.items():
            results[(name, org)] = await run(name, sql, {"org_id": org, "days": default_days})
    for name, (sql, default_days) in USER_QUERIES.items():
        for user in (101, 0):
            results[(name, user)] = await run(name, sql, {"org_id": ORG_A, "user_id": user, "days": default_days})

    # The deprecated Enterprise shim resolves by name and ignores its SQL.
    from src.routers import analytics as router

    router.get_cached_result = lambda *args, **kwargs: None
    router.set_cached_result = lambda *args, **kwargs: None
    shim_rank = await router._execute_tinybird_query("superadmin_org_visits_rank", "SELECT clickhouse()", 0, 30)
    shim_core = await router._execute_tinybird_query("superadmin_top_courses", "ignored", ORG_A, 30)
    shim_unknown = await router._execute_tinybird_query("superadmin_nope", "ignored", 0, 30)
    c.ran += 3

    # ---- known values -------------------------------------------------
    r = results
    d3, d5 = day(3).date().isoformat(), day(5).date().isoformat()

    c.check(rows_for(r[("live_users", ORG_A, 1)], org_id=ORG_A) == [{"org_id": ORG_A, "live_users": 2}],
            f"live_users: member + visitor expected 2, got {r[('live_users', ORG_A, 1)]}")
    c.check([row["user_id"] for row in r[("detail_live_users", ORG_A, 1)]] == [101],
            f"detail_live_users: expected [101], got {r[('detail_live_users', ORG_A, 1)]}")

    dau_d3 = one(r[("daily_active_users", ORG_A, 30)], date=d3)
    c.check(dau_d3.get("dau") == 1, f"daily_active_users: visitors must not count, expected 1 on {d3}, got {dau_d3}")

    top = r[("top_courses", ORG_A, 30)]
    c.check(one(top, course_uuid=C1) == {"org_id": ORG_A, "course_uuid": C1, "views": 6, "enrollments": 5, "completions": 1},
            f"top_courses C1: {one(top, course_uuid=C1)}")
    c.check(one(top, course_uuid=C2).get("views") == 1, f"top_courses C2: {one(top, course_uuid=C2)}")

    funnel = one(r[("enrollment_funnel", ORG_A, 30)], org_id=ORG_A)
    c.check(funnel == {"org_id": ORG_A, "page_views": 9, "course_views": 7, "enrollments": 5, "completions": 2},
            f"enrollment_funnel: {funnel}")

    pv = one(r[("event_counts", ORG_A, 30)], event_name="page_view")
    c.check(pv.get("total") == 14 and pv.get("unique_users") == 9, f"event_counts page_view: {pv}")

    by_country = r[("visitors_by_country", ORG_A, 30)]
    c.check(one(by_country, country_code="FR") == {"org_id": ORG_A, "country_code": "FR", "visits": 4, "unique_users": 2},
            f"visitors_by_country FR: {by_country}")
    c.check(one(by_country, country_code="US").get("unique_users") == 5, f"visitors_by_country US: {by_country}")
    by_device = r[("visitors_by_device", ORG_A, 30)]
    c.check(one(by_device, device_type="mobile").get("unique_users") == 2, f"visitors_by_device: {by_device}")
    by_ref = r[("visitors_by_referrer", ORG_A, 30)]
    c.check(one(by_ref, referrer_domain="google.com").get("visits") == 4, f"visitors_by_referrer: {by_ref}")

    breakdown = one(r[("daily_visitor_breakdown", ORG_A, 30)], date=d3)
    c.check(
        breakdown.get("dau") == 4 and breakdown.get("desktop") == 3 and breakdown.get("mobile") == 3
        and breakdown.get("tablet") == 1 and breakdown.get("top_countries") == ["FR", "DE", "US"]
        and breakdown.get("top_referrer") == ["google.com"],
        f"daily_visitor_breakdown {d3}: {breakdown}",
    )

    engagement = one(r[("activity_engagement", ORG_A, 30)], activity_uuid="act_1_1")
    c.check(engagement.get("views") == 4 and engagement.get("completions") == 3
            and engagement.get("activity_type") == "TYPE_VIDEO" and engagement.get("course_uuid") == C1
            and engagement.get("avg_seconds_spent") == 210,
            f"activity_engagement act_1_1: {engagement}")

    c.check(sum(row["new_users"] for row in r[("new_vs_returning", ORG_A, 30)]) == 3,
            f"new_vs_returning: expected 3 new users, got {r[('new_vs_returning', ORG_A, 30)]}")

    cohort_week = (day(55).date() - timedelta(days=day(55).date().weekday())).isoformat()
    cohort = one(r[("cohort_retention", ORG_A, 90)], cohort_week=cohort_week)
    # week_8 depends on the weekday the script runs (user 101 is active three
    # days ago), so only the weeks the seed pins exactly are checked.
    c.check({k: cohort.get(k) for k in ("cohort_size", "week_1", "week_2", "week_4")}
            == {"cohort_size": 2, "week_1": 1, "week_2": 1, "week_4": 1},
            f"cohort_retention {cohort_week}: {r[('cohort_retention', ORG_A, 90)]}")

    ttc = r[("time_to_completion", ORG_A, 180)]
    c.check(one(ttc, course_uuid=C1).get("median_days") == 10 and one(ttc, course_uuid=C2).get("median_days") == 5,
            f"time_to_completion: {ttc}")

    velocity = one(r[("completion_velocity", ORG_A, 90)], course_uuid=C1)
    c.check(velocity.get("transitions") == 4, f"completion_velocity C1: {velocity}")

    community = r[("community_correlation", ORG_A, 90)]
    c.check(one(community, group_name="discussors").get("completion_rate") == 100.0
            and one(community, group_name="non_discussors") == {
                "org_id": ORG_A, "group_name": "non_discussors", "enrolled_count": 4,
                "completed_count": 1, "completion_rate": 25.0},
            f"community_correlation: {community}")

    search = r[("search_effectiveness", ORG_A, 30)]
    c.check(one(search, query="python").get("search_count") == 2 and one(search, query="python").get("zero_results") == 0
            and one(search, query="rust").get("zero_result_rate") == 100.0
            and one(search, query="go").get("zero_results") == 1,
            f"search_effectiveness: {search}")

    cert = r[("certification_rate", ORG_A, 90)]
    c.check(one(cert, course_uuid=C1).get("claim_rate") == 100.0 and one(cert, course_uuid=C2).get("claims") == 0,
            f"certification_rate: {cert}")

    rating = r[("course_rating_by_completion", ORG_A, 90)]
    c.check([row["course_uuid"] for row in rating] == [C1] and rating[0]["completion_rate"] == 20.0,
            f"course_rating_by_completion: {rating}")

    expected_hourly = sum(1 for e in seed if e["org_id"] == ORG_A and e["ts"].date() >= (NOW - timedelta(days=30)).date())
    c.check(sum(row["event_count"] for row in r[("peak_usage_hours", ORG_A, 30)]) == expected_hourly,
            f"peak_usage_hours: expected {expected_hourly} events")

    progress = r[("user_progress_snapshot", ORG_A, 90)]
    c.check(one(progress, course_uuid=C1, bracket="76-100%").get("user_count") == 1, f"user_progress_snapshot: {progress}")

    scores = r[("learner_engagement_score", ORG_A, 30)]
    c.check(bool(scores) and scores[0]["user_id"] == 101, f"learner_engagement_score: {scores[:3]}")

    c.check(one(r[("course_overview_stats", ORG_A, C1)]) == {"views": 6, "enrollments": 5, "completions": 1, "completion_rate": 20.0},
            f"course_overview_stats: {r[('course_overview_stats', ORG_A, C1)]}")
    c.check(r[("course_overview_stats", ORG_A, "course_missing")] == [{"views": 0, "enrollments": 0, "completions": 0, "completion_rate": 0}],
            f"course_overview_stats (no data): {r[('course_overview_stats', ORG_A, 'course_missing')]}")
    c.check(r[("course_unique_viewers", ORG_A, C1)] == [{"date": d5, "unique_viewers": 6, "total_views": 6}],
            f"course_unique_viewers: {r[('course_unique_viewers', ORG_A, C1)]}")
    funnel_c1 = one(r[("course_activity_funnel", ORG_A, C1)], activity_uuid="act_1_1")
    c.check(funnel_c1 == {"activity_uuid": "act_1_1", "views": 4, "completions": 3, "completion_rate": 75.0},
            f"course_activity_funnel act_1_1: {funnel_c1}")
    c.check(one(r[("course_time_to_completion", ORG_A, C1)]).get("median_days") == 10,
            f"course_time_to_completion: {r[('course_time_to_completion', ORG_A, C1)]}")
    c.check(one(r[("course_certification_rate", ORG_A, C1)]) == {"completions": 1, "claims": 1, "claim_rate": 100.0},
            f"course_certification_rate: {r[('course_certification_rate', ORG_A, C1)]}")
    velocity_c1 = one(r[("course_completion_velocity", ORG_A, C1)])
    c.check(velocity_c1.get("transitions") == 4, f"course_completion_velocity: {velocity_c1}")
    c.check(one(r[("course_completion_velocity", ORG_A, "course_missing")]) == {"avg_hours_between": 0, "transitions": 0},
            f"course_completion_velocity (no data): {r[('course_completion_velocity', ORG_A, 'course_missing')]}")
    top_learners = r[("course_top_learners", ORG_A, C1)]
    c.check(top_learners[:1] and top_learners[0]["user_id"] == 101 and top_learners[0]["completions"] == 4
            and top_learners[0]["total_seconds_spent"] == 900,
            f"course_top_learners: {top_learners}")
    c.check(sorted(row["user_id"] for row in r[("course_recent_enrollments", ORG_A, C1)]) == [101, 102, 103, 104, 105],
            f"course_recent_enrollments: {r[('course_recent_enrollments', ORG_A, C1)]}")
    c.check(sum(row["active_users"] for row in r[("course_learner_retention", ORG_A, C1)] if row["days_since_start"] == 0) == 3,
            f"course_learner_retention: {r[('course_learner_retention', ORG_A, C1)]}")

    c.check(one(r[("user_time_total", 101)]) == {"total_seconds": 900, "activities_touched": 2},
            f"user_time_total: {r[('user_time_total', 101)]}")
    c.check(one(r[("user_views", 101)], event_name="page_view").get("count") == 6, f"user_views: {r[('user_views', 101)]}")
    c.check(r[("user_time_total", 0)] == [{"total_seconds": 0, "activities_touched": 0}],
            f"user_time_total (no data): {r[('user_time_total', 0)]}")

    rank = r[("superadmin_org_visits_rank", 0)]
    c.check(one(rank, org_id=ORG_A).get("views") == 14 and one(rank, org_id=ORG_B).get("views") == 2,
            f"superadmin_org_visits_rank: {rank}")
    weekly = rows_for(r[("superadmin_org_weekly_visits", 0)], org_id=ORG_A)
    c.check(one(weekly, date=d3).get("views") == 7, f"superadmin_org_weekly_visits: {weekly}")

    c.check(rows_for(shim_rank["data"], org_id=ORG_A) == rows_for(rank, org_id=ORG_A), f"shim visits rank: {shim_rank}")
    c.check(shim_core["data"] == top, f"shim superadmin_top_courses: {shim_core}")
    c.check(shim_unknown == {"data": [], "rows": 0, "meta": []}, f"shim unknown: {shim_unknown}")

    # ---- per-feature queries -------------------------------------------
    d6, d7, d8, d11, d18 = (day(n).date().isoformat() for n in (6, 7, 8, 11, 18))
    c.check(all(name in ALL_QUERIES for name in FEATURE_QUERIES), "FEATURE_QUERIES missing from ALL_QUERIES")
    for name in FEATURE_QUERIES:
        c.check(r[(name, ORG_EMPTY, 30)] == [], f"{name} for an empty org: {r[(name, ORG_EMPTY, 30)]}")

    summary = r[("feature_summary", ORG_A, 30)]
    c.check(one(summary, feature="ai") == {"feature": "ai", "events": 7, "actors": 4, "prev_events": 2, "prev_actors": 1},
            f"feature_summary ai: {summary}")
    c.check(one(summary, feature="search") == {"feature": "search", "events": 4, "actors": 2, "prev_events": 1, "prev_actors": 1},
            f"feature_summary search: {summary}")
    c.check(one(summary, feature="boards") == {"feature": "boards", "events": 17, "actors": 4, "prev_events": 1, "prev_actors": 1},
            f"feature_summary boards: {summary}")
    c.check({row["feature"] for row in summary} == {
        "learning", "assessments", "community", "ai", "podcasts", "boards", "playgrounds",
        "paths", "search", "messaging", "library", "certificates"}, f"feature_summary features: {summary}")
    daily_ai = one(r[("feature_usage_daily", ORG_A, 30)], date=d11, feature="ai")
    c.check(daily_ai == {"date": d11, "feature": "ai", "events": 6, "actors": 3}, f"feature_usage_daily ai {d11}: {daily_ai}")

    for org in (ORG_A, 0):
        for row in r[("video_engagement", org, 30)]:
            c.check(row["reached_25"] >= row["reached_50"] >= row["reached_75"] >= row["reached_100"],
                    f"video_engagement not monotonic: {row}")
    video = r[("video_engagement", ORG_A, 30)]
    c.check(video[:1] == [{"course_uuid": VID, "activity_uuid": "act_vid_1", "reached_25": 3, "reached_50": 2,
                           "reached_75": 1, "reached_100": 1}], f"video_engagement: {video}")
    c.check(one(video, activity_uuid="act_vid_2").get("reached_25") == 0, f"video_engagement act_vid_2: {video}")
    c.check(one(r[("video_engagement", 0, 30)], activity_uuid="act_vid_1").get("reached_100") == 2,
            f"video_engagement all orgs: {r[('video_engagement', 0, 30)]}")

    podcasts = r[("podcast_engagement", ORG_A, 30)]
    c.check(podcasts == [
        {"podcast_uuid": "podcast_aq", "episode_uuid": "episode_aq_1", "plays": 3, "reached_50": 2, "reached_100": 1},
        {"podcast_uuid": "podcast_aq", "episode_uuid": "episode_aq_2", "plays": 1, "reached_50": 0, "reached_100": 0},
    ], f"podcast_engagement: {podcasts}")

    c.check(r[("assessment_summary", ORG_A, 30)] == [
        {"kind": "assignment", "submissions": 3, "graded": 3, "passed": 1, "avg_score_pct": 60.0, "learners": 3},
        {"kind": "code", "submissions": 2, "graded": 2, "passed": 1, "avg_score_pct": 62.5, "learners": 2},
        {"kind": "quiz", "submissions": 2, "graded": 2, "passed": 1, "avg_score_pct": 70.0, "learners": 2},
    ], f"assessment_summary: {r[('assessment_summary', ORG_A, 30)]}")
    c.check(r[("assessment_daily", ORG_A, 30)] == [{"date": d8, "submissions": 7, "graded": 7, "passed": 3}],
            f"assessment_daily: {r[('assessment_daily', ORG_A, 30)]}")

    c.check(one(r[("community_daily", ORG_A, 30)], date=d6) == {
        "date": d6, "discussions": 1, "comments": 3, "reactions": 1, "upvotes": 2, "contributors": 6},
        f"community_daily: {r[('community_daily', ORG_A, 30)]}")
    c.check(r[("top_communities", ORG_A, 30)] == [
        {"community_uuid": "community_aq", "views": 3, "discussions": 1, "comments": 2, "reactions": 1, "contributors": 5},
        {"community_uuid": "community_two", "views": 1, "discussions": 0, "comments": 1, "reactions": 0, "contributors": 1},
    ], f"top_communities: {r[('top_communities', ORG_A, 30)]}")

    c.check(r[("ai_daily", ORG_A, 30)] == [
        {"date": d18, "messages": 0, "users": 0, "opens": 1},
        {"date": d11, "messages": 4, "users": 3, "opens": 2},
    ], f"ai_daily: {r[('ai_daily', ORG_A, 30)]}")
    c.check(r[("ai_by_surface", ORG_A, 30)] == [
        {"surface": "course", "messages": 3, "users": 2},
        {"surface": "unknown", "messages": 1, "users": 1},
    ], f"ai_by_surface: {r[('ai_by_surface', ORG_A, 30)]}")

    acquisition = r[("acquisition_methods", ORG_A, 30)]
    expected_acquisition = [
        ("invite", "email", 7, 2), ("invite", "csv", 1, 1),
        ("join", "invite", 1, 1), ("join", "unknown", 1, 1),
        ("login", "password", 2, 1), ("login", "google", 1, 1),
        ("signup", "email", 3, 3),
    ]
    c.check([(row["kind"], row["method"], row["events"], row["users"]) for row in acquisition] == expected_acquisition,
            f"acquisition_methods: {acquisition}")

    c.check(r[("paths_summary", ORG_A, 30)] == [
        {"path_uuid": "path_aq", "views": 3, "enrollments": 2, "completions": 1},
        {"path_uuid": "path_two", "views": 1, "enrollments": 0, "completions": 0},
    ], f"paths_summary: {r[('paths_summary', ORG_A, 30)]}")

    tops = r[("top_boards_playgrounds", ORG_A, 30)]
    boards = rows_for(tops, kind="board")
    c.check(len(boards) == 10 and boards[0] == {"kind": "board", "uuid": "board_aq", "views": 4, "viewers": 2},
            f"top_boards_playgrounds boards: {boards}")
    c.check(rows_for(tops, kind="playground") == [{"kind": "playground", "uuid": "playground_aq", "views": 3, "viewers": 2}],
            f"top_boards_playgrounds playgrounds: {tops}")

    c.check(r[("content_creation_daily", ORG_A, 30)] == [{
        "date": d7, "courses_created": 2, "courses_published": 1, "activities_created": 3,
        "boards_created": 1, "playgrounds_created": 1, "episodes_published": 2}],
        f"content_creation_daily: {r[('content_creation_daily', ORG_A, 30)]}")

    c.check(r[("nudge_effectiveness", ORG_A, 30)] == [
        {"nudge_type": "inactive_learner", "sent": 3, "returned": 2, "return_rate": 66.7},
        {"nudge_type": "admin_onboarding", "sent": 1, "returned": 1, "return_rate": 100.0},
    ], f"nudge_effectiveness: {r[('nudge_effectiveness', ORG_A, 30)]}")

    c.check(r[("library_top_resources", ORG_A, 30)] == [
        {"resource_uuid": "course_lib", "resource_type": "courses", "opens": 3, "viewers": 2},
        {"resource_uuid": "media_lib", "resource_type": "media", "opens": 1, "viewers": 1},
    ], f"library_top_resources: {r[('library_top_resources', ORG_A, 30)]}")

    # Org isolation: org A's numbers never include org B.
    c.check(all(row["org_id"] == ORG_A for row in r[("event_counts", ORG_A, 30)]), "event_counts leaked another org")
    c.check(r[("event_counts", ORG_EMPTY, 30)] == [], "event_counts for an empty org should be empty")

    print(f"ran {c.ran} queries")
    if c.failures:
        print(f"{len(c.failures)} failure(s):")
        for failure in c.failures:
            print(f"  - {failure}")
        return 1
    print("all analytics queries ran and returned the expected values")
    return 0


if __name__ == "__main__":
    if not os.environ.get("LEARNHOUSE_SQL_CONNECTION_STRING"):
        sys.exit("LEARNHOUSE_SQL_CONNECTION_STRING is not set")
    sys.exit(asyncio.run(main()))
