"""
SQL queries for the analytics dashboards, run on Postgres (``store.run_query``).

Tables (see ``src/db/analytics.py``):

* ``analytics_event``: the raw event stream.
* ``analytics_daily_actor``: one row per actor per org per day.
* ``analytics_hourly_count``: event counts per org, UTC day, hour and name.

The summaries are rebuilt every few minutes, so anything that must be live
(the last five minutes) reads ``analytics_event``.

Every query takes bind parameters, never string interpolation:

* ``:org_id``: ``0`` means every org (the superadmin global view), written
  ``(:org_id = 0 OR org_id = :org_id)``.
* ``:days``: the window, ``ts >= now() - make_interval(days => :days)`` on
  the raw stream and the matching UTC day on the summaries.
* ``:course_uuid`` (course queries) and ``:user_id`` (audit queries).

Visitors vs learners: anonymous visitors record browsing events with
``user_id = 0`` and a daily-rotating ``actor_key`` (``v:...``); signed-in users
have ``actor_key = 'u:<user_id>'``. Traffic metrics (visits, views, funnels)
count distinct ``actor_key`` so every visitor counts; learner metrics
(enrollments, completions, retention, progress, time spent) count ``user_id``
and leave out ``user_id = 0``, which is never a person.

The SQL must not contain curly braces: older callers still run these strings
through ``str.format`` (it's a no-op without braces).
"""

# ---------------------------------------------------------------------------
# Core queries (available to all plans)
# ---------------------------------------------------------------------------

LIVE_USERS = """
SELECT
    org_id,
    count(DISTINCT actor_key) AS live_users
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND ts >= now() - interval '5 minutes'
    AND actor_key <> ''
GROUP BY org_id
"""

DAILY_ACTIVE_USERS = """
SELECT
    org_id,
    day AS date,
    count(DISTINCT user_id) AS dau
FROM analytics_daily_actor
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND day >= (now() AT TIME ZONE 'UTC' - make_interval(days => :days))::date
    AND user_id <> 0
GROUP BY org_id, day
ORDER BY date ASC
"""

TOP_COURSES = """
SELECT
    org_id,
    course_uuid,
    count(DISTINCT actor_key) FILTER (WHERE event_name = 'course_view' AND actor_key <> '') AS views,
    count(DISTINCT user_id) FILTER (WHERE event_name = 'course_enrolled' AND user_id <> 0) AS enrollments,
    count(DISTINCT user_id) FILTER (WHERE event_name = 'course_completed' AND user_id <> 0) AS completions
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND event_name IN ('course_view', 'course_enrolled', 'course_completed')
    AND course_uuid <> ''
    AND ts >= now() - make_interval(days => :days)
GROUP BY org_id, course_uuid
ORDER BY views DESC
LIMIT 20
"""

ENROLLMENT_FUNNEL = """
WITH actor_events AS (
    SELECT
        org_id,
        actor_key,
        bool_or(event_name = 'page_view') AS has_page_view,
        bool_or(event_name = 'course_view') AS has_course_view,
        bool_or(event_name = 'course_enrolled' AND user_id <> 0) AS has_enrolled,
        bool_or(event_name = 'course_completed' AND user_id <> 0) AS has_completed
    FROM analytics_event
    WHERE
        (:org_id = 0 OR org_id = :org_id)
        AND event_name IN ('page_view', 'course_view', 'course_enrolled', 'course_completed')
        AND actor_key <> ''
        AND ts >= now() - make_interval(days => :days)
    GROUP BY org_id, actor_key
)
SELECT
    org_id,
    count(*) FILTER (WHERE has_page_view) AS page_views,
    count(*) FILTER (WHERE has_course_view) AS course_views,
    count(*) FILTER (WHERE has_enrolled) AS enrollments,
    count(*) FILTER (WHERE has_completed) AS completions
FROM actor_events
GROUP BY org_id
"""

EVENT_COUNTS = """
SELECT
    org_id,
    event_name,
    count(*) AS total,
    count(DISTINCT actor_key) FILTER (WHERE actor_key <> '') AS unique_users
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND ts >= now() - make_interval(days => :days)
GROUP BY org_id, event_name
ORDER BY total DESC
"""

VISITORS_BY_COUNTRY = """
SELECT
    org_id,
    country AS country_code,
    count(*) AS visits,
    count(DISTINCT actor_key) FILTER (WHERE actor_key <> '') AS unique_users
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND event_name = 'page_view'
    AND country <> ''
    AND ts >= now() - make_interval(days => :days)
GROUP BY org_id, country
ORDER BY visits DESC
LIMIT 20
"""

VISITORS_BY_DEVICE = """
SELECT
    org_id,
    device AS device_type,
    count(*) AS visits,
    count(DISTINCT actor_key) FILTER (WHERE actor_key <> '') AS unique_users
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND event_name = 'page_view'
    AND device <> ''
    AND ts >= now() - make_interval(days => :days)
GROUP BY org_id, device
ORDER BY visits DESC
"""

VISITORS_BY_REFERRER = """
SELECT
    org_id,
    referrer_domain,
    count(*) AS visits,
    count(DISTINCT actor_key) FILTER (WHERE actor_key <> '') AS unique_users
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND event_name = 'page_view'
    AND referrer_domain <> ''
    AND ts >= now() - make_interval(days => :days)
GROUP BY org_id, referrer_domain
ORDER BY visits DESC
LIMIT 20
"""

# top_countries: the three most frequent countries that day; top_referrer:
# the most frequent referrer, as a one-element array (the shape the
# dashboard reads).
DAILY_VISITOR_BREAKDOWN = """
WITH pv AS (
    SELECT
        org_id,
        (ts AT TIME ZONE 'UTC')::date AS date,
        actor_key,
        device,
        country,
        referrer_domain
    FROM analytics_event
    WHERE
        (:org_id = 0 OR org_id = :org_id)
        AND event_name = 'page_view'
        AND ts >= now() - make_interval(days => :days)
),
daily AS (
    SELECT
        org_id,
        date,
        count(DISTINCT actor_key) FILTER (WHERE actor_key <> '') AS dau,
        count(*) FILTER (WHERE device = 'desktop') AS desktop,
        count(*) FILTER (WHERE device = 'mobile') AS mobile,
        count(*) FILTER (WHERE device = 'tablet') AS tablet
    FROM pv
    GROUP BY org_id, date
),
countries AS (
    SELECT
        org_id,
        date,
        country,
        row_number() OVER (PARTITION BY org_id, date ORDER BY count(*) DESC, country) AS rn
    FROM pv
    WHERE country <> ''
    GROUP BY org_id, date, country
),
referrers AS (
    SELECT
        org_id,
        date,
        referrer_domain,
        row_number() OVER (PARTITION BY org_id, date ORDER BY count(*) DESC, referrer_domain) AS rn
    FROM pv
    WHERE referrer_domain <> ''
    GROUP BY org_id, date, referrer_domain
)
SELECT
    d.org_id,
    d.date,
    d.dau,
    d.desktop,
    d.mobile,
    d.tablet,
    coalesce(
        (SELECT array_agg(c.country::text ORDER BY c.rn) FROM countries c
         WHERE c.org_id = d.org_id AND c.date = d.date AND c.rn <= 3),
        ARRAY[]::text[]
    ) AS top_countries,
    coalesce(
        (SELECT array_agg(r.referrer_domain::text) FROM referrers r
         WHERE r.org_id = d.org_id AND r.date = d.date AND r.rn = 1),
        ARRAY[]::text[]
    ) AS top_referrer
FROM daily d
ORDER BY d.date ASC
"""

ACTIVITY_ENGAGEMENT = """
SELECT
    org_id,
    activity_uuid,
    coalesce(max(properties->>'activity_type') FILTER (WHERE properties->>'activity_type' <> ''), '') AS activity_type,
    coalesce(max(course_uuid) FILTER (WHERE course_uuid <> ''), '') AS course_uuid,
    count(DISTINCT actor_key) FILTER (WHERE event_name = 'activity_view' AND actor_key <> '') AS views,
    count(DISTINCT user_id) FILTER (WHERE event_name = 'activity_completed' AND user_id <> 0) AS completions,
    coalesce(
        avg(seconds_spent::float8) FILTER (
            WHERE event_name = 'time_on_activity' AND seconds_spent > 0 AND seconds_spent <= 14400
        ),
        0
    ) AS avg_seconds_spent
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND event_name IN ('activity_view', 'activity_completed', 'time_on_activity')
    AND activity_uuid <> ''
    AND ts >= now() - make_interval(days => :days)
GROUP BY org_id, activity_uuid
ORDER BY views DESC
LIMIT 50
"""

# ---------------------------------------------------------------------------
# Advanced queries (Pro+ plans only)
# ---------------------------------------------------------------------------

COURSE_DROPOFF = """
WITH enrolled AS (
    SELECT DISTINCT org_id, user_id, course_uuid
    FROM analytics_event
    WHERE (:org_id = 0 OR org_id = :org_id) AND event_name = 'course_enrolled'
        AND user_id <> 0 AND course_uuid <> ''
        AND ts >= now() - make_interval(days => :days)
),
completed AS (
    SELECT DISTINCT org_id, user_id, course_uuid
    FROM analytics_event
    WHERE (:org_id = 0 OR org_id = :org_id) AND event_name = 'course_completed'
        AND user_id <> 0 AND course_uuid <> ''
        AND ts >= now() - make_interval(days => :days)
),
last_activity AS (
    SELECT DISTINCT ON (org_id, user_id, course_uuid)
        org_id,
        user_id,
        course_uuid,
        activity_uuid AS last_activity_uuid
    FROM analytics_event
    WHERE (:org_id = 0 OR org_id = :org_id) AND event_name = 'activity_completed'
        AND user_id <> 0 AND course_uuid <> '' AND activity_uuid <> ''
        AND ts >= now() - make_interval(days => :days)
    ORDER BY org_id, user_id, course_uuid, ts DESC
)
SELECT
    la.org_id,
    la.course_uuid,
    la.last_activity_uuid,
    count(*) AS dropoff_count
FROM enrolled e
INNER JOIN last_activity la
    ON e.user_id = la.user_id AND e.course_uuid = la.course_uuid AND e.org_id = la.org_id
WHERE NOT EXISTS (
    SELECT 1 FROM completed c
    WHERE c.user_id = e.user_id AND c.course_uuid = e.course_uuid AND c.org_id = e.org_id
)
GROUP BY la.org_id, la.course_uuid, la.last_activity_uuid
ORDER BY dropoff_count DESC
"""

# Weeks start on Monday (ISO). Activity comes from the daily summary.
COHORT_RETENTION = """
WITH signups AS (
    SELECT
        org_id,
        user_id,
        date_trunc('week', ts AT TIME ZONE 'UTC')::date AS cohort_week
    FROM analytics_event
    WHERE (:org_id = 0 OR org_id = :org_id) AND event_name = 'user_signed_up'
        AND user_id <> 0
        AND ts >= now() - make_interval(days => :days)
),
activity AS (
    SELECT DISTINCT
        org_id,
        user_id,
        date_trunc('week', day)::date AS active_week
    FROM analytics_daily_actor
    WHERE (:org_id = 0 OR org_id = :org_id)
        AND user_id <> 0
        AND day >= (now() AT TIME ZONE 'UTC' - make_interval(days => :days))::date
)
SELECT
    s.org_id,
    s.cohort_week,
    count(DISTINCT s.user_id) AS cohort_size,
    count(DISTINCT s.user_id) FILTER (WHERE a.active_week - s.cohort_week = 7) AS week_1,
    count(DISTINCT s.user_id) FILTER (WHERE a.active_week - s.cohort_week = 14) AS week_2,
    count(DISTINCT s.user_id) FILTER (WHERE a.active_week - s.cohort_week = 28) AS week_4,
    count(DISTINCT s.user_id) FILTER (WHERE a.active_week - s.cohort_week = 56) AS week_8
FROM signups s
LEFT JOIN activity a ON s.user_id = a.user_id AND s.org_id = a.org_id
    AND a.active_week >= s.cohort_week
GROUP BY s.org_id, s.cohort_week
ORDER BY s.cohort_week ASC
"""

# Days are counted as calendar days crossed (UTC), like ClickHouse's dateDiff.
TIME_TO_COMPLETION = """
WITH enrollments AS (
    SELECT org_id, user_id, course_uuid, min(ts) AS enrolled_at
    FROM analytics_event
    WHERE (:org_id = 0 OR org_id = :org_id) AND event_name = 'course_enrolled'
        AND user_id <> 0 AND course_uuid <> ''
        AND ts >= now() - make_interval(days => :days)
    GROUP BY org_id, user_id, course_uuid
),
completions AS (
    SELECT org_id, user_id, course_uuid, min(ts) AS completed_at
    FROM analytics_event
    WHERE (:org_id = 0 OR org_id = :org_id) AND event_name = 'course_completed'
        AND user_id <> 0 AND course_uuid <> ''
        AND ts >= now() - make_interval(days => :days)
    GROUP BY org_id, user_id, course_uuid
)
SELECT
    e.org_id,
    e.course_uuid,
    percentile_cont(0.5) WITHIN GROUP (
        ORDER BY (c.completed_at AT TIME ZONE 'UTC')::date - (e.enrolled_at AT TIME ZONE 'UTC')::date
    ) AS median_days,
    count(*) AS completions_count
FROM enrollments e
INNER JOIN completions c ON e.user_id = c.user_id AND e.course_uuid = c.course_uuid AND e.org_id = c.org_id
WHERE c.completed_at >= e.enrolled_at
GROUP BY e.org_id, e.course_uuid
ORDER BY median_days ASC
"""

PEAK_USAGE_HOURS = """
SELECT
    org_id,
    extract(isodow FROM day)::int AS day_of_week,
    hour::int AS hour_of_day,
    sum(n)::bigint AS event_count
FROM analytics_hourly_count
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND day >= (now() AT TIME ZONE 'UTC' - make_interval(days => :days))::date
GROUP BY org_id, day_of_week, hour_of_day
ORDER BY day_of_week, hour_of_day
"""

CONTENT_TYPE_EFFECTIVENESS = """
WITH views AS (
    SELECT
        org_id,
        coalesce(properties->>'activity_type', '') AS activity_type,
        count(DISTINCT actor_key) AS view_count
    FROM analytics_event
    WHERE (:org_id = 0 OR org_id = :org_id) AND event_name = 'activity_view'
        AND actor_key <> ''
        AND ts >= now() - make_interval(days => :days)
    GROUP BY 1, 2
),
completions AS (
    SELECT
        org_id,
        coalesce(properties->>'activity_type', '') AS activity_type,
        count(DISTINCT user_id) AS completion_count
    FROM analytics_event
    WHERE (:org_id = 0 OR org_id = :org_id) AND event_name = 'activity_completed'
        AND user_id <> 0
        AND ts >= now() - make_interval(days => :days)
    GROUP BY 1, 2
)
SELECT
    v.org_id,
    v.activity_type,
    v.view_count,
    coalesce(c.completion_count, 0) AS completion_count,
    CASE WHEN v.view_count > 0
         THEN round(coalesce(c.completion_count, 0)::numeric / v.view_count * 100, 1)
         ELSE 0 END AS completion_rate
FROM views v
LEFT JOIN completions c ON v.activity_type = c.activity_type AND v.org_id = c.org_id
ORDER BY completion_rate DESC
"""

NEW_VS_RETURNING = """
WITH daily_users AS (
    SELECT DISTINCT org_id, user_id, day AS date
    FROM analytics_daily_actor
    WHERE (:org_id = 0 OR org_id = :org_id)
        AND user_id <> 0
        AND day >= (now() AT TIME ZONE 'UTC' - make_interval(days => :days))::date
),
first_seen_in_window AS (
    SELECT org_id, user_id, min(date) AS first_date
    FROM daily_users
    GROUP BY org_id, user_id
),
ever_seen_before AS (
    SELECT DISTINCT org_id, user_id
    FROM analytics_daily_actor
    WHERE (:org_id = 0 OR org_id = :org_id)
        AND user_id <> 0
        AND day < (now() AT TIME ZONE 'UTC' - make_interval(days => :days))::date
)
SELECT
    d.org_id,
    d.date,
    count(*) FILTER (WHERE d.date = f.first_date AND e.user_id IS NULL) AS new_users,
    count(*) FILTER (WHERE d.date > f.first_date OR e.user_id IS NOT NULL) AS returning_users
FROM daily_users d
INNER JOIN first_seen_in_window f ON d.user_id = f.user_id AND d.org_id = f.org_id
LEFT JOIN ever_seen_before e ON d.user_id = e.user_id AND d.org_id = e.org_id
GROUP BY d.org_id, d.date
ORDER BY d.date ASC
"""

# Hours are counted as hour boundaries crossed, like ClickHouse's dateDiff.
COMPLETION_VELOCITY = """
WITH ordered AS (
    SELECT
        org_id,
        course_uuid,
        floor(extract(epoch FROM ts) / 3600)
            - floor(extract(epoch FROM lag(ts) OVER (
                PARTITION BY org_id, user_id, course_uuid ORDER BY ts
            )) / 3600) AS hours_between
    FROM analytics_event
    WHERE (:org_id = 0 OR org_id = :org_id) AND event_name = 'activity_completed'
        AND user_id <> 0 AND course_uuid <> ''
        AND ts >= now() - make_interval(days => :days)
)
SELECT
    org_id,
    course_uuid,
    round(avg(hours_between)::numeric, 1) AS avg_hours_between,
    count(*) AS transitions
FROM ordered
WHERE hours_between > 0
GROUP BY org_id, course_uuid
ORDER BY avg_hours_between ASC
"""

COMMUNITY_CORRELATION = """
WITH discussors AS (
    SELECT DISTINCT org_id, user_id
    FROM analytics_event
    WHERE (:org_id = 0 OR org_id = :org_id) AND event_name = 'discussion_posted'
        AND user_id <> 0
        AND ts >= now() - make_interval(days => :days)
),
enrolled AS (
    SELECT DISTINCT org_id, user_id
    FROM analytics_event
    WHERE (:org_id = 0 OR org_id = :org_id) AND event_name = 'course_enrolled'
        AND user_id <> 0
        AND ts >= now() - make_interval(days => :days)
),
completed AS (
    SELECT DISTINCT org_id, user_id
    FROM analytics_event
    WHERE (:org_id = 0 OR org_id = :org_id) AND event_name = 'course_completed'
        AND user_id <> 0
        AND ts >= now() - make_interval(days => :days)
)
SELECT
    e.org_id,
    'discussors'::text AS group_name,
    count(DISTINCT e.user_id) AS enrolled_count,
    count(DISTINCT c.user_id) AS completed_count,
    CASE WHEN count(DISTINCT e.user_id) > 0
         THEN round(count(DISTINCT c.user_id)::numeric / count(DISTINCT e.user_id) * 100, 1)
         ELSE 0 END AS completion_rate
FROM enrolled e
INNER JOIN discussors d ON e.user_id = d.user_id AND e.org_id = d.org_id
LEFT JOIN completed c ON e.user_id = c.user_id AND e.org_id = c.org_id
GROUP BY e.org_id
UNION ALL
SELECT
    e.org_id,
    'non_discussors'::text AS group_name,
    count(DISTINCT e.user_id) AS enrolled_count,
    count(DISTINCT c.user_id) AS completed_count,
    CASE WHEN count(DISTINCT e.user_id) > 0
         THEN round(count(DISTINCT c.user_id)::numeric / count(DISTINCT e.user_id) * 100, 1)
         ELSE 0 END AS completion_rate
FROM enrolled e
LEFT JOIN completed c ON e.user_id = c.user_id AND e.org_id = c.org_id
WHERE NOT EXISTS (
    SELECT 1 FROM discussors d WHERE d.user_id = e.user_id AND d.org_id = e.org_id
)
GROUP BY e.org_id
"""

USER_PROGRESS_SNAPSHOT = """
WITH total_activities AS (
    SELECT
        org_id,
        course_uuid,
        count(DISTINCT activity_uuid) AS total_count
    FROM analytics_event
    WHERE (:org_id = 0 OR org_id = :org_id)
        AND event_name IN ('activity_view', 'activity_completed')
        AND activity_uuid <> '' AND course_uuid <> ''
        AND ts >= now() - make_interval(days => :days)
    GROUP BY org_id, course_uuid
),
user_activities AS (
    SELECT
        org_id,
        user_id,
        course_uuid,
        count(DISTINCT activity_uuid) FILTER (WHERE event_name = 'activity_completed') AS completed_activities
    FROM analytics_event
    WHERE (:org_id = 0 OR org_id = :org_id)
        AND event_name IN ('course_enrolled', 'activity_completed')
        AND user_id <> 0 AND course_uuid <> ''
        AND ts >= now() - make_interval(days => :days)
    GROUP BY org_id, user_id, course_uuid
)
SELECT
    ua.org_id,
    ua.course_uuid,
    CASE
        WHEN ta.total_count IS NULL OR ta.total_count = 0 THEN '0%'
        WHEN ua.completed_activities = 0 THEN '0%'
        WHEN ua.completed_activities::numeric / ta.total_count <= 0.25 THEN '1-25%'
        WHEN ua.completed_activities::numeric / ta.total_count <= 0.50 THEN '26-50%'
        WHEN ua.completed_activities::numeric / ta.total_count <= 0.75 THEN '51-75%'
        ELSE '76-100%'
    END AS bracket,
    count(*) AS user_count
FROM user_activities ua
LEFT JOIN total_activities ta ON ua.course_uuid = ta.course_uuid AND ua.org_id = ta.org_id
GROUP BY ua.org_id, ua.course_uuid, bracket
ORDER BY ua.course_uuid, bracket
"""

# A search with no results_count property counts as a zero-result search.
SEARCH_EFFECTIVENESS = """
SELECT
    org_id,
    coalesce(properties->>'query', '') AS query,
    count(*) AS search_count,
    count(*) FILTER (WHERE coalesce(properties->'results_count', '0'::jsonb) = '0'::jsonb) AS zero_results,
    round(
        (count(*) FILTER (WHERE coalesce(properties->'results_count', '0'::jsonb) = '0'::jsonb))::numeric
        / count(*) * 100,
        1
    ) AS zero_result_rate
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND event_name = 'search_query'
    AND ts >= now() - make_interval(days => :days)
GROUP BY 1, 2
ORDER BY search_count DESC
LIMIT 50
"""

CERTIFICATION_RATE = """
WITH completers AS (
    SELECT org_id, course_uuid, count(DISTINCT user_id) AS completions
    FROM analytics_event
    WHERE (:org_id = 0 OR org_id = :org_id) AND event_name = 'course_completed'
        AND user_id <> 0 AND course_uuid <> ''
        AND ts >= now() - make_interval(days => :days)
    GROUP BY org_id, course_uuid
),
cert_claims AS (
    SELECT org_id, course_uuid, count(DISTINCT user_id) AS claims
    FROM analytics_event
    WHERE (:org_id = 0 OR org_id = :org_id) AND event_name = 'certificate_claimed'
        AND user_id <> 0 AND course_uuid <> ''
        AND ts >= now() - make_interval(days => :days)
    GROUP BY org_id, course_uuid
)
SELECT
    c.org_id,
    c.course_uuid,
    c.completions,
    coalesce(cc.claims, 0) AS claims,
    CASE WHEN c.completions > 0
         THEN round(coalesce(cc.claims, 0)::numeric / c.completions * 100, 1)
         ELSE 0 END AS claim_rate
FROM completers c
LEFT JOIN cert_claims cc ON c.course_uuid = cc.course_uuid AND c.org_id = cc.org_id
ORDER BY c.completions DESC
"""

ORG_GROWTH_TREND = """
SELECT
    org_id,
    date_trunc('week', ts AT TIME ZONE 'UTC')::date AS week,
    count(DISTINCT user_id) FILTER (WHERE event_name = 'user_signed_up') AS signups,
    count(DISTINCT user_id) FILTER (WHERE event_name = 'course_enrolled') AS enrollments,
    count(DISTINCT user_id) FILTER (WHERE event_name = 'course_completed') AS completions
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND ts >= now() - make_interval(days => :days)
    AND event_name IN ('user_signed_up', 'course_enrolled', 'course_completed')
    AND user_id <> 0
GROUP BY org_id, week
ORDER BY week ASC
"""

LEARNER_ENGAGEMENT_SCORE = """
WITH per_user AS (
    SELECT
        org_id,
        user_id,
        count(DISTINCT path) FILTER (WHERE event_name = 'page_view') AS page_views,
        count(DISTINCT activity_uuid) FILTER (WHERE event_name = 'activity_completed') AS activities_completed,
        count(DISTINCT course_uuid) FILTER (WHERE event_name = 'course_completed') AS courses_completed,
        coalesce(
            sum(least(seconds_spent::float8, 14400)) FILTER (WHERE event_name = 'time_on_activity'),
            0
        ) AS total_time_spent
    FROM analytics_event
    WHERE
        (:org_id = 0 OR org_id = :org_id)
        AND ts >= now() - make_interval(days => :days)
        AND user_id <> 0
    GROUP BY org_id, user_id
)
SELECT
    org_id,
    user_id,
    page_views,
    activities_completed,
    courses_completed,
    total_time_spent,
    least(
        least(page_views, 50) * 1
        + least(activities_completed, 100) * 10
        + least(courses_completed, 20) * 50
        + least(total_time_spent / 3600, 100) * 5,
        2500
    ) AS engagement_score
FROM per_user
ORDER BY engagement_score DESC
LIMIT 100
"""

COURSE_RATING_BY_COMPLETION = """
SELECT
    org_id,
    course_uuid,
    count(DISTINCT user_id) FILTER (WHERE event_name = 'course_enrolled' AND user_id <> 0) AS enrollments,
    count(DISTINCT user_id) FILTER (WHERE event_name = 'course_completed' AND user_id <> 0) AS completions,
    count(DISTINCT activity_uuid) FILTER (WHERE event_name = 'activity_view') AS activity_count,
    CASE WHEN count(DISTINCT user_id) FILTER (WHERE event_name = 'course_enrolled' AND user_id <> 0) > 0
         THEN round(
             (count(DISTINCT user_id) FILTER (WHERE event_name = 'course_completed' AND user_id <> 0))::numeric
             / count(DISTINCT user_id) FILTER (WHERE event_name = 'course_enrolled' AND user_id <> 0) * 100,
             1
         )
         ELSE 0 END AS completion_rate
FROM analytics_event
WHERE (:org_id = 0 OR org_id = :org_id)
    AND event_name IN ('course_enrolled', 'course_completed', 'activity_view')
    AND course_uuid <> ''
    AND ts >= now() - make_interval(days => :days)
GROUP BY org_id, course_uuid
HAVING count(DISTINCT user_id) FILTER (WHERE event_name = 'course_enrolled' AND user_id <> 0) >= 5
ORDER BY enrollments DESC
"""

# ---------------------------------------------------------------------------
# Detail queries (stat-card drill-down, return individual rows for enrichment)
# ---------------------------------------------------------------------------

DETAIL_LIVE_USERS = """
SELECT user_id, path, device_type, country_code, last_seen
FROM (
    SELECT DISTINCT ON (user_id)
        user_id,
        coalesce(path, '') AS path,
        coalesce(device, '') AS device_type,
        coalesce(country, '') AS country_code,
        ts AS last_seen
    FROM analytics_event
    WHERE
        (:org_id = 0 OR org_id = :org_id)
        AND event_name = 'page_view'
        AND ts >= now() - interval '5 minutes'
        AND user_id <> 0
    ORDER BY user_id, ts DESC
) latest
ORDER BY last_seen DESC
LIMIT 200
"""

DETAIL_SIGNUPS = """
SELECT
    user_id,
    coalesce(properties->>'signup_method', '') AS signup_method,
    ts AS "timestamp"
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND event_name = 'user_signed_up'
    AND ts >= now() - make_interval(days => :days)
    AND user_id <> 0
ORDER BY ts DESC
LIMIT 200
"""

DETAIL_ENROLLMENTS = """
SELECT
    user_id,
    course_uuid,
    min(ts) AS enrolled_at
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND event_name = 'course_enrolled'
    AND ts >= now() - make_interval(days => :days)
    AND user_id <> 0
GROUP BY user_id, course_uuid
ORDER BY enrolled_at DESC
LIMIT 200
"""

DETAIL_COMPLETIONS = """
SELECT
    user_id,
    course_uuid,
    ts AS "timestamp"
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND event_name = 'course_completed'
    AND ts >= now() - make_interval(days => :days)
    AND user_id <> 0
ORDER BY ts DESC
LIMIT 200
"""

DETAIL_QUERIES: dict[str, tuple[str, int]] = {
    "detail_live_users": (DETAIL_LIVE_USERS, 0),
    "detail_signups": (DETAIL_SIGNUPS, 30),
    "detail_enrollments": (DETAIL_ENROLLMENTS, 30),
    "detail_completions": (DETAIL_COMPLETIONS, 30),
    "learner_engagement_score": (LEARNER_ENGAGEMENT_SCORE, 30),
}

# ---------------------------------------------------------------------------
# Registry: maps query names to (sql, default_days)
# ---------------------------------------------------------------------------

CORE_QUERIES: dict[str, tuple[str, int]] = {
    "live_users": (LIVE_USERS, 0),
    "daily_active_users": (DAILY_ACTIVE_USERS, 30),
    "top_courses": (TOP_COURSES, 30),
    "enrollment_funnel": (ENROLLMENT_FUNNEL, 30),
    "event_counts": (EVENT_COUNTS, 30),
    "activity_engagement": (ACTIVITY_ENGAGEMENT, 30),
    "visitors_by_country": (VISITORS_BY_COUNTRY, 30),
    "visitors_by_device": (VISITORS_BY_DEVICE, 30),
    "visitors_by_referrer": (VISITORS_BY_REFERRER, 30),
    "daily_visitor_breakdown": (DAILY_VISITOR_BREAKDOWN, 30),
}

ADVANCED_QUERIES: dict[str, tuple[str, int]] = {
    "course_dropoff": (COURSE_DROPOFF, 90),
    "cohort_retention": (COHORT_RETENTION, 90),
    "time_to_completion": (TIME_TO_COMPLETION, 180),
    "peak_usage_hours": (PEAK_USAGE_HOURS, 30),
    "content_type_effectiveness": (CONTENT_TYPE_EFFECTIVENESS, 30),
    "new_vs_returning": (NEW_VS_RETURNING, 30),
    "completion_velocity": (COMPLETION_VELOCITY, 90),
    "community_correlation": (COMMUNITY_CORRELATION, 90),
    "user_progress_snapshot": (USER_PROGRESS_SNAPSHOT, 90),
    "search_effectiveness": (SEARCH_EFFECTIVENESS, 30),
    "certification_rate": (CERTIFICATION_RATE, 90),
    "org_growth_trend": (ORG_GROWTH_TREND, 90),
    "course_rating_by_completion": (COURSE_RATING_BY_COMPLETION, 90),
}

# ---------------------------------------------------------------------------
# Course-level queries (Pro only, filtered by :course_uuid)
# ---------------------------------------------------------------------------

COURSE_OVERVIEW_STATS = """
SELECT
    count(DISTINCT actor_key) FILTER (WHERE event_name = 'course_view' AND actor_key <> '') AS views,
    count(DISTINCT user_id) FILTER (WHERE event_name = 'course_enrolled' AND user_id <> 0) AS enrollments,
    count(DISTINCT user_id) FILTER (WHERE event_name = 'course_completed' AND user_id <> 0) AS completions,
    CASE WHEN count(DISTINCT user_id) FILTER (WHERE event_name = 'course_enrolled' AND user_id <> 0) > 0
         THEN round(
             (count(DISTINCT user_id) FILTER (WHERE event_name = 'course_completed' AND user_id <> 0))::numeric
             / count(DISTINCT user_id) FILTER (WHERE event_name = 'course_enrolled' AND user_id <> 0) * 100,
             1
         )
         ELSE 0 END AS completion_rate
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND course_uuid = :course_uuid
    AND event_name IN ('course_view', 'course_enrolled', 'course_completed')
    AND ts >= now() - make_interval(days => :days)
"""

COURSE_ENROLLMENT_TREND = """
SELECT
    (ts AT TIME ZONE 'UTC')::date AS date,
    count(DISTINCT user_id) AS enrollments
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND course_uuid = :course_uuid
    AND event_name = 'course_enrolled'
    AND user_id <> 0
    AND ts >= now() - make_interval(days => :days)
GROUP BY date
ORDER BY date ASC
"""

COURSE_ACTIVITY_FUNNEL = """
SELECT
    activity_uuid,
    count(DISTINCT actor_key) FILTER (WHERE event_name = 'activity_view' AND actor_key <> '') AS views,
    count(DISTINCT user_id) FILTER (WHERE event_name = 'activity_completed' AND user_id <> 0) AS completions,
    CASE WHEN count(DISTINCT actor_key) FILTER (WHERE event_name = 'activity_view' AND actor_key <> '') > 0
         THEN round(
             (count(DISTINCT user_id) FILTER (WHERE event_name = 'activity_completed' AND user_id <> 0))::numeric
             / count(DISTINCT actor_key) FILTER (WHERE event_name = 'activity_view' AND actor_key <> '') * 100,
             1
         )
         ELSE 0 END AS completion_rate
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND course_uuid = :course_uuid
    AND event_name IN ('activity_view', 'activity_completed')
    AND activity_uuid <> ''
    AND ts >= now() - make_interval(days => :days)
GROUP BY activity_uuid
ORDER BY views DESC
"""

COURSE_LEARNER_PROGRESS = """
WITH user_completions AS (
    SELECT
        user_id,
        count(DISTINCT activity_uuid) AS completed_activities
    FROM analytics_event
    WHERE
        (:org_id = 0 OR org_id = :org_id)
        AND course_uuid = :course_uuid
        AND event_name = 'activity_completed'
        AND user_id <> 0
        AND ts >= now() - make_interval(days => :days)
    GROUP BY user_id
)
SELECT
    CASE
        WHEN completed_activities = 0 THEN '0'
        WHEN completed_activities <= 2 THEN '1-2'
        WHEN completed_activities <= 5 THEN '3-5'
        WHEN completed_activities <= 10 THEN '6-10'
        ELSE '11+'
    END AS bracket,
    count(*) AS user_count
FROM user_completions
GROUP BY bracket
ORDER BY bracket
"""

COURSE_TIME_PER_ACTIVITY = """
SELECT
    activity_uuid,
    round(avg(least(seconds_spent::float8, 14400))::numeric, 1) AS avg_seconds_spent,
    count(*) AS samples
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND course_uuid = :course_uuid
    AND event_name = 'time_on_activity'
    AND seconds_spent > 0
    AND ts >= now() - make_interval(days => :days)
GROUP BY activity_uuid
ORDER BY avg_seconds_spent DESC
"""

COURSE_COMPLETION_VELOCITY = """
WITH ordered AS (
    SELECT
        floor(extract(epoch FROM ts) / 3600)
            - floor(extract(epoch FROM lag(ts) OVER (PARTITION BY user_id ORDER BY ts)) / 3600)
            AS hours_between
    FROM analytics_event
    WHERE
        (:org_id = 0 OR org_id = :org_id)
        AND course_uuid = :course_uuid
        AND event_name = 'activity_completed'
        AND user_id <> 0
        AND ts >= now() - make_interval(days => :days)
)
SELECT
    coalesce(round(avg(hours_between)::numeric, 1), 0) AS avg_hours_between,
    count(*) AS transitions
FROM ordered
WHERE hours_between > 0
"""

COURSE_ACTIVE_LEARNERS = """
SELECT
    (ts AT TIME ZONE 'UTC')::date AS date,
    count(DISTINCT user_id) AS active_learners
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND course_uuid = :course_uuid
    AND user_id <> 0
    AND ts >= now() - make_interval(days => :days)
GROUP BY date
ORDER BY date ASC
"""

COURSE_TIME_TO_COMPLETION = """
WITH enrollments AS (
    SELECT user_id, min(ts) AS enrolled_at
    FROM analytics_event
    WHERE
        (:org_id = 0 OR org_id = :org_id)
        AND course_uuid = :course_uuid
        AND event_name = 'course_enrolled'
        AND user_id <> 0
        AND ts >= now() - make_interval(days => :days)
    GROUP BY user_id
),
completions AS (
    SELECT user_id, min(ts) AS completed_at
    FROM analytics_event
    WHERE
        (:org_id = 0 OR org_id = :org_id)
        AND course_uuid = :course_uuid
        AND event_name = 'course_completed'
        AND user_id <> 0
        AND ts >= now() - make_interval(days => :days)
    GROUP BY user_id
),
durations AS (
    SELECT (c.completed_at AT TIME ZONE 'UTC')::date - (e.enrolled_at AT TIME ZONE 'UTC')::date AS days
    FROM enrollments e
    INNER JOIN completions c ON e.user_id = c.user_id
    WHERE c.completed_at >= e.enrolled_at
)
SELECT
    percentile_cont(0.5) WITHIN GROUP (ORDER BY days) AS median_days,
    count(*) AS completions_count,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY days) AS p25_days,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY days) AS p75_days
FROM durations
"""

COURSE_CERTIFICATION_RATE = """
WITH completers AS (
    SELECT count(DISTINCT user_id) AS completions
    FROM analytics_event
    WHERE
        (:org_id = 0 OR org_id = :org_id)
        AND course_uuid = :course_uuid
        AND event_name = 'course_completed'
        AND user_id <> 0
        AND ts >= now() - make_interval(days => :days)
),
cert_claims AS (
    SELECT count(DISTINCT user_id) AS claims
    FROM analytics_event
    WHERE
        (:org_id = 0 OR org_id = :org_id)
        AND course_uuid = :course_uuid
        AND event_name = 'certificate_claimed'
        AND user_id <> 0
        AND ts >= now() - make_interval(days => :days)
)
SELECT
    completers.completions,
    cert_claims.claims,
    CASE WHEN completers.completions > 0
         THEN round(cert_claims.claims::numeric / completers.completions * 100, 1)
         ELSE 0 END AS claim_rate
FROM completers, cert_claims
"""

# ---------------------------------------------------------------------------
# Course-level queries, batch 2
# ---------------------------------------------------------------------------

COURSE_VIEW_TO_ENROLLMENT = """
SELECT
    (ts AT TIME ZONE 'UTC')::date AS date,
    count(DISTINCT actor_key) FILTER (WHERE event_name = 'course_view' AND actor_key <> '') AS views,
    count(DISTINCT user_id) FILTER (WHERE event_name = 'course_enrolled' AND user_id <> 0) AS enrollments,
    CASE WHEN count(DISTINCT actor_key) FILTER (WHERE event_name = 'course_view' AND actor_key <> '') > 0
         THEN round(
             (count(DISTINCT user_id) FILTER (WHERE event_name = 'course_enrolled' AND user_id <> 0))::numeric
             / count(DISTINCT actor_key) FILTER (WHERE event_name = 'course_view' AND actor_key <> '') * 100,
             1
         )
         ELSE 0 END AS conversion_rate
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND course_uuid = :course_uuid
    AND event_name IN ('course_view', 'course_enrolled')
    AND ts >= now() - make_interval(days => :days)
GROUP BY date
ORDER BY date ASC
"""

COURSE_ACTIVITY_TYPE_BREAKDOWN = """
SELECT
    properties->>'activity_type' AS activity_type,
    count(DISTINCT actor_key) FILTER (WHERE event_name = 'activity_view' AND actor_key <> '') AS views,
    count(DISTINCT user_id) FILTER (WHERE event_name = 'activity_completed' AND user_id <> 0) AS completions,
    CASE WHEN count(DISTINCT actor_key) FILTER (WHERE event_name = 'activity_view' AND actor_key <> '') > 0
         THEN round(
             (count(DISTINCT user_id) FILTER (WHERE event_name = 'activity_completed' AND user_id <> 0))::numeric
             / count(DISTINCT actor_key) FILTER (WHERE event_name = 'activity_view' AND actor_key <> '') * 100,
             1
         )
         ELSE 0 END AS completion_rate
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND course_uuid = :course_uuid
    AND event_name IN ('activity_view', 'activity_completed')
    AND properties->>'activity_type' <> ''
    AND ts >= now() - make_interval(days => :days)
GROUP BY 1
ORDER BY views DESC
"""

COURSE_PEAK_HOURS = """
SELECT
    extract(hour FROM ts AT TIME ZONE 'UTC')::int AS hour,
    extract(isodow FROM ts AT TIME ZONE 'UTC')::int AS day_of_week,
    count(*) AS event_count
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND course_uuid = :course_uuid
    AND event_name IN ('activity_view', 'activity_completed', 'time_on_activity')
    AND ts >= now() - make_interval(days => :days)
GROUP BY 1, 2
ORDER BY day_of_week, hour
"""

COURSE_LEARNER_RETENTION = """
WITH daily_activity AS (
    SELECT DISTINCT
        user_id,
        (ts AT TIME ZONE 'UTC')::date AS active_day
    FROM analytics_event
    WHERE
        (:org_id = 0 OR org_id = :org_id)
        AND course_uuid = :course_uuid
        AND event_name IN ('activity_view', 'activity_completed')
        AND user_id <> 0
        AND ts >= now() - make_interval(days => :days)
),
first_activity AS (
    SELECT user_id, min(active_day) AS first_day
    FROM daily_activity
    GROUP BY user_id
)
SELECT
    d.active_day - f.first_day AS days_since_start,
    count(DISTINCT d.user_id) AS active_users,
    (SELECT count(*) FROM first_activity) AS cohort_size
FROM first_activity f
INNER JOIN daily_activity d ON f.user_id = d.user_id
WHERE d.active_day - f.first_day BETWEEN 0 AND 30
GROUP BY 1
ORDER BY 1
"""

COURSE_TOP_LEARNERS = """
SELECT
    user_id,
    count(DISTINCT activity_uuid) FILTER (WHERE event_name = 'activity_completed') AS completions,
    count(DISTINCT activity_uuid) FILTER (WHERE event_name = 'activity_view') AS views,
    coalesce(
        sum(least(seconds_spent::float8, 14400)) FILTER (
            WHERE event_name = 'time_on_activity' AND seconds_spent > 0
        ),
        0
    ) AS total_seconds_spent
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND course_uuid = :course_uuid
    AND event_name IN ('activity_completed', 'activity_view', 'time_on_activity')
    AND ts >= now() - make_interval(days => :days)
    AND user_id <> 0
GROUP BY user_id
ORDER BY completions DESC, views DESC
LIMIT 20
"""

COURSE_ACTIVITY_DROPOFF = """
WITH user_activities AS (
    SELECT
        user_id,
        activity_uuid,
        min(ts) AS first_completed_at
    FROM analytics_event
    WHERE
        (:org_id = 0 OR org_id = :org_id)
        AND course_uuid = :course_uuid
        AND event_name = 'activity_completed'
        AND user_id <> 0
        AND activity_uuid <> ''
        AND ts >= now() - make_interval(days => :days)
    GROUP BY user_id, activity_uuid
),
user_max_activity AS (
    SELECT
        user_id,
        (array_agg(activity_uuid ORDER BY first_completed_at DESC))[1] AS last_activity_uuid,
        count(*) AS total_completed
    FROM user_activities
    GROUP BY user_id
)
SELECT
    last_activity_uuid AS activity_uuid,
    count(*) AS users_stopped_here,
    avg(total_completed) AS avg_completed_before_stop
FROM user_max_activity
GROUP BY last_activity_uuid
ORDER BY users_stopped_here DESC
LIMIT 20
"""

COURSE_ENGAGEMENT_BY_TYPE = """
SELECT
    properties->>'activity_type' AS activity_type,
    count(DISTINCT actor_key) FILTER (WHERE actor_key <> '') AS unique_learners,
    count(*) AS total_events,
    count(DISTINCT user_id) FILTER (WHERE event_name = 'activity_completed' AND user_id <> 0) AS completions,
    coalesce(
        avg(seconds_spent::float8) FILTER (
            WHERE event_name = 'time_on_activity' AND seconds_spent > 0 AND seconds_spent <= 14400
        ),
        0
    ) AS avg_seconds_spent
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND course_uuid = :course_uuid
    AND event_name IN ('activity_view', 'activity_completed', 'time_on_activity')
    AND properties->>'activity_type' <> ''
    AND ts >= now() - make_interval(days => :days)
GROUP BY 1
ORDER BY total_events DESC
"""

COURSE_DAILY_COMPLETIONS = """
SELECT
    (ts AT TIME ZONE 'UTC')::date AS date,
    count(*) AS completions,
    count(DISTINCT user_id) AS unique_completers
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND course_uuid = :course_uuid
    AND event_name = 'activity_completed'
    AND user_id <> 0
    AND ts >= now() - make_interval(days => :days)
GROUP BY date
ORDER BY date ASC
"""

COURSE_AVG_SESSION_DURATION = """
SELECT
    (ts AT TIME ZONE 'UTC')::date AS date,
    round((sum(least(seconds_spent::float8, 14400)) / greatest(count(DISTINCT user_id), 1))::numeric, 0)
        AS avg_seconds_per_user,
    sum(least(seconds_spent::float8, 14400)) AS total_seconds,
    count(DISTINCT user_id) AS unique_users
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND course_uuid = :course_uuid
    AND event_name = 'time_on_activity'
    AND seconds_spent > 0
    AND user_id <> 0
    AND ts >= now() - make_interval(days => :days)
GROUP BY date
ORDER BY date ASC
"""

COURSE_UNIQUE_VIEWERS = """
SELECT
    (ts AT TIME ZONE 'UTC')::date AS date,
    count(DISTINCT actor_key) FILTER (WHERE actor_key <> '') AS unique_viewers,
    count(*) AS total_views
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND course_uuid = :course_uuid
    AND event_name = 'course_view'
    AND ts >= now() - make_interval(days => :days)
GROUP BY date
ORDER BY date ASC
"""

# Course-level detail queries (return individual rows for PostgreSQL enrichment)
COURSE_RECENT_ENROLLMENTS = """
SELECT
    user_id,
    min(ts) AS enrolled_at
FROM analytics_event
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND course_uuid = :course_uuid
    AND event_name = 'course_enrolled'
    AND ts >= now() - make_interval(days => :days)
    AND user_id <> 0
GROUP BY user_id
ORDER BY enrolled_at DESC
LIMIT 50
"""

COURSE_QUERIES: dict[str, tuple[str, int]] = {
    "course_overview_stats": (COURSE_OVERVIEW_STATS, 30),
    "course_enrollment_trend": (COURSE_ENROLLMENT_TREND, 30),
    "course_activity_funnel": (COURSE_ACTIVITY_FUNNEL, 30),
    "course_learner_progress": (COURSE_LEARNER_PROGRESS, 90),
    "course_time_per_activity": (COURSE_TIME_PER_ACTIVITY, 30),
    "course_completion_velocity": (COURSE_COMPLETION_VELOCITY, 90),
    "course_active_learners": (COURSE_ACTIVE_LEARNERS, 30),
    "course_time_to_completion": (COURSE_TIME_TO_COMPLETION, 180),
    "course_certification_rate": (COURSE_CERTIFICATION_RATE, 90),
    "course_view_to_enrollment": (COURSE_VIEW_TO_ENROLLMENT, 30),
    "course_activity_type_breakdown": (COURSE_ACTIVITY_TYPE_BREAKDOWN, 30),
    "course_peak_hours": (COURSE_PEAK_HOURS, 30),
    "course_learner_retention": (COURSE_LEARNER_RETENTION, 90),
    "course_activity_dropoff": (COURSE_ACTIVITY_DROPOFF, 90),
    "course_engagement_by_type": (COURSE_ENGAGEMENT_BY_TYPE, 30),
    "course_daily_completions": (COURSE_DAILY_COMPLETIONS, 30),
    "course_avg_session_duration": (COURSE_AVG_SESSION_DURATION, 30),
    "course_unique_viewers": (COURSE_UNIQUE_VIEWERS, 30),
}

COURSE_DETAIL_QUERIES: dict[str, tuple[str, int]] = {
    "course_recent_enrollments": (COURSE_RECENT_ENROLLMENTS, 30),
    "course_top_learners": (COURSE_TOP_LEARNERS, 90),
}

ALL_QUERIES = {**CORE_QUERIES, **ADVANCED_QUERIES, **DETAIL_QUERIES}

# ---------------------------------------------------------------------------
# Superadmin queries (platform-wide page views, from the daily summary).
# Run with :org_id = 0 for every org.
# ---------------------------------------------------------------------------

SUPERADMIN_ORG_VISITS_RANK = """
SELECT
    org_id,
    sum(page_views)::bigint AS views
FROM analytics_daily_actor
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND day >= (now() AT TIME ZONE 'UTC' - make_interval(days => :days))::date
GROUP BY org_id
HAVING sum(page_views) > 0
ORDER BY views DESC
"""

SUPERADMIN_ORG_WEEKLY_VISITS = """
SELECT
    org_id,
    day AS date,
    sum(page_views)::bigint AS views
FROM analytics_daily_actor
WHERE
    (:org_id = 0 OR org_id = :org_id)
    AND day >= (now() AT TIME ZONE 'UTC' - make_interval(days => :days))::date
GROUP BY org_id, day
HAVING sum(page_views) > 0
ORDER BY org_id, date ASC
"""

SUPERADMIN_QUERIES: dict[str, tuple[str, int]] = {
    "superadmin_org_visits_rank": (SUPERADMIN_ORG_VISITS_RANK, 30),
    "superadmin_org_weekly_visits": (SUPERADMIN_ORG_WEEKLY_VISITS, 7),
}

# ---------------------------------------------------------------------------
# Per-user queries (behavioral enrichment for the student audit dossier).
# Parameterized by :org_id, :user_id and :days. Used ONLY by the audit
# router, never exposed on the public analytics dashboard.
# ---------------------------------------------------------------------------

USER_TIME_TOTAL = """
SELECT
    coalesce(sum(seconds_spent::float8), 0)::bigint AS total_seconds,
    count(DISTINCT activity_uuid) AS activities_touched
FROM analytics_event
WHERE org_id = :org_id
    AND user_id = :user_id
    AND event_name = 'time_on_activity'
    AND ts >= now() - make_interval(days => :days)
"""

USER_TIME_BY_COURSE = """
SELECT
    course_uuid,
    coalesce(sum(seconds_spent::float8), 0)::bigint AS total_seconds
FROM analytics_event
WHERE org_id = :org_id
    AND user_id = :user_id
    AND event_name = 'time_on_activity'
    AND course_uuid <> ''
    AND ts >= now() - make_interval(days => :days)
GROUP BY course_uuid
ORDER BY total_seconds DESC
"""

USER_VIEWS = """
SELECT
    event_name,
    count(*) AS count
FROM analytics_event
WHERE org_id = :org_id
    AND user_id = :user_id
    AND event_name IN ('page_view', 'course_view', 'activity_view')
    AND ts >= now() - make_interval(days => :days)
GROUP BY event_name
"""

USER_SEARCHES = """
SELECT
    coalesce(properties->>'query', '') AS query,
    count(*) AS count,
    max(ts) AS last_searched
FROM analytics_event
WHERE org_id = :org_id
    AND user_id = :user_id
    AND event_name = 'search_query'
    AND ts >= now() - make_interval(days => :days)
GROUP BY 1
ORDER BY count DESC
LIMIT 50
"""

USER_DAILY_ACTIVITY = """
SELECT
    (ts AT TIME ZONE 'UTC')::date AS day,
    count(*) AS events,
    coalesce(sum(seconds_spent::float8) FILTER (WHERE event_name = 'time_on_activity'), 0)::bigint AS seconds
FROM analytics_event
WHERE org_id = :org_id
    AND user_id = :user_id
    AND ts >= now() - make_interval(days => :days)
GROUP BY 1
ORDER BY 1
"""

# name -> (sql, default_days)
USER_QUERIES: dict[str, tuple[str, int]] = {
    "user_time_total": (USER_TIME_TOTAL, 365),
    "user_time_by_course": (USER_TIME_BY_COURSE, 365),
    "user_views": (USER_VIEWS, 365),
    "user_searches": (USER_SEARCHES, 365),
    "user_daily_activity": (USER_DAILY_ACTIVITY, 365),
}
