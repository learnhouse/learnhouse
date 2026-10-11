"""Debounced indexing queue."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.ai.rag import queue
from src.services.ai.rag.types import ContentRef
from src.tests.services.rag_helpers import ActivitySubTypeEnum, ActivityTypeEnum, add_activity


@pytest.fixture
def rag_dispatch():
    """Override the suite-wide stub: these tests exercise the real dispatch."""
    yield None


class FakeRedis:
    """The sorted-set and set subset the queue uses."""

    def __init__(self):
        self.due: dict[str, float] = {}
        self.transcribe: set[str] = set()

    def sadd(self, key, *members):
        assert key == queue.TRANSCRIBE_KEY
        self.transcribe.update(members)

    def srem(self, key, member):
        assert key == queue.TRANSCRIBE_KEY
        if member in self.transcribe:
            self.transcribe.discard(member)
            return 1
        return 0

    def zadd(self, key, mapping):
        assert key == queue.REDIS_KEY
        self.due.update(mapping)

    def zrangebyscore(self, key, low, high, start=0, num=None):
        members = sorted((score, member) for member, score in self.due.items() if low <= score <= high)
        return [member.encode() for _, member in members][start:start + num if num else None]

    def zrem(self, key, member):
        return 1 if self.due.pop(member, None) is not None else 0


@pytest.fixture
def redis(monkeypatch):
    client = FakeRedis()
    monkeypatch.setattr(queue, "get_redis_client", lambda: client)
    return client


@pytest.fixture
def no_redis(monkeypatch):
    monkeypatch.setattr(queue, "get_redis_client", lambda: None)


class TestContentRef:
    def test_round_trip(self):
        assert ContentRef.parse(ContentRef.activity(7).key) == ContentRef.activity(7)
        assert ContentRef.parse("course:3") == ContentRef.course(3)
        for bad in ("", "activity:", "activity:x", "user:1", "activity:-1"):
            assert ContentRef.parse(bad) is None


class TestEnqueueWithRedis:
    def test_re_enqueueing_pushes_the_due_time_back(self, redis, monkeypatch):
        clock = iter([100.0, 105.0])
        monkeypatch.setattr(queue.time, "time", lambda: next(clock))
        queue.index_activity(7)
        queue.index_activity(7)
        assert redis.due == {"activity:7": 105.0 + queue.DEBOUNCE_SECONDS}

    def test_claims_only_due_refs_and_only_once(self, redis, monkeypatch):
        monkeypatch.setattr(queue.time, "time", lambda: 50.0)
        redis.due = {"activity:1": 10.0, "course:2": 40.0, "activity:3": 99.0}
        assert queue._claim_due(redis) == ("activity:1", False)
        assert queue._claim_due(redis) == ("course:2", False)
        assert queue._claim_due(redis) is None
        assert redis.due == {"activity:3": 99.0}

    def test_a_ref_another_pod_claimed_is_skipped(self, redis, monkeypatch):
        monkeypatch.setattr(queue.time, "time", lambda: 50.0)
        redis.due = {"activity:1": 10.0}
        redis.zrem = lambda key, member: 0
        assert queue._claim_due(redis) is None

    def test_only_uploads_may_transcribe(self, redis, monkeypatch):
        monkeypatch.setattr(queue.time, "time", lambda: 50.0)
        queue.index_activity(1)
        queue.index_activity(2, transcribe=True)
        queue.index_course(3)
        assert redis.transcribe == {"activity:2"}

        monkeypatch.setattr(queue.time, "time", lambda: 500.0)
        claimed = {queue._claim_due(redis) for _ in range(3)}
        assert claimed == {("activity:1", False), ("activity:2", True), ("course:3", False)}
        assert redis.transcribe == set()

    def test_a_later_edit_keeps_the_upload_flag(self, redis, monkeypatch):
        monkeypatch.setattr(queue.time, "time", lambda: 50.0)
        queue.index_activity(2, transcribe=True)
        queue.index_activity(2)
        monkeypatch.setattr(queue.time, "time", lambda: 500.0)
        assert queue._claim_due(redis) == ("activity:2", True)

    def test_none_ids_are_ignored(self, redis):
        queue.index_activity(None)
        queue.index_course(None)
        assert redis.due == {}

    def test_never_raises(self, monkeypatch):
        broken = MagicMock()
        broken.zadd.side_effect = ConnectionError("down")
        monkeypatch.setattr(queue, "get_redis_client", lambda: broken)
        queue.index_course(1)  # no exception


class TestEnqueueCourse:
    async def test_schedules_the_course_and_its_activities(self, redis, db, org, course, chapter):
        for activity_id in (11, 12):
            await add_activity(
                db, org, course, chapter, activity_id,
                activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
                sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            )
        assert await queue.enqueue_course(course.id, db, delay=0) == 3
        assert set(redis.due) == {"course:1", "activity:11", "activity:12"}
        assert redis.transcribe == set()

        await queue.enqueue_course(course.id, db, delay=0, transcribe=True)
        assert redis.transcribe == {"activity:11", "activity:12"}

    async def test_database_errors_are_swallowed(self, redis):
        db = AsyncMock()
        db.execute.side_effect = RuntimeError("db gone")
        assert await queue.enqueue_course(1, db) == 0
        assert redis.due == {}


class TestLocalFallback:
    async def test_debounces_in_process_without_redis(self, no_redis):
        ran: dict[str, bool] = {}

        async def run(ref, transcribe):
            ran[ref.key] = transcribe

        with patch("src.services.ai.rag.pipeline.run", new=run):
            queue.enqueue(ContentRef.activity(1), delay=0.05, transcribe=True)
            queue.enqueue(ContentRef.activity(1), delay=0.05)
            queue.enqueue(ContentRef.course(2), delay=0.05)
            await asyncio.sleep(0.2)
            await asyncio.gather(*list(queue._children), return_exceptions=True)
        assert ran == {"activity:1": True, "course:2": False}

    def test_without_a_running_loop_nothing_is_scheduled(self, no_redis):
        queue._schedule_local(ContentRef.activity(1), 0)
        assert queue._local_timers == {}


class TestConsumer:
    async def test_runs_due_refs_and_survives_failures(self, redis, monkeypatch):
        monkeypatch.setattr(queue, "POLL_SECONDS", 0.01)
        redis.due = {"activity:1": 0.0, "activity:2": 0.0, "bogus": 0.0}
        redis.transcribe = {"activity:2"}
        done = asyncio.Event()
        ran: list[str] = []
        flags: dict[str, bool] = {}

        async def run(ref, transcribe):
            ran.append(ref.key)
            flags[ref.key] = transcribe
            if ref.key == "activity:1":
                raise RuntimeError("one bad ref")
            done.set()

        with patch("src.services.ai.rag.pipeline.run", new=run):
            queue.start_consumer()
            await asyncio.wait_for(done.wait(), 1)
            await queue.stop_consumer()
        assert sorted(ran) == ["activity:1", "activity:2"]
        assert flags == {"activity:1": False, "activity:2": True}
        assert queue._consumer_task is None

    async def test_stop_requeues_in_flight_refs(self, redis, monkeypatch):
        monkeypatch.setattr(queue, "POLL_SECONDS", 0.01)
        redis.due = {"activity:5": 0.0}
        redis.transcribe = {"activity:5"}
        started = asyncio.Event()

        async def run(ref, transcribe):
            started.set()
            await asyncio.sleep(10)

        with patch("src.services.ai.rag.pipeline.run", new=run):
            queue.start_consumer()
            await asyncio.wait_for(started.wait(), 1)
            await queue.stop_consumer()
        assert "activity:5" in redis.due
        # The upload's right to transcribe survives the handover.
        assert redis.transcribe == {"activity:5"}

    def test_start_without_redis_is_a_no_op(self, no_redis):
        queue.start_consumer()
        assert queue._consumer_task is None

    def test_concurrency_setting(self, monkeypatch):
        monkeypatch.setenv("LEARNHOUSE_RAG_CONCURRENCY", "4")
        assert queue.concurrency() == 4
        monkeypatch.setenv("LEARNHOUSE_RAG_CONCURRENCY", "x")
        assert queue.concurrency() == 2
