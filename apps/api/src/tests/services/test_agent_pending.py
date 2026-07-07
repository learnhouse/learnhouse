"""Pending-action FSM + apply-path tests (fakeredis-backed).

Ports the historical pending-edit state-machine tests and adds coverage for
the generalized apply path: ownership, challenge verification, conflicting
concurrent applies, and replay through the registry pipeline.
"""

import fakeredis
import pytest
from pydantic import BaseModel

from src.db.users import APITokenUser
from src.security.rbac import AccessAction
from src.services.ai.actions.apply import (
    apply_pending_action,
    cancel_pending_action,
)
from src.services.ai.actions.pending import (
    MAX_PENDINGS_PER_SCOPE,
    PendingStore,
    _challenge_for,
    _normalize,
    build_confirmation_challenge,
)
from src.services.ai.tools import (
    ActionTier,
    PendingProposal,
    ToolContext,
    ToolRegistry,
    ToolSpec,
    make_synthetic_request,
)


@pytest.fixture
def store():
    return PendingStore(fakeredis.FakeRedis())


def _proposal(**overrides):
    base = dict(
        tool="update_course",
        args={"course_uuid": "course_x", "name": "Algebra 1"},
        tier=ActionTier.EDIT,
        target={"kind": "course", "uuid": "course_x", "name": "Algebra 1"},
        summary="Rename to Algebra 1",
        requires_confirmation=False,
        scope_key="chat_1",
        org_id=1,
        user_id=2,
    )
    base.update(overrides)
    return PendingProposal(**base)


# ─── state machine ─────────────────────────────────────────────────────────


def test_create_then_get_round_trips(store):
    action, superseded = store.create(_proposal())
    assert superseded == []
    fetched = store.get(action.pending_id)
    assert fetched is not None
    assert fetched.status == "proposed"
    assert fetched.args == {"course_uuid": "course_x", "name": "Algebra 1"}
    assert fetched.scope_key == "chat_1"


def test_destructive_proposal_becomes_awaiting_confirm(store):
    action, _ = store.create(
        _proposal(
            tool="delete_course",
            tier=ActionTier.DESTRUCTIVE,
            requires_confirmation=True,
        ),
        blast_radius={"chapters": 3, "activities": 12},
    )
    assert action.status == "awaiting_confirm"
    assert action.challenge_phrase is not None
    challenge = build_confirmation_challenge(action)
    assert challenge["challenge_phrase"] == action.challenge_phrase
    assert "3 chapter(s)" in challenge["blast_radius_summary"]
    assert challenge["action_label"].startswith("Delete course")


def test_cancel_transitions_only_from_open_states(store):
    action, _ = store.create(_proposal())
    cancelled = store.cancel(action.pending_id)
    assert cancelled is not None and cancelled.status == "cancelled"
    # Idempotent — second cancel is a no-op.
    assert store.cancel(action.pending_id) is None


def test_apply_lifecycle(store):
    action, _ = store.create(_proposal())
    started = store.begin_apply(action.pending_id)
    assert started is not None and started.status == "applying"
    finished = store.finish_apply(action.pending_id, version_after=2, with_undo=True)
    assert finished is not None
    assert finished.status == "applied"
    assert finished.undo_token is not None
    assert finished.version_after == 2


def test_finish_apply_without_undo_has_no_token(store):
    action, _ = store.create(_proposal())
    store.begin_apply(action.pending_id)
    finished = store.finish_apply(action.pending_id)
    assert finished.undo_token is None


def test_double_begin_apply_conflicts(store):
    action, _ = store.create(_proposal())
    assert store.begin_apply(action.pending_id) is not None
    assert store.begin_apply(action.pending_id) is None


def test_cap_supersedes_oldest(store):
    ids = []
    for i in range(MAX_PENDINGS_PER_SCOPE + 2):
        action, superseded = store.create(_proposal())
        ids.append(action.pending_id)
    # The two oldest must have been superseded.
    assert store.get(ids[0]).status == "superseded"
    assert store.get(ids[1]).status == "superseded"
    assert store.get(ids[-1]).status == "proposed"
    live = store.list_for_scope("chat_1")
    assert len(live) == MAX_PENDINGS_PER_SCOPE


def test_list_for_scope_filters_closed(store):
    a1, _ = store.create(_proposal())
    a2, _ = store.create(_proposal())
    store.cancel(a1.pending_id)
    live = store.list_for_scope("chat_1")
    assert [a.pending_id for a in live] == [a2.pending_id]


# ─── challenges ────────────────────────────────────────────────────────────


def test_challenge_phrase_short_name_uses_phrase_kind():
    kind, phrase = _challenge_for({"name": "X"}, "delete_course")
    assert kind == "type_phrase"
    assert phrase == "delete x"


def test_challenge_phrase_generic_name_uses_phrase_kind():
    kind, phrase = _challenge_for({"name": "Community"}, "delete_community")
    assert kind == "type_phrase"


def test_challenge_phrase_normal_name_uses_name_kind():
    kind, phrase = _challenge_for({"name": "Algebra 1"}, "delete_course")
    assert kind == "type_name"
    assert phrase == "algebra 1"


def test_challenge_verb_follows_tool(store):
    action, _ = store.create(
        _proposal(
            tool="remove_user_from_org",
            tier=ActionTier.DESTRUCTIVE,
            requires_confirmation=True,
            target={"kind": "user", "uuid": "user_x", "name": "Jo"},
        )
    )
    assert action.challenge_phrase.startswith("remove ")


def test_verify_challenge(store):
    action, _ = store.create(
        _proposal(
            tool="delete_course",
            tier=ActionTier.DESTRUCTIVE,
            requires_confirmation=True,
        )
    )
    assert store.verify_challenge(action, action.challenge_phrase)
    assert store.verify_challenge(action, f"  {action.challenge_phrase.upper()} ")
    assert not store.verify_challenge(action, "wrong phrase")
    assert not store.verify_challenge(action, None)


def test_normalize_collapses_whitespace_and_case():
    assert _normalize("  HELLO   World ") == "hello world"


# ─── apply path (registry replay) ──────────────────────────────────────────


class _Args(BaseModel):
    course_uuid: str = "course_x"
    name: str | None = None
    confirm: bool | None = None


def _registry(execute):
    async def _noop_undo(ctx, params, result):
        return {"undo": True}

    r = ToolRegistry()
    r.register_all(
        [
            ToolSpec(
                name="update_course",
                description="update",
                params_model=_Args,
                tier=ActionTier.EDIT,
                rights_bucket="courses",
                access_action=AccessAction.UPDATE,
                execute=execute,
                build_undo=_noop_undo,
            ),
            ToolSpec(
                name="delete_course",
                description="delete",
                params_model=_Args,
                tier=ActionTier.DESTRUCTIVE,
                rights_bucket="courses",
                access_action=AccessAction.DELETE,
                execute=execute,
            ),
        ]
    )
    return r


def _ctx(db, org, user_id=2):
    token = APITokenUser(
        id=0,
        user_uuid="apitoken_apply",
        username="api_token",
        org_id=org.id,
        rights={
            "courses": {
                "action_create": True,
                "action_read": True,
                "action_update": True,
                "action_delete": True,
            }
        },
        created_by_user_id=user_id,
    )
    return ToolContext(
        request=make_synthetic_request(),
        db_session=db,
        user=token,
        org=org,
        org_slug=org.slug,
        mode="execute",
        scope_key="chat_1",
    )


async def test_apply_executes_and_finishes(store, db, org):
    calls = []

    async def _exec(ctx, params):
        calls.append(params.model_dump())
        return {"ok": True, "current_version": 5}

    action, _ = store.create(_proposal(org_id=org.id))
    result = await apply_pending_action(
        store, _registry(_exec), action.pending_id, _ctx(db, org)
    )
    assert result.outcome.status == "executed"
    assert result.action.status == "applied"
    assert result.action.version_after == 5
    # update_course has build_undo → undo token issued
    assert result.action.undo_token is not None
    assert calls and calls[0]["name"] == "Algebra 1"


async def test_apply_denies_wrong_owner(store, db, org):
    async def _exec(ctx, params):  # pragma: no cover - must not run
        raise AssertionError("must not execute")

    action, _ = store.create(_proposal(org_id=org.id, user_id=999))
    result = await apply_pending_action(
        store, _registry(_exec), action.pending_id, _ctx(db, org, user_id=2)
    )
    assert result.outcome.denied_code == "pending_not_found"
    assert store.get(action.pending_id).status == "proposed"


async def test_apply_requires_matching_challenge(store, db, org):
    async def _exec(ctx, params):
        return {"ok": True}

    action, _ = store.create(
        _proposal(
            tool="delete_course",
            tier=ActionTier.DESTRUCTIVE,
            requires_confirmation=True,
            org_id=org.id,
        )
    )
    registry = _registry(_exec)
    bad = await apply_pending_action(
        store, registry, action.pending_id, _ctx(db, org), confirmation_phrase="nope"
    )
    assert bad.outcome.denied_code == "challenge_failed"
    assert store.get(action.pending_id).status == "awaiting_confirm"

    good = await apply_pending_action(
        store,
        registry,
        action.pending_id,
        _ctx(db, org),
        confirmation_phrase=action.challenge_phrase,
    )
    # Challenge verified once here — the destructive execute-mode opt-in is
    # injected automatically, no double confirmation.
    assert good.outcome.status == "executed"
    assert good.action.status == "applied"


async def test_apply_marks_failed_on_denial(store, db, org):
    async def _exec(ctx, params):
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="service denies")

    action, _ = store.create(_proposal(org_id=org.id))
    result = await apply_pending_action(
        store, _registry(_exec), action.pending_id, _ctx(db, org)
    )
    assert result.outcome.status == "denied"
    assert store.get(action.pending_id).status == "failed"
    assert "service denies" in store.get(action.pending_id).error


async def test_apply_conflict_when_already_applied(store, db, org):
    async def _exec(ctx, params):
        return {"ok": True}

    action, _ = store.create(_proposal(org_id=org.id))
    registry = _registry(_exec)
    first = await apply_pending_action(store, registry, action.pending_id, _ctx(db, org))
    assert first.outcome.status == "executed"
    second = await apply_pending_action(store, registry, action.pending_id, _ctx(db, org))
    assert second.outcome.denied_code == "pending_conflict"


async def test_apply_unknown_pending(store, db, org):
    async def _exec(ctx, params):
        return {"ok": True}

    result = await apply_pending_action(store, _registry(_exec), "pnd_nope", _ctx(db, org))
    assert result.outcome.denied_code == "pending_not_found"


async def test_cancel_pending_action_ownership(store, db, org):
    action, _ = store.create(_proposal(org_id=org.id, user_id=999))
    assert cancel_pending_action(store, action.pending_id, _ctx(db, org)) is None
    action2, _ = store.create(_proposal(org_id=org.id))
    cancelled = cancel_pending_action(store, action2.pending_id, _ctx(db, org))
    assert cancelled is not None and cancelled.status == "cancelled"
