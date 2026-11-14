"""Usage-based AI credit metering.

Every model call goes through ``build_model`` (text, Atlas), the image/TTS
generators or the embedder, and each records its provider usage here. A
*meter* collects that usage for one customer request:

    async with charge("magic_block", org_id=org.id, db=db) as meter:
        result = await generate(...)          # usage recorded automatically
    meter.credits                              # what was charged

``charge`` reserves the published estimate up front (so an org that can't
afford it is refused before any model runs), meters actual usage, and settles
at the end: it charges ``max(minimum, provider cost x MARGIN_FLOOR / credit
value)`` rounded up, refunding the difference or charging the extra. A request
that fails is refunded in full. Long agent runs (Atlas) call
``meter.top_up()`` before each model request: the reservation grows with the
run, and an org that runs out of credits (or a run that hits its budget) stops
before the next call instead of overspending.

Each settled request writes one ``ai_usage_event`` row (feature, member,
credits, provider cost, tokens) and is idempotent on its ``charge_key``: a
retried job or reconnected stream that reuses the key is not charged twice.

Model calls with no meter active are "unmetered": they are logged and counted
(``ai_unmetered:{day}``) so free paths show up in the platform console, and the
test suite fails on them.
"""

from __future__ import annotations

import contextlib
import logging
import uuid
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Optional

from fastapi import HTTPException

from src.services.ai import pricing
from src.services.ai.pricing import Usage

logger = logging.getLogger(__name__)

_current: ContextVar[Optional["Meter"]] = ContextVar("ai_meter", default=None)
# Credits settled during the current HTTP request (X-AI-Credits-Used header).
request_credits_collector: ContextVar[Optional[list]] = ContextVar("ai_request_credits", default=None)

# Set by tests to fail loudly on a model call that no meter covers.
STRICT_UNMETERED = False

_UNMETERED_KEY = "ai_unmetered:{day}"
_CHARGE_LOCK_KEY = "ai_charge:{key}"
_CHARGE_LOCK_TTL = 24 * 3600


class BudgetReached(Exception):
    """A metered run reached its credit budget (``max_credits``)."""


class DuplicateCharge(HTTPException):
    """The same ``charge_key`` is already charged or in flight."""

    def __init__(self, key: str):
        super().__init__(status_code=409, detail="This AI request is already being processed.")
        self.key = key


class UnmeteredModelCall(RuntimeError):
    """Raised in strict mode (tests) for a model call outside any meter."""


def current_meter() -> Optional["Meter"]:
    return _current.get()


@dataclass
class Meter:
    feature: str
    org_id: int
    user_id: Optional[int] = None
    units: float = 1.0
    minimum: Optional[int] = None  # None: the feature's published price x units
    max_credits: Optional[int] = None  # a budget the run may not exceed
    charge_key: str = ""
    reserved: int = 0
    usages: list[Usage] = field(default_factory=list)
    settled: bool = False
    credits: int = 0  # charged, once settled
    status: str = "open"
    # When True a failed request still pays for the usage it produced (Atlas: tools ran).
    keep_on_failure: bool = False
    meta: dict[str, Any] = field(default_factory=dict)
    # The org's limits at start (settlement charges extra up to the total, never past it).
    limits: Optional[dict[str, Any]] = None

    # ── usage ──────────────────────────────────────────────────────────────
    def add(self, usage: Usage) -> None:
        self.usages.append(usage)

    @property
    def cost_usd(self) -> float:
        """Provider cost at today's list price (what we pay)."""
        return pricing.total_cost_usd(self.usages)

    @property
    def planning_cost_usd(self) -> float:
        """Cost at the highest announced price: what credits are computed from."""
        return pricing.total_cost_usd(self.usages, planning=True)

    @property
    def floor_credits(self) -> int:
        if self.minimum is not None:
            return self.minimum
        return pricing.estimate_credits(self.feature, self.units)

    def credits_due(self) -> int:
        due = pricing.settle_credits(self.feature, self.planning_cost_usd, minimum=self.floor_credits)
        if self.max_credits is not None:
            due = min(due, self.max_credits)
        return due

    @property
    def produced(self) -> bool:
        return bool(self.usages)

    # ── reservation ────────────────────────────────────────────────────────
    async def top_up(self, db, *, headroom: int = 0) -> None:
        """Before another model call: make sure the reservation covers what the
        run already costs plus ``headroom`` credits for the next call. Raises
        ``BudgetReached`` at the budget and the usual 403 when the org is out of
        credits, before the call is made."""
        from src.security.features_utils.usage import reserve_ai_credit

        if pricing.feature(self.feature).absorbed:
            return
        # The published minimum already pays for the first call(s); only real
        # usage plus the next call's headroom above it needs more reserved.
        need = max(self.floor_credits, pricing.credits_for_cost(self.planning_cost_usd) + max(headroom, 0))
        if self.max_credits is not None and self.produced and need > self.max_credits:
            # The next call would take the run past its budget: stop before it.
            raise BudgetReached(f"Reached the budget of {self.max_credits} credits.")
        if self.max_credits is not None:
            need = min(need, self.max_credits)
        extra = need - self.reserved
        if extra > 0:
            await reserve_ai_credit(self.org_id, db, amount=extra)
            self.reserved += extra

    def next_call_headroom(self) -> int:
        """Credits the next model call will likely cost: the last call's cost at
        the floor (a run's calls grow as its history grows), at least 1."""
        if not self.usages:
            return 1
        last = pricing.cost_usd(self.usages[-1], planning=True)
        return max(1, pricing.credits_for_cost(last))

    # ── settlement ─────────────────────────────────────────────────────────
    async def settle(self, *, failed: bool = False) -> int:
        """Charge what the request cost (refund the rest of the reservation).
        Idempotent: settling twice does nothing the second time."""
        if self.settled:
            return self.credits
        self.settled = True
        from src.security.features_utils.usage import charge_ai_credit_up_to, refund_ai_credit

        if failed and not (self.keep_on_failure and self.produced):
            due = 0
            self.status = "refunded"
        else:
            due = self.credits_due()
            self.status = "ok"
        charged = self.reserved
        if due < self.reserved:
            try:
                refund_ai_credit(self.org_id, self.reserved - due)
            except Exception:  # pragma: no cover - Redis down: keep the reservation
                logger.exception("ai-credits: refund failed for org %s", self.org_id)
                due = self.reserved
            charged = due
        elif due > self.reserved:
            try:
                got = charge_ai_credit_up_to(self.org_id, due - self.reserved, self.limits)
            except Exception:  # pragma: no cover - Redis down
                logger.exception("ai-credits: settlement charge failed for org %s", self.org_id)
                got = 0
            charged = self.reserved + got
            if charged < due:
                self.status = "partial"
        self.credits = charged
        if self.status == "refunded":
            # A failed request may be retried with the same key.
            _forget_lock(self.charge_key)
            self.charge_key = f"{self.charge_key[:110]}#r{uuid.uuid4().hex[:8]}"
        await _write_ledger(self)
        collector = request_credits_collector.get()
        if collector is not None and charged:
            collector.append(charged)
        return charged

    def summary(self) -> dict[str, Any]:
        return {
            "feature": self.feature,
            "credits": self.credits if self.settled else self.credits_due(),
            "estimate": self.floor_credits,
            "settled": self.settled,
        }


# ── recording ──────────────────────────────────────────────────────────────


def record_usage(usage: Usage) -> None:
    """Add one provider call's usage to the active meter (or flag it unmetered)."""
    meter = _current.get()
    if meter is not None and not meter.settled:
        meter.add(usage)
        return
    _flag_unmetered(usage)


def _flag_unmetered(usage: Usage) -> None:
    if STRICT_UNMETERED:
        raise UnmeteredModelCall(f"Model call outside any AI charge: {usage.model}")
    logger.warning("ai-credits: unmetered model call (%s)", usage.model)
    try:
        from src.security.features_utils.usage import _get_redis_client

        r = _get_redis_client()
        day = datetime.now(timezone.utc).strftime("%Y%m%d")
        key = _UNMETERED_KEY.format(day=day)
        micros = int(round(pricing.cost_usd(usage) * 1_000_000))
        r.hincrby(key, f"{usage.model}:calls", 1)
        r.hincrby(key, f"{usage.model}:cost_micros", micros)
        r.expire(key, 90 * 24 * 3600)
    except Exception:
        pass


def usage_from_request_usage(model: str, u: Any) -> Usage:
    """A pydantic-ai ``RequestUsage`` as billable units (Gemini counts thinking as output)."""
    details = dict(getattr(u, "details", None) or {})
    out = int(getattr(u, "output_tokens", 0) or 0)
    image_out = int(details.get("image_candidates_tokens", 0) or 0)
    audio_out = int(getattr(u, "output_audio_tokens", 0) or details.get("audio_candidates_tokens", 0) or 0)
    return Usage(
        model=model,
        input_tokens=int(getattr(u, "input_tokens", 0) or 0),
        output_tokens=max(out - image_out - audio_out, 0),
        cached_input_tokens=int(getattr(u, "cache_read_tokens", 0) or 0),
        audio_input_tokens=int(getattr(u, "input_audio_tokens", 0) or details.get("audio_prompt_tokens", 0) or 0),
        image_output_tokens=image_out,
        audio_output_tokens=audio_out,
    )


def usage_from_genai_response(model: str, response: Any) -> Usage:
    """Usage of a raw google-genai ``generate_content`` response (image, TTS)."""
    meta = getattr(response, "usage_metadata", None)
    version = getattr(response, "model_version", None) or model
    if meta is None:
        return Usage(model=version)

    def by_modality(items: Any) -> dict[str, int]:
        out: dict[str, int] = {}
        for d in items or []:
            mod = getattr(getattr(d, "modality", None), "name", None) or str(getattr(d, "modality", "") or "")
            key = mod.upper().replace("MODALITY.", "")
            out[key] = out.get(key, 0) + int(getattr(d, "token_count", 0) or 0)
        return out

    cand = by_modality(getattr(meta, "candidates_tokens_details", None))
    prompt = by_modality(getattr(meta, "prompt_tokens_details", None))
    candidates = int(getattr(meta, "candidates_token_count", 0) or 0)
    thoughts = int(getattr(meta, "thoughts_token_count", 0) or 0)
    image_out = cand.get("IMAGE", 0)
    audio_out = cand.get("AUDIO", 0)
    text_out = max(candidates - image_out - audio_out, 0) + thoughts
    return Usage(
        model=version,
        input_tokens=int(getattr(meta, "prompt_token_count", 0) or 0),
        output_tokens=text_out,
        cached_input_tokens=int(getattr(meta, "cached_content_token_count", 0) or 0),
        audio_input_tokens=prompt.get("AUDIO", 0),
        image_output_tokens=image_out,
        audio_output_tokens=audio_out,
    )


# ── metered pydantic-ai model ──────────────────────────────────────────────


def _make_metered_model_class():
    from pydantic_ai.models.wrapper import WrapperModel

    class _MeteredModel(WrapperModel):
        """Records each request's provider usage on the active meter."""

        def __init__(self, wrapped: Any, *, price_name: str):
            super().__init__(wrapped)
            self.price_name = price_name

        def _record(self, model_name: Optional[str], usage: Any) -> None:
            name = self.price_name
            # The response names the model that actually answered (an alias can be
            # served by a newer model): bill that one. Local models keep their prefix.
            if model_name and not name.startswith("ollama:"):
                name = model_name
            record_usage(usage_from_request_usage(name, usage))

        async def request(self, messages, model_settings, model_request_parameters):  # type: ignore[override]
            response = await self.wrapped.request(messages, model_settings, model_request_parameters)
            self._record(getattr(response, "model_name", None), response.usage)
            return response

        @contextlib.asynccontextmanager
        async def request_stream(self, messages, model_settings, model_request_parameters, run_context=None):  # type: ignore[override]
            async with self.wrapped.request_stream(
                messages, model_settings, model_request_parameters, run_context
            ) as stream:
                try:
                    yield stream
                finally:
                    # ``usage`` is a property on StreamedResponse (a snapshot of
                    # what the provider reported so far).
                    self._record(getattr(stream, "model_name", None), stream.usage)

    return _MeteredModel


_METERED_CLS: Any = None


def MeteredModel(wrapped: Any, *, price_name: str) -> Any:  # noqa: N802 - factory used like a class
    global _METERED_CLS
    if _METERED_CLS is None:
        _METERED_CLS = _make_metered_model_class()
    return _METERED_CLS(wrapped, price_name=price_name)


# ── charging ───────────────────────────────────────────────────────────────


def _acting_user_id(org_id: int) -> Optional[int]:
    try:
        from src.services.security.rate_limiting import ai_acting_user

        acting = ai_acting_user.get()
        if acting and int(acting[1]) == int(org_id):
            return int(acting[0])
    except Exception:  # pragma: no cover
        pass
    return None


def _take_lock(key: str) -> None:
    from src.security.features_utils.usage import _get_redis_client

    try:
        r = _get_redis_client()
        ok = r.set(_CHARGE_LOCK_KEY.format(key=key), "1", nx=True, ex=_CHARGE_LOCK_TTL)
    except Exception:
        return  # Redis down: reserve_ai_credit fails closed anyway
    if not ok:
        raise DuplicateCharge(key)


def _forget_lock(key: str) -> None:
    """Drop the lock of a charge that never started (refused reservation), so the
    caller can retry with the same key once it has credits."""
    if not key:
        return
    from src.security.features_utils.usage import _get_redis_client

    try:
        _get_redis_client().delete(_CHARGE_LOCK_KEY.format(key=key))
    except Exception:  # pragma: no cover
        pass


async def start(
    feature: str,
    *,
    org_id: int,
    db,
    user_id: Optional[int] = None,
    units: float = 1.0,
    minimum: Optional[int] = None,
    estimate: Optional[int] = None,
    max_credits: Optional[int] = None,
    charge_key: Optional[str] = None,
    keep_on_failure: bool = False,
) -> Meter:
    """Open a meter and reserve its estimate. Pair with ``meter.settle()``
    (``charge()`` does both). ``estimate`` overrides how much to reserve up front
    (never less than the minimum)."""
    from src.security.features_utils.usage import ai_credit_limits, reserve_ai_credit

    pricing.feature(feature)  # unknown feature: fail before charging
    meter = Meter(
        feature=feature,
        org_id=int(org_id),
        user_id=user_id if user_id is not None else _acting_user_id(org_id),
        units=units,
        minimum=minimum,
        max_credits=max_credits,
        charge_key=charge_key or f"{feature}:{uuid.uuid4().hex}",
        keep_on_failure=keep_on_failure,
    )
    if charge_key:
        _take_lock(meter.charge_key)
    amount = max(meter.floor_credits, int(estimate or 0))
    if max_credits is not None:
        amount = min(amount, max_credits)
    if amount > 0:
        try:
            await reserve_ai_credit(meter.org_id, db, amount=amount)
        except BaseException:
            _forget_lock(meter.charge_key if charge_key else "")
            raise
    meter.reserved = amount
    try:
        meter.limits = await ai_credit_limits(meter.org_id, db)
    except Exception:  # pragma: no cover - settlement then charges extra uncapped
        meter.limits = None
    return meter


@contextlib.contextmanager
def use_meter(meter: Optional[Meter]):
    """Make ``meter`` the active one for model calls in this context."""
    token = _current.set(meter)
    try:
        yield meter
    finally:
        try:
            _current.reset(token)
        except ValueError:  # reset from another context (async generator moved tasks)
            _current.set(None)


@contextlib.asynccontextmanager
async def charge(feature: str, *, org_id: int, db, **kwargs: Any) -> AsyncIterator[Meter]:
    """Reserve, meter and settle one AI request (refunded in full if it fails)."""
    meter = await start(feature, org_id=org_id, db=db, **kwargs)
    with use_meter(meter):
        try:
            yield meter
        except BaseException:
            await meter.settle(failed=True)
            raise
    await meter.settle()


# ── ledger ─────────────────────────────────────────────────────────────────


def _session_factory():
    from src.core.events.database import _async_session_factory

    return _async_session_factory


async def _write_ledger(meter: Meter) -> None:
    """One ``ai_usage_event`` row per settled request (best effort: billing in
    Redis is already done; a lost row only hides it from the reports)."""
    from src.db.ai_usage import AIUsageEvent

    models: dict[str, dict[str, Any]] = {}
    for u in meter.usages:
        row = models.setdefault(u.model, {"model": u.model, "requests": 0, "cost_usd": 0.0, **{k: 0 for k in (
            "input_tokens", "output_tokens", "cached_input_tokens", "audio_input_tokens",
            "image_output_tokens", "audio_output_tokens")}})
        row["requests"] += u.requests
        row["cost_usd"] = round(row["cost_usd"] + pricing.cost_usd(u), 8)
        for k in ("input_tokens", "output_tokens", "cached_input_tokens", "audio_input_tokens",
                  "image_output_tokens", "audio_output_tokens"):
            row[k] += getattr(u, k)
    event = AIUsageEvent(
        org_id=meter.org_id,
        user_id=meter.user_id,
        feature=meter.feature,
        status=meter.status,
        credits=meter.credits,
        cost_micros=int(round(meter.cost_usd * 1_000_000)),
        units=float(meter.units),
        requests=sum(u.requests for u in meter.usages),
        input_tokens=sum(u.input_tokens for u in meter.usages),
        output_tokens=sum(u.output_tokens + u.image_output_tokens + u.audio_output_tokens for u in meter.usages),
        models=list(models.values()) or None,
        charge_key=meter.charge_key[:128],
    )
    try:
        async with _session_factory()() as session:
            session.add(event)
            await session.commit()
    except Exception:
        logger.warning("ai-credits: could not write the usage ledger row", exc_info=True)
