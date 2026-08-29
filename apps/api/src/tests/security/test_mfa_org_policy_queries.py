"""How many times a request reads the org security config.

Both per-org session policies — "require 2FA" and the auth-method /
session-sharing policy — live in the same ``admin_toggles.security`` blob and
are enforced together on every gated request. Each loader used to issue its own
``SELECT ... FROM organizationconfig``, so the read count grew with the number
of policy loads a request performed. These tests pin the count, not the timing:
a re-introduced second reader fails here instead of showing up as a Sentry N+1
span weeks later.

Reading the assertions:

* ``TestSharedConfigRead`` scales the work (N policy loads, N gates, N orgs) and
  asserts the read count stays put. ``test_the_counter_sees_the_reads_a_memo_
  removes`` is the control: it disables the shared memo, replays the identical
  loop, and asserts the count is 2N — i.e. what these tests would report if the
  dedup were reverted. Without that control an assertion of "1" would be equally
  satisfied by a counter that never fires.
* ``TestSaveIsNotEchoedStale`` covers the write path: the PUT answers with what
  it just saved, without reading the row back, and leaves no stale memo behind.
"""

from datetime import datetime

import pytest
from sqlalchemy import event
from sqlmodel import select

from src.db.organization_config import OrganizationConfig
from src.services.orgs.auth_policy import get_org_auth_policy
from src.services.orgs.mfa_policy import get_org_mfa_policy
from src.services.orgs.security_config import (
    get_org_security_config,
    invalidate_org_security_config,
)

# How much work each scaling test does. The point of a range is that the
# expected read count is the same number for every entry.
LOAD_COUNTS = [1, 5, 20]


class _ConfigReadCounter:
    """Counts SELECTs against ``organizationconfig`` on an async engine.

    Statement text is what we assert on: the point is that the *database* sees
    one read, so a memo that happened to live somewhere else would still fail.
    """

    def __init__(self, engine):
        self._sync_engine = engine.sync_engine
        self.statements = []

    def _on_execute(self, conn, cursor, statement, parameters, context, executemany):
        normalized = " ".join(statement.lower().split())
        if normalized.startswith("select") and "organizationconfig" in normalized:
            self.statements.append(normalized)

    @property
    def count(self) -> int:
        return len(self.statements)

    def reset(self) -> None:
        self.statements.clear()

    def __enter__(self):
        event.listen(self._sync_engine, "before_cursor_execute", self._on_execute)
        return self

    def __exit__(self, *exc):
        event.remove(self._sync_engine, "before_cursor_execute", self._on_execute)
        return False


@pytest.fixture
def config_reads(engine):
    with _ConfigReadCounter(engine) as counter:
        yield counter


async def _write_policy(db, org_id, **security):
    row = (
        await db.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
        )
    ).scalars().first()
    config = {"config_version": "2.0", "admin_toggles": {"security": security}}
    if row is None:
        row = OrganizationConfig(
            org_id=org_id,
            config=config,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    else:
        row.config = config
    db.add(row)
    await db.commit()


async def _unmemoized_security_config(db_session, org_id):
    """The per-loader read this module exists to remove.

    Byte-for-byte the shape the two loaders used to do inline: one SELECT per
    call, no memo. Used only by the control test, to show what the counter
    reports when the dedup is not there.
    """
    row = (
        await db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
        )
    ).scalars().first()
    if row is None or not isinstance(row.config, dict):
        return {}
    toggles = row.config.get("admin_toggles")
    candidate = toggles.get("security") if isinstance(toggles, dict) else None
    return dict(candidate) if isinstance(candidate, dict) else {}


@pytest.mark.asyncio
class TestSharedConfigRead:
    @pytest.mark.parametrize("loads", LOAD_COUNTS)
    async def test_one_read_however_many_times_the_policies_are_loaded(
        self, db, org, config_reads, loads
    ):
        """N loads of both policies cost one read, not 2N.

        This is the regression itself: the two loaders are called back to back
        on every gated request, and each used to fetch the same row.
        """
        await _write_policy(db, org.id, require_2fa=True, allowed_auth_methods=["sso"])
        config_reads.reset()

        for _ in range(loads):
            mfa = await get_org_mfa_policy(db, org.id)
            auth = await get_org_auth_policy(db, org.id)
            assert mfa.require_2fa is True
            assert auth.allowed_auth_methods == ["sso"]

        assert config_reads.count == 1, config_reads.statements

    @pytest.mark.parametrize("loads", LOAD_COUNTS)
    async def test_the_counter_sees_the_reads_a_memo_removes(
        self, db, org, config_reads, monkeypatch, loads
    ):
        """Control: the same loop costs 2N once the shared memo is taken away.

        Both loaders bind ``get_org_security_config`` at import time, so this
        patches the name in each module — which restores exactly the pre-dedup
        arrangement of two independent readers. If this test and the one above
        ever agree, the counter has stopped observing anything and every count
        assertion in this file is worthless.
        """
        monkeypatch.setattr(
            "src.services.orgs.mfa_policy.get_org_security_config",
            _unmemoized_security_config,
        )
        monkeypatch.setattr(
            "src.services.orgs.auth_policy.get_org_security_config",
            _unmemoized_security_config,
        )
        await _write_policy(db, org.id, require_2fa=True, allowed_auth_methods=["sso"])
        config_reads.reset()

        for _ in range(loads):
            await get_org_mfa_policy(db, org.id)
            await get_org_auth_policy(db, org.id)

        assert config_reads.count == 2 * loads, config_reads.statements

    async def test_a_gated_request_reads_the_config_once(
        self, db, org, regular_user, config_reads
    ):
        """``require_org_membership`` runs both policies; that costs one read.

        One gate, not many, is the load-bearing count here: repeat gates are
        already deduped a level up by the per-(user, org) memos in
        ``evaluate_org_auth`` / ``is_org_mfa_blocking``, so a loop of gates would
        stay flat with or without this change. What changed is the price of the
        first one — it was two reads, one per policy.
        """
        from src.security.org_auth import require_org_membership

        await _write_policy(db, org.id, require_2fa=False)

        config_reads.reset()
        await require_org_membership(regular_user.id, org.id, db)

        assert config_reads.count == 1, config_reads.statements

    async def test_reads_are_scoped_per_org(self, db, org, other_org, config_reads):
        """One org's memo must never answer for another's policy."""
        await _write_policy(db, org.id, require_2fa=True)
        await _write_policy(db, other_org.id, require_2fa=False)
        config_reads.reset()

        assert (await get_org_mfa_policy(db, org.id)).require_2fa is True
        assert (await get_org_mfa_policy(db, other_org.id)).require_2fa is False
        assert (await get_org_auth_policy(db, org.id)) is not None
        assert (await get_org_auth_policy(db, other_org.id)) is not None

        # Bounded by the number of distinct orgs touched, not by the call count.
        assert config_reads.count == 2, config_reads.statements

    @pytest.mark.parametrize("loads", LOAD_COUNTS)
    async def test_missing_config_row_is_memoized_too(
        self, db, org, config_reads, loads
    ):
        """An org with no config row is the common case and must not re-query.

        A memo that only caches hits would leave the default case paying 2N.
        """
        config_reads.reset()

        for _ in range(loads):
            assert (await get_org_mfa_policy(db, org.id)).require_2fa is False
            assert (await get_org_auth_policy(db, org.id)).method_restricted is False

        assert config_reads.count == 1, config_reads.statements


@pytest.mark.asyncio
class TestMalformedConfigStillDefaults:
    """The shared loader took over the shape-checking both loaders used to do."""

    async def test_security_of_the_wrong_type_falls_back_to_defaults(self, db, org):
        db.add(
            OrganizationConfig(
                org_id=org.id,
                config={"config_version": "2.0", "admin_toggles": {"security": ["bogus"]}},
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        await db.commit()

        assert await get_org_security_config(db, org.id) == {}
        assert (await get_org_mfa_policy(db, org.id)).require_2fa is False
        assert (await get_org_auth_policy(db, org.id)).allow_central_session_sharing is True

    async def test_admin_toggles_of_the_wrong_type_falls_back_to_defaults(self, db, org):
        db.add(
            OrganizationConfig(
                org_id=org.id,
                config={"config_version": "2.0", "admin_toggles": "nope"},
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        await db.commit()

        assert await get_org_security_config(db, org.id) == {}
        assert (await get_org_mfa_policy(db, org.id)).require_2fa is False

    async def test_parsers_survive_a_blob_of_the_wrong_shape(self):
        """The parsers are also called directly, on a dict a caller built.

        The PUT hands its own just-saved dict to them, so they cannot rely on
        the loader having shape-checked it first.
        """
        from src.services.orgs.auth_policy import parse_org_auth_policy
        from src.services.orgs.mfa_policy import parse_org_mfa_policy

        assert parse_org_mfa_policy(["bogus"], 1).require_2fa is False
        assert parse_org_auth_policy(["bogus"], 1).method_restricted is False
        assert parse_org_mfa_policy({"require_2fa_grace_days": "soon"}, 1).grace_days == 0

    async def test_row_mutation_cannot_rewrite_a_memoized_decision(self, db, org):
        await _write_policy(db, org.id, require_2fa=True)
        assert (await get_org_mfa_policy(db, org.id)).require_2fa is True

        # In-place edit of the JSON column, the shape SQLAlchemy does not track.
        row = (
            await db.execute(
                select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
            )
        ).scalars().first()
        row.config["admin_toggles"]["security"]["require_2fa"] = False

        # The memo holds a copy, so the gates stay consistent for the request.
        assert (await get_org_mfa_policy(db, org.id)).require_2fa is True


@pytest.mark.asyncio
class TestSaveIsNotEchoedStale:
    """Saving the policy must answer with what was saved, not the memo."""

    async def test_put_returns_the_saved_values(self, db, org, admin_user):
        from src.routers.mfa import OrgMFAPolicyUpdate, api_set_org_mfa_policy

        await _write_policy(db, org.id, require_2fa=False, require_2fa_grace_days=3)

        # Stand in for the access gates that run before the handler body and
        # populate the per-request memo with the pre-save policy.
        assert (await get_org_mfa_policy(db, org.id)).grace_days == 3

        payload = await api_set_org_mfa_policy(
            org_id=org.id,
            form=OrgMFAPolicyUpdate(require_2fa_grace_days=21),
            db_session=db,
            current_user=admin_user,
        )

        assert payload["require_2fa_grace_days"] == 21
        # And the memo is gone, so a later gate in the same request agrees.
        assert (await get_org_mfa_policy(db, org.id)).grace_days == 21

    async def test_put_reads_the_config_row_once(self, db, org, admin_user, config_reads):
        """The handler loads the row to edit it, then answers from that dict.

        Reading the policy back through the loaders after the write is what put
        a second identical SELECT on the transaction Sentry flagged.
        """
        from src.routers.mfa import OrgMFAPolicyUpdate, api_set_org_mfa_policy

        await _write_policy(db, org.id, require_2fa=False, require_2fa_grace_days=3)
        assert (await get_org_mfa_policy(db, org.id)).grace_days == 3

        config_reads.reset()
        payload = await api_set_org_mfa_policy(
            org_id=org.id,
            form=OrgMFAPolicyUpdate(
                require_2fa_grace_days=21, allow_central_session_sharing=True
            ),
            db_session=db,
            current_user=admin_user,
        )

        assert payload["require_2fa_grace_days"] == 21
        assert config_reads.count == 1, config_reads.statements

    async def test_put_answer_matches_what_the_next_get_reports(
        self, db, org, admin_user
    ):
        """Answering from the in-hand dict must not drift from the read-back.

        The PUT parses its own dict; the GET parses the stored row. Both go
        through the same normalizers, and this pins that they agree — including
        on the fields the handler filters (an unknown auth method is dropped).

        The method list stays permissive on purpose: narrowing it from a session
        with no recorded ``amr`` — which is every direct handler call in tests —
        is refused by the self-lockout guard, and that guard is not what this
        test is about.
        """
        from src.routers.mfa import (
            OrgMFAPolicyUpdate,
            _org_security_policy_payload,
            api_set_org_mfa_policy,
        )
        from src.security.session_context import POLICY_AUTH_METHODS

        await _write_policy(db, org.id, require_2fa=False)

        put_payload = await api_set_org_mfa_policy(
            org_id=org.id,
            form=OrgMFAPolicyUpdate(
                require_2fa_grace_days=14,
                exempt_external_auth=False,
                allowed_auth_methods=[*POLICY_AUTH_METHODS, "not_a_method"],
            ),
            db_session=db,
            current_user=admin_user,
        )
        get_payload = await _org_security_policy_payload(db, org.id)

        assert put_payload == get_payload
        assert put_payload["allowed_auth_methods"] == list(POLICY_AUTH_METHODS)

    async def test_invalidate_is_safe_when_nothing_was_memoized(self, db, org):
        invalidate_org_security_config(db, org.id)
        invalidate_org_security_config(db, org.id)
