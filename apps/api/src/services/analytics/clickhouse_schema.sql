-- LearnHouse analytics — ClickHouse schema
--
-- Run this once against your ClickHouse database before enabling the
-- ClickHouse analytics backend. The table name must match
-- LEARNHOUSE_CLICKHOUSE_EVENTS_TABLE (default: "events").
--
-- Example:
--   clickhouse-client --database=default --query="$(cat clickhouse_schema.sql)"
--
-- Column choices mirror what the Tinybird datasource stored, so every SQL
-- template in queries.py works unchanged against this table.

CREATE TABLE IF NOT EXISTS events
(
    event_name  LowCardinality(String),
    timestamp   DateTime,
    org_id      UInt32,
    user_id     UInt32,
    session_id  String,
    properties  String,           -- JSON-encoded; queries use JSONExtract* functions
    source      LowCardinality(String),
    ip          String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (org_id, event_name, timestamp)
TTL timestamp + INTERVAL 2 YEAR;
