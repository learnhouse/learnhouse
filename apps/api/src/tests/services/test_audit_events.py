"""The durable ``user_audit_event`` write path (``src/services/audit/audit.py``):
recording an event and reading the request context it carries. The
per-student dossier that reads these rows is an EE feature, tested there."""
from unittest.mock import patch

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.user_audit_events import UserAuditEvent, UserAuditEventType


class TestRequestContext:
    def test_extract_request_context(self):
        from src.services.audit.audit import extract_request_context

        class _Req:
            headers = {"user-agent": "UA/1.0"}
            client = type("C", (), {"host": "1.2.3.4"})()

        ip, ua = extract_request_context(_Req())
        assert ua == "UA/1.0"
        assert ip  # resolved to some value
        assert extract_request_context(None) == (None, None)


class TestRecordAuditEvent:
    async def test_record_writes_durable_row(self, engine, db):
        """record_audit_event commits an isolated row via the session factory."""
        from sqlalchemy.ext.asyncio import async_sessionmaker
        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        with patch("src.core.events.database._async_session_factory", factory):
            from src.services.audit.audit import record_audit_event
            await record_audit_event(
                event_type=UserAuditEventType.COURSE_ENROLLED,
                user_id=7,
                org_id=1,
                target_uuid="course_x",
                metadata={"course_name": "X"},
            )

        rows = (await db.execute(
            select(UserAuditEvent).where(UserAuditEvent.user_id == 7)
        )).scalars().all()
        assert len(rows) == 1
        assert rows[0].event_type == UserAuditEventType.COURSE_ENROLLED
        assert rows[0].target_uuid == "course_x"

    async def test_record_ignores_anonymous(self, engine, db):
        from sqlalchemy.ext.asyncio import async_sessionmaker
        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        with patch("src.core.events.database._async_session_factory", factory):
            from src.services.audit.audit import record_audit_event
            await record_audit_event(event_type=UserAuditEventType.LOGIN, user_id=0)
        rows = (await db.execute(select(UserAuditEvent))).scalars().all()
        assert len(rows) == 0

    async def test_record_swallows_errors(self):
        """A write failure is logged, never raised; auditing must not break the action."""
        def _boom():
            raise RuntimeError("db down")

        with patch("src.core.events.database._async_session_factory", _boom):
            from src.services.audit.audit import record_audit_event
            # Must not raise despite the factory blowing up.
            await record_audit_event(event_type=UserAuditEventType.LOGIN, user_id=5)


class TestExtractContextFallbacks:
    def test_falls_back_when_client_ip_raises(self):
        from src.services.audit.audit import extract_request_context

        class _Req:
            headers = {"user-agent": "UA"}
            client = type("C", (), {"host": "9.9.9.9"})()

        with patch("src.services.security.rate_limiting.get_client_ip", side_effect=ValueError):
            ip, ua = extract_request_context(_Req())
        assert ip == "9.9.9.9"
        assert ua == "UA"

    def test_user_agent_exception_falls_back_to_none(self):
        from src.services.audit.audit import extract_request_context

        class _BadHeaders:
            def get(self, *a, **k):
                raise RuntimeError("boom")

        class _Req:
            headers = _BadHeaders()
            client = None

        ip, ua = extract_request_context(_Req())
        assert ua is None
