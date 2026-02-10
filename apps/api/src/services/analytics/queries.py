"""
SQL queries for ClickHouse analytics dashboard.

Parameters use Python .format() placeholders: {org_id}, {days}.
The org_id filter uses (0 = 0 OR org_id = 0) pattern for multi-org support:
  - org_id=0 → returns all orgs
  - org_id=N → filters to org N
"""

# ---------------------------------------------------------------------------
# Core pipes (available to all plans)
# ---------------------------------------------------------------------------

LIVE_USERS = """
SELECT
    org_id,
    uniqExact(user_id) AS live_users
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND timestamp >= now() - INTERVAL 5 MINUTE
GROUP BY org_id
"""

DAILY_ACTIVE_USERS = """
SELECT
    org_id,
    toDate(timestamp) AS date,
    uniqExact(user_id) AS dau
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY org_id, date
ORDER BY date ASC
"""

TOP_COURSES = """
SELECT
    org_id,
    JSONExtractString(properties, 'course_uuid') AS course_uuid,
    uniqExactIf(user_id, event_name = 'course_view') AS views,
    uniqExactIf(user_id, event_name = 'course_enrolled') AS enrollments,
    uniqExactIf(user_id, event_name = 'course_completed') AS completions
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND event_name IN ('course_view', 'course_enrolled', 'course_completed')
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY org_id, course_uuid
ORDER BY views DESC
LIMIT 20
"""

ENROLLMENT_FUNNEL = """
SELECT
    org_id,
    uniqExactIf(user_id, event_name = 'page_view') AS page_views,
    uniqExactIf(user_id, event_name = 'course_view') AS course_views,
    uniqExactIf(user_id, event_name = 'course_enrolled') AS enrollments,
    uniqExactIf(user_id, event_name = 'course_completed') AS completions
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY org_id
"""

EVENT_COUNTS = """
SELECT
    org_id,
    event_name,
    count() AS total,
    uniqExact(user_id) AS unique_users
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY org_id, event_name
ORDER BY total DESC
"""

VISITORS_BY_COUNTRY = """
SELECT
    org_id,
    JSONExtractString(properties, 'country_code') AS country_code,
    count() AS visits,
    uniqExact(user_id) AS unique_users
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND event_name = 'page_view'
    AND JSONExtractString(properties, 'country_code') != ''
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY org_id, country_code
ORDER BY visits DESC
LIMIT 20
"""

VISITORS_BY_DEVICE = """
SELECT
    org_id,
    JSONExtractString(properties, 'device_type') AS device_type,
    count() AS visits,
    uniqExact(user_id) AS unique_users
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND event_name = 'page_view'
    AND JSONExtractString(properties, 'device_type') != ''
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY org_id, device_type
ORDER BY visits DESC
"""

VISITORS_BY_REFERRER = """
SELECT
    org_id,
    JSONExtractString(properties, 'referrer_domain') AS referrer_domain,
    count() AS visits,
    uniqExact(user_id) AS unique_users
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND event_name = 'page_view'
    AND JSONExtractString(properties, 'referrer_domain') != ''
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY org_id, referrer_domain
ORDER BY visits DESC
LIMIT 20
"""

DAILY_VISITOR_BREAKDOWN = """
SELECT
    org_id,
    toDate(timestamp) AS date,
    uniqExact(user_id) AS dau,
    countIf(JSONExtractString(properties, 'device_type') = 'desktop') AS desktop,
    countIf(JSONExtractString(properties, 'device_type') = 'mobile') AS mobile,
    countIf(JSONExtractString(properties, 'device_type') = 'tablet') AS tablet,
    topK(3)(JSONExtractString(properties, 'country_code')) AS top_countries,
    topK(1)(JSONExtractString(properties, 'referrer_domain')) AS top_referrer
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND event_name = 'page_view'
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY org_id, date
ORDER BY date ASC
"""

ACTIVITY_ENGAGEMENT = """
SELECT
    org_id,
    JSONExtractString(properties, 'activity_uuid') AS activity_uuid,
    anyIf(JSONExtractString(properties, 'activity_type'), JSONExtractString(properties, 'activity_type') != '') AS activity_type,
    anyIf(JSONExtractString(properties, 'course_uuid'), JSONExtractString(properties, 'course_uuid') != '') AS course_uuid,
    uniqExactIf(user_id, event_name = 'activity_view') AS views,
    uniqExactIf(user_id, event_name = 'activity_completed') AS completions,
    if(count() > 0,
       avgIf(
           JSONExtractFloat(properties, 'seconds_spent'),
           event_name = 'time_on_activity' AND JSONExtractFloat(properties, 'seconds_spent') > 0
       ),
       0) AS avg_seconds_spent
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND event_name IN ('activity_view', 'activity_completed', 'time_on_activity')
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY org_id, activity_uuid
ORDER BY views DESC
LIMIT 50
"""

# ---------------------------------------------------------------------------
# Advanced pipes (Pro+ plans only)
# ---------------------------------------------------------------------------

COURSE_DROPOFF = """
WITH enrolled AS (
    SELECT DISTINCT org_id, user_id, JSONExtractString(properties, 'course_uuid') AS course_uuid
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id}) AND event_name = 'course_enrolled'
        AND timestamp >= now() - INTERVAL {days} DAY
),
completed AS (
    SELECT DISTINCT org_id, user_id, JSONExtractString(properties, 'course_uuid') AS course_uuid
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id}) AND event_name = 'course_completed'
        AND timestamp >= now() - INTERVAL {days} DAY
),
last_activity AS (
    SELECT
        org_id,
        user_id,
        JSONExtractString(properties, 'course_uuid') AS course_uuid,
        argMax(JSONExtractString(properties, 'activity_uuid'), timestamp) AS last_activity_uuid
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id}) AND event_name = 'activity_completed'
        AND timestamp >= now() - INTERVAL {days} DAY
    GROUP BY org_id, user_id, course_uuid
)
SELECT
    la.org_id,
    la.course_uuid,
    la.last_activity_uuid,
    count() AS dropoff_count
FROM enrolled e
LEFT ANTI JOIN completed c ON e.user_id = c.user_id AND e.course_uuid = c.course_uuid AND e.org_id = c.org_id
INNER JOIN last_activity la ON e.user_id = la.user_id AND e.course_uuid = la.course_uuid AND e.org_id = la.org_id
GROUP BY la.org_id, la.course_uuid, la.last_activity_uuid
ORDER BY dropoff_count DESC
"""

COHORT_RETENTION = """
WITH signups AS (
    SELECT
        org_id,
        user_id,
        toStartOfWeek(timestamp) AS cohort_week
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id}) AND event_name = 'user_signed_up'
        AND timestamp >= now() - INTERVAL {days} DAY
),
activity AS (
    SELECT DISTINCT
        org_id,
        user_id,
        toStartOfWeek(timestamp) AS active_week
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id})
        AND timestamp >= now() - INTERVAL {days} DAY
)
SELECT
    s.org_id,
    s.cohort_week,
    count(DISTINCT s.user_id) AS cohort_size,
    uniqExactIf(s.user_id, dateDiff('week', s.cohort_week, a.active_week) = 1) AS week_1,
    uniqExactIf(s.user_id, dateDiff('week', s.cohort_week, a.active_week) = 2) AS week_2,
    uniqExactIf(s.user_id, dateDiff('week', s.cohort_week, a.active_week) = 4) AS week_4,
    uniqExactIf(s.user_id, dateDiff('week', s.cohort_week, a.active_week) = 8) AS week_8
FROM signups s
LEFT JOIN activity a ON s.user_id = a.user_id AND s.org_id = a.org_id
GROUP BY s.org_id, s.cohort_week
ORDER BY s.cohort_week ASC
"""

TIME_TO_COMPLETION = """
WITH enrollments AS (
    SELECT
        org_id,
        user_id,
        JSONExtractString(properties, 'course_uuid') AS course_uuid,
        min(timestamp) AS enrolled_at
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id}) AND event_name = 'course_enrolled'
        AND timestamp >= now() - INTERVAL {days} DAY
    GROUP BY org_id, user_id, course_uuid
),
completions AS (
    SELECT
        org_id,
        user_id,
        JSONExtractString(properties, 'course_uuid') AS course_uuid,
        min(timestamp) AS completed_at
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id}) AND event_name = 'course_completed'
        AND timestamp >= now() - INTERVAL {days} DAY
    GROUP BY org_id, user_id, course_uuid
)
SELECT
    e.org_id,
    e.course_uuid,
    median(dateDiff('day', e.enrolled_at, c.completed_at)) AS median_days,
    count() AS completions_count
FROM enrollments e
INNER JOIN completions c ON e.user_id = c.user_id AND e.course_uuid = c.course_uuid AND e.org_id = c.org_id
GROUP BY e.org_id, e.course_uuid
ORDER BY median_days ASC
"""

PEAK_USAGE_HOURS = """
SELECT
    org_id,
    toDayOfWeek(timestamp) AS day_of_week,
    toHour(timestamp) AS hour_of_day,
    count() AS event_count
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY org_id, day_of_week, hour_of_day
ORDER BY day_of_week, hour_of_day
"""

CONTENT_TYPE_EFFECTIVENESS = """
WITH views AS (
    SELECT
        org_id,
        JSONExtractString(properties, 'activity_type') AS activity_type,
        uniqExact(user_id) AS view_count
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id}) AND event_name = 'activity_view'
        AND timestamp >= now() - INTERVAL {days} DAY
    GROUP BY org_id, activity_type
),
completions AS (
    SELECT
        org_id,
        JSONExtractString(properties, 'activity_type') AS activity_type,
        uniqExact(user_id) AS completion_count
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id}) AND event_name = 'activity_completed'
        AND timestamp >= now() - INTERVAL {days} DAY
    GROUP BY org_id, activity_type
)
SELECT
    v.org_id,
    v.activity_type,
    v.view_count,
    coalesce(c.completion_count, 0) AS completion_count,
    if(v.view_count > 0, round(coalesce(c.completion_count, 0) / v.view_count * 100, 1), 0) AS completion_rate
FROM views v
LEFT JOIN completions c ON v.activity_type = c.activity_type AND v.org_id = c.org_id
ORDER BY completion_rate DESC
"""

NEW_VS_RETURNING = """
WITH first_seen AS (
    SELECT org_id, user_id, min(toDate(timestamp)) AS first_date
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id})
    GROUP BY org_id, user_id
),
daily_users AS (
    SELECT DISTINCT org_id, user_id, toDate(timestamp) AS date
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id})
        AND timestamp >= now() - INTERVAL {days} DAY
)
SELECT
    d.org_id,
    d.date,
    countIf(d.date = f.first_date) AS new_users,
    countIf(d.date > f.first_date) AS returning_users
FROM daily_users d
INNER JOIN first_seen f ON d.user_id = f.user_id AND d.org_id = f.org_id
GROUP BY d.org_id, d.date
ORDER BY d.date ASC
"""

COMPLETION_VELOCITY = """
WITH ordered AS (
    SELECT
        org_id,
        user_id,
        JSONExtractString(properties, 'course_uuid') AS course_uuid,
        timestamp,
        lagInFrame(timestamp) OVER (
            PARTITION BY org_id, user_id, JSONExtractString(properties, 'course_uuid')
            ORDER BY timestamp
        ) AS prev_ts
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id}) AND event_name = 'activity_completed'
        AND timestamp >= now() - INTERVAL {days} DAY
)
SELECT
    org_id,
    course_uuid,
    if(count() > 0, round(avg(dateDiff('hour', prev_ts, timestamp)), 1), 0) AS avg_hours_between,
    count() AS transitions
FROM ordered
WHERE prev_ts > toDateTime('2020-01-01 00:00:00')
GROUP BY org_id, course_uuid
ORDER BY avg_hours_between ASC
"""

COMMUNITY_CORRELATION = """
WITH discussors AS (
    SELECT DISTINCT org_id, user_id
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id}) AND event_name = 'discussion_posted'
        AND timestamp >= now() - INTERVAL {days} DAY
),
enrolled AS (
    SELECT DISTINCT org_id, user_id
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id}) AND event_name = 'course_enrolled'
        AND timestamp >= now() - INTERVAL {days} DAY
),
completed AS (
    SELECT DISTINCT org_id, user_id
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id}) AND event_name = 'course_completed'
        AND timestamp >= now() - INTERVAL {days} DAY
)
SELECT
    e.org_id,
    'discussors' AS group_name,
    count(DISTINCT e.user_id) AS enrolled_count,
    count(DISTINCT c.user_id) AS completed_count,
    if(enrolled_count > 0, round(completed_count / enrolled_count * 100, 1), 0) AS completion_rate
FROM enrolled e
INNER JOIN discussors d ON e.user_id = d.user_id AND e.org_id = d.org_id
LEFT JOIN completed c ON e.user_id = c.user_id AND e.org_id = c.org_id
GROUP BY e.org_id
UNION ALL
SELECT
    e.org_id,
    'non_discussors' AS group_name,
    count(DISTINCT e.user_id) AS enrolled_count,
    count(DISTINCT c.user_id) AS completed_count,
    if(enrolled_count > 0, round(completed_count / enrolled_count * 100, 1), 0) AS completion_rate
FROM enrolled e
LEFT ANTI JOIN discussors d ON e.user_id = d.user_id AND e.org_id = d.org_id
LEFT JOIN completed c ON e.user_id = c.user_id AND e.org_id = c.org_id
GROUP BY e.org_id
"""

USER_PROGRESS_SNAPSHOT = """
WITH user_activities AS (
    SELECT
        org_id,
        user_id,
        JSONExtractString(properties, 'course_uuid') AS course_uuid,
        countIf(event_name = 'activity_completed') AS completed_activities
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id})
        AND event_name IN ('course_enrolled', 'activity_completed')
        AND timestamp >= now() - INTERVAL {days} DAY
    GROUP BY org_id, user_id, course_uuid
)
SELECT
    org_id,
    course_uuid,
    multiIf(
        completed_activities = 0, '0%',
        completed_activities <= 2, '1-25%',
        completed_activities <= 5, '26-50%',
        completed_activities <= 8, '51-75%',
        '76-100%'
    ) AS bracket,
    count() AS user_count
FROM user_activities
GROUP BY org_id, course_uuid, bracket
ORDER BY course_uuid, bracket
"""

SEARCH_EFFECTIVENESS = """
SELECT
    org_id,
    JSONExtractString(properties, 'query') AS query,
    count() AS search_count,
    countIf(JSONExtractInt(properties, 'results_count') = 0) AS zero_results,
    if(search_count > 0, round(zero_results / search_count * 100, 1), 0) AS zero_result_rate
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND event_name = 'search_query'
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY org_id, query
ORDER BY search_count DESC
LIMIT 50
"""

CERTIFICATION_RATE = """
WITH completers AS (
    SELECT
        org_id,
        JSONExtractString(properties, 'course_uuid') AS course_uuid,
        count(DISTINCT user_id) AS completions
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id}) AND event_name = 'course_completed'
        AND timestamp >= now() - INTERVAL {days} DAY
    GROUP BY org_id, course_uuid
),
cert_claims AS (
    SELECT
        org_id,
        JSONExtractString(properties, 'course_uuid') AS course_uuid,
        count(DISTINCT user_id) AS claims
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id}) AND event_name = 'certificate_claimed'
        AND timestamp >= now() - INTERVAL {days} DAY
    GROUP BY org_id, course_uuid
)
SELECT
    c.org_id,
    c.course_uuid,
    c.completions,
    coalesce(cc.claims, 0) AS claims,
    if(c.completions > 0, round(coalesce(cc.claims, 0) / c.completions * 100, 1), 0) AS claim_rate
FROM completers c
LEFT JOIN cert_claims cc ON c.course_uuid = cc.course_uuid AND c.org_id = cc.org_id
ORDER BY c.completions DESC
"""

ORG_GROWTH_TREND = """
SELECT
    org_id,
    toStartOfWeek(timestamp) AS week,
    countIf(event_name = 'user_signed_up') AS signups,
    uniqExactIf(user_id, event_name = 'course_enrolled') AS enrollments,
    uniqExactIf(user_id, event_name = 'course_completed') AS completions
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND timestamp >= now() - INTERVAL {days} DAY
    AND event_name IN ('user_signed_up', 'course_enrolled', 'course_completed')
GROUP BY org_id, week
ORDER BY week ASC
"""

LEARNER_ENGAGEMENT_SCORE = """
SELECT
    org_id,
    user_id,
    uniqExactIf(JSONExtractString(properties, 'path'), event_name = 'page_view') AS page_views,
    uniqExactIf(JSONExtractString(properties, 'activity_uuid'), event_name = 'activity_completed') AS activities_completed,
    uniqExactIf(JSONExtractString(properties, 'course_uuid'), event_name = 'course_completed') AS courses_completed,
    sumIf(JSONExtractFloat(properties, 'seconds_spent'), event_name = 'time_on_activity') AS total_time_spent,
    (
        uniqExactIf(JSONExtractString(properties, 'path'), event_name = 'page_view') * 1
        + uniqExactIf(JSONExtractString(properties, 'activity_uuid'), event_name = 'activity_completed') * 10
        + uniqExactIf(JSONExtractString(properties, 'course_uuid'), event_name = 'course_completed') * 50
        + least(sumIf(JSONExtractFloat(properties, 'seconds_spent'), event_name = 'time_on_activity') / 3600, 100) * 5
    ) AS engagement_score
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND timestamp >= now() - INTERVAL {days} DAY
    AND user_id != 0
GROUP BY org_id, user_id
ORDER BY engagement_score DESC
LIMIT 100
"""

COURSE_RATING_BY_COMPLETION = """
WITH course_stats AS (
    SELECT
        org_id,
        JSONExtractString(properties, 'course_uuid') AS course_uuid,
        uniqExactIf(user_id, event_name = 'course_enrolled') AS enrollments,
        uniqExactIf(user_id, event_name = 'course_completed') AS completions,
        uniqExactIf(JSONExtractString(properties, 'activity_uuid'), event_name = 'activity_view') AS activity_count
    FROM events
    WHERE ({org_id} = 0 OR org_id = {org_id})
        AND event_name IN ('course_enrolled', 'course_completed', 'activity_view')
        AND timestamp >= now() - INTERVAL {days} DAY
    GROUP BY org_id, course_uuid
)
SELECT
    org_id,
    course_uuid,
    enrollments,
    completions,
    activity_count,
    if(enrollments > 0, round(completions / enrollments * 100, 1), 0) AS completion_rate
FROM course_stats
WHERE enrollments >= 5
ORDER BY enrollments DESC
"""

# ---------------------------------------------------------------------------
# Detail queries (stat-card drill-down, return individual rows for enrichment)
# ---------------------------------------------------------------------------

DETAIL_LIVE_USERS = """
SELECT
    user_id,
    anyLast(JSONExtractString(properties, 'path')) AS path,
    anyLast(JSONExtractString(properties, 'device_type')) AS device_type,
    anyLast(JSONExtractString(properties, 'country_code')) AS country_code,
    max(timestamp) AS last_seen
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND event_name = 'page_view'
    AND timestamp >= now() - INTERVAL 5 MINUTE
    AND user_id != 0
GROUP BY user_id
ORDER BY last_seen DESC
LIMIT 200
"""

DETAIL_SIGNUPS = """
SELECT
    user_id,
    JSONExtractString(properties, 'signup_method') AS signup_method,
    timestamp
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND event_name = 'user_signed_up'
    AND timestamp >= now() - INTERVAL {days} DAY
    AND user_id != 0
ORDER BY timestamp DESC
LIMIT 200
"""

DETAIL_ENROLLMENTS = """
SELECT
    user_id,
    JSONExtractString(properties, 'course_uuid') AS course_uuid,
    min(timestamp) AS timestamp
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND event_name = 'course_enrolled'
    AND timestamp >= now() - INTERVAL {days} DAY
    AND user_id != 0
GROUP BY user_id, course_uuid
ORDER BY timestamp DESC
LIMIT 200
"""

DETAIL_COMPLETIONS = """
SELECT
    user_id,
    JSONExtractString(properties, 'course_uuid') AS course_uuid,
    timestamp
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND event_name = 'course_completed'
    AND timestamp >= now() - INTERVAL {days} DAY
    AND user_id != 0
ORDER BY timestamp DESC
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
# Registry — maps query names to (sql_template, default_days)
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
# Course-level queries (Pro only — filtered by course_uuid)
# ---------------------------------------------------------------------------

COURSE_OVERVIEW_STATS = """
SELECT
    uniqExactIf(user_id, event_name = 'course_view') AS views,
    uniqExactIf(user_id, event_name = 'course_enrolled') AS enrollments,
    uniqExactIf(user_id, event_name = 'course_completed') AS completions,
    if(uniqExactIf(user_id, event_name = 'course_enrolled') > 0,
       round(uniqExactIf(user_id, event_name = 'course_completed') / uniqExactIf(user_id, event_name = 'course_enrolled') * 100, 1),
       0) AS completion_rate
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
    AND event_name IN ('course_view', 'course_enrolled', 'course_completed')
    AND timestamp >= now() - INTERVAL {days} DAY
"""

COURSE_ENROLLMENT_TREND = """
SELECT
    toDate(timestamp) AS date,
    uniqExact(user_id) AS enrollments
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
    AND event_name = 'course_enrolled'
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY date
ORDER BY date ASC
"""

COURSE_ACTIVITY_FUNNEL = """
SELECT
    JSONExtractString(properties, 'activity_uuid') AS activity_uuid,
    uniqExactIf(user_id, event_name = 'activity_view') AS views,
    uniqExactIf(user_id, event_name = 'activity_completed') AS completions,
    if(uniqExactIf(user_id, event_name = 'activity_view') > 0,
       round(uniqExactIf(user_id, event_name = 'activity_completed') / uniqExactIf(user_id, event_name = 'activity_view') * 100, 1),
       0) AS completion_rate
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
    AND event_name IN ('activity_view', 'activity_completed')
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY activity_uuid
ORDER BY views DESC
"""

COURSE_LEARNER_PROGRESS = """
WITH user_completions AS (
    SELECT
        user_id,
        count() AS completed_activities
    FROM events
    WHERE
        ({org_id} = 0 OR org_id = {org_id})
        AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
        AND event_name = 'activity_completed'
        AND timestamp >= now() - INTERVAL {days} DAY
    GROUP BY user_id
)
SELECT
    multiIf(
        completed_activities = 0, '0',
        completed_activities <= 2, '1-2',
        completed_activities <= 5, '3-5',
        completed_activities <= 10, '6-10',
        '11+'
    ) AS bracket,
    count() AS user_count
FROM user_completions
GROUP BY bracket
ORDER BY bracket
"""

COURSE_TIME_PER_ACTIVITY = """
SELECT
    JSONExtractString(properties, 'activity_uuid') AS activity_uuid,
    if(count() > 0,
       round(avg(if(JSONExtractFloat(properties, 'seconds_spent') > 0, JSONExtractFloat(properties, 'seconds_spent'), 0)), 1),
       0) AS avg_seconds_spent,
    count() AS samples
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
    AND event_name = 'time_on_activity'
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY activity_uuid
ORDER BY avg_seconds_spent DESC
"""

COURSE_COMPLETION_VELOCITY = """
WITH ordered AS (
    SELECT
        user_id,
        timestamp,
        lagInFrame(timestamp) OVER (
            PARTITION BY user_id
            ORDER BY timestamp
        ) AS prev_ts
    FROM events
    WHERE
        ({org_id} = 0 OR org_id = {org_id})
        AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
        AND event_name = 'activity_completed'
        AND timestamp >= now() - INTERVAL {days} DAY
)
SELECT
    if(count() > 0, round(avg(dateDiff('hour', prev_ts, timestamp)), 1), 0) AS avg_hours_between,
    count() AS transitions
FROM ordered
WHERE prev_ts > toDateTime('2020-01-01 00:00:00')
"""

COURSE_ACTIVE_LEARNERS = """
SELECT
    toDate(timestamp) AS date,
    uniqExact(user_id) AS active_learners
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY date
ORDER BY date ASC
"""

COURSE_TIME_TO_COMPLETION = """
WITH enrollments AS (
    SELECT
        user_id,
        min(timestamp) AS enrolled_at
    FROM events
    WHERE
        ({org_id} = 0 OR org_id = {org_id})
        AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
        AND event_name = 'course_enrolled'
        AND timestamp >= now() - INTERVAL {days} DAY
    GROUP BY user_id
),
completions AS (
    SELECT
        user_id,
        min(timestamp) AS completed_at
    FROM events
    WHERE
        ({org_id} = 0 OR org_id = {org_id})
        AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
        AND event_name = 'course_completed'
        AND timestamp >= now() - INTERVAL {days} DAY
    GROUP BY user_id
)
SELECT
    median(dateDiff('day', e.enrolled_at, c.completed_at)) AS median_days,
    count() AS completions_count,
    quantile(0.25)(dateDiff('day', e.enrolled_at, c.completed_at)) AS p25_days,
    quantile(0.75)(dateDiff('day', e.enrolled_at, c.completed_at)) AS p75_days
FROM enrollments e
INNER JOIN completions c ON e.user_id = c.user_id
"""

COURSE_CERTIFICATION_RATE = """
WITH completers AS (
    SELECT count(DISTINCT user_id) AS completions
    FROM events
    WHERE
        ({org_id} = 0 OR org_id = {org_id})
        AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
        AND event_name = 'course_completed'
        AND timestamp >= now() - INTERVAL {days} DAY
),
cert_claims AS (
    SELECT count(DISTINCT user_id) AS claims
    FROM events
    WHERE
        ({org_id} = 0 OR org_id = {org_id})
        AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
        AND event_name = 'certificate_claimed'
        AND timestamp >= now() - INTERVAL {days} DAY
)
SELECT
    completers.completions,
    cert_claims.claims,
    if(completers.completions > 0, round(cert_claims.claims / completers.completions * 100, 1), 0) AS claim_rate
FROM completers, cert_claims
"""

# ---------------------------------------------------------------------------
# Course-level queries — batch 2 (10 additional visuals)
# ---------------------------------------------------------------------------

COURSE_VIEW_TO_ENROLLMENT = """
SELECT
    toDate(timestamp) AS date,
    uniqExactIf(user_id, event_name = 'course_view') AS views,
    uniqExactIf(user_id, event_name = 'course_enrolled') AS enrollments,
    if(uniqExactIf(user_id, event_name = 'course_view') > 0,
       round(uniqExactIf(user_id, event_name = 'course_enrolled') / uniqExactIf(user_id, event_name = 'course_view') * 100, 1),
       0) AS conversion_rate
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
    AND event_name IN ('course_view', 'course_enrolled')
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY date
ORDER BY date ASC
"""

COURSE_ACTIVITY_TYPE_BREAKDOWN = """
SELECT
    JSONExtractString(properties, 'activity_type') AS activity_type,
    uniqExactIf(user_id, event_name = 'activity_view') AS views,
    uniqExactIf(user_id, event_name = 'activity_completed') AS completions,
    if(uniqExactIf(user_id, event_name = 'activity_view') > 0,
       round(uniqExactIf(user_id, event_name = 'activity_completed') / uniqExactIf(user_id, event_name = 'activity_view') * 100, 1),
       0) AS completion_rate
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
    AND event_name IN ('activity_view', 'activity_completed')
    AND JSONExtractString(properties, 'activity_type') != ''
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY activity_type
ORDER BY views DESC
"""

COURSE_PEAK_HOURS = """
SELECT
    toHour(timestamp) AS hour,
    toDayOfWeek(timestamp) AS day_of_week,
    count() AS event_count
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
    AND event_name IN ('activity_view', 'activity_completed', 'time_on_activity')
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY hour, day_of_week
ORDER BY day_of_week, hour
"""

COURSE_LEARNER_RETENTION = """
WITH first_activity AS (
    SELECT
        user_id,
        min(toDate(timestamp)) AS first_day
    FROM events
    WHERE
        ({org_id} = 0 OR org_id = {org_id})
        AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
        AND event_name IN ('activity_view', 'activity_completed')
        AND timestamp >= now() - INTERVAL {days} DAY
    GROUP BY user_id
),
daily_activity AS (
    SELECT DISTINCT
        user_id,
        toDate(timestamp) AS active_day
    FROM events
    WHERE
        ({org_id} = 0 OR org_id = {org_id})
        AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
        AND event_name IN ('activity_view', 'activity_completed')
        AND timestamp >= now() - INTERVAL {days} DAY
)
SELECT
    dateDiff('day', f.first_day, d.active_day) AS days_since_start,
    uniqExact(d.user_id) AS active_users,
    (SELECT uniqExact(user_id) FROM first_activity) AS cohort_size
FROM first_activity f
INNER JOIN daily_activity d ON f.user_id = d.user_id
WHERE dateDiff('day', f.first_day, d.active_day) <= 30
GROUP BY days_since_start
ORDER BY days_since_start
"""

COURSE_TOP_LEARNERS = """
SELECT
    user_id,
    uniqExactIf(
        JSONExtractString(properties, 'activity_uuid'),
        event_name = 'activity_completed'
    ) AS completions,
    uniqExactIf(
        JSONExtractString(properties, 'activity_uuid'),
        event_name = 'activity_view'
    ) AS views,
    uniqExactIf(
        JSONExtractString(properties, 'activity_uuid'),
        event_name = 'activity_completed'
    ) AS unique_activities_completed,
    if(countIf(event_name = 'time_on_activity') > 0,
       sumIf(
           JSONExtractFloat(properties, 'seconds_spent'),
           event_name = 'time_on_activity'
       ), 0) AS total_seconds_spent
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
    AND event_name IN ('activity_completed', 'activity_view', 'time_on_activity')
    AND timestamp >= now() - INTERVAL {days} DAY
    AND user_id != 0
GROUP BY user_id
ORDER BY completions DESC, views DESC
LIMIT 20
"""

COURSE_ACTIVITY_DROPOFF = """
WITH user_activities AS (
    SELECT
        user_id,
        JSONExtractString(properties, 'activity_uuid') AS activity_uuid,
        min(timestamp) AS first_completed_at
    FROM events
    WHERE
        ({org_id} = 0 OR org_id = {org_id})
        AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
        AND event_name = 'activity_completed'
        AND timestamp >= now() - INTERVAL {days} DAY
    GROUP BY user_id, activity_uuid
),
user_max_activity AS (
    SELECT
        user_id,
        max(first_completed_at) AS last_activity_at,
        argMax(activity_uuid, first_completed_at) AS last_activity_uuid,
        count() AS total_completed
    FROM user_activities
    GROUP BY user_id
)
SELECT
    last_activity_uuid AS activity_uuid,
    count() AS users_stopped_here,
    if(count() > 0, avg(total_completed), 0) AS avg_completed_before_stop
FROM user_max_activity
GROUP BY last_activity_uuid
ORDER BY users_stopped_here DESC
LIMIT 20
"""

COURSE_ENGAGEMENT_BY_TYPE = """
SELECT
    JSONExtractString(properties, 'activity_type') AS activity_type,
    uniqExact(user_id) AS unique_learners,
    count() AS total_events,
    uniqExactIf(user_id, event_name = 'activity_completed') AS completions,
    if(countIf(event_name = 'time_on_activity') > 0,
       avgIf(
           JSONExtractFloat(properties, 'seconds_spent'),
           event_name = 'time_on_activity' AND JSONExtractFloat(properties, 'seconds_spent') > 0
       ),
       0) AS avg_seconds_spent
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
    AND event_name IN ('activity_view', 'activity_completed', 'time_on_activity')
    AND JSONExtractString(properties, 'activity_type') != ''
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY activity_type
ORDER BY total_events DESC
"""

COURSE_DAILY_COMPLETIONS = """
SELECT
    toDate(timestamp) AS date,
    count() AS completions,
    uniqExact(user_id) AS unique_completers
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
    AND event_name = 'activity_completed'
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY date
ORDER BY date ASC
"""

COURSE_AVG_SESSION_DURATION = """
SELECT
    toDate(timestamp) AS date,
    round(sum(JSONExtractFloat(properties, 'seconds_spent')) / greatest(uniqExact(user_id), 1), 0) AS avg_seconds_per_user,
    sum(JSONExtractFloat(properties, 'seconds_spent')) AS total_seconds,
    uniqExact(user_id) AS unique_users
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
    AND event_name = 'time_on_activity'
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY date
ORDER BY date ASC
"""

COURSE_UNIQUE_VIEWERS = """
SELECT
    toDate(timestamp) AS date,
    uniqExact(user_id) AS unique_viewers,
    count() AS total_views
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
    AND event_name = 'course_view'
    AND timestamp >= now() - INTERVAL {days} DAY
GROUP BY date
ORDER BY date ASC
"""

# Course-level detail queries (return individual rows for PostgreSQL enrichment)
COURSE_RECENT_ENROLLMENTS = """
SELECT
    user_id,
    min(timestamp) AS timestamp
FROM events
WHERE
    ({org_id} = 0 OR org_id = {org_id})
    AND JSONExtractString(properties, 'course_uuid') = '{course_uuid}'
    AND event_name = 'course_enrolled'
    AND timestamp >= now() - INTERVAL {days} DAY
    AND user_id != 0
GROUP BY user_id
ORDER BY timestamp DESC
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
