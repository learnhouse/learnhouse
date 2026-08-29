"""Sentry `before_send` filtering.

`LoggingIntegration(event_level=logging.ERROR)` promotes every logger.error in
the process into a Sentry event, including uvicorn's own. When a lifespan
handler raises, uvicorn logs the formatted traceback and then a constant string
("Application startup failed. Exiting." on the startup path, "Application
shutdown failed. Exiting." on the shutdown path) — events with no exception
interface and no stack trace, grouped into one bucket that merges every distinct
cause, while the real exception is already captured on the same trace with
mechanism=starlette. That echo alone was 2424 events.

The second rule is about AI provider quota. It throttles rather than drops, and
it is scoped to DEPLETION only: Google returns RESOURCE_EXHAUSTED for per-minute
rate limiting too, and a rate limit is actionable. Warning-level logs never
reach Sentry (LoggingIntegration captures at ERROR), so Sentry is the only
alerting surface a depleted key has — it must not go to zero.

`_before_send` is a plain function; these call it directly.
"""

import pytest

import app


def _event(**kwargs):
    return dict(kwargs)


@pytest.fixture(autouse=True)
def _reset_quota_throttle():
    """Each test starts with the depletion throttle unarmed."""
    app._quota_last_reported_at.clear()
    yield
    app._quota_last_reported_at.clear()


def test_health_transactions_are_still_dropped():
    for transaction in ("/health", "/api/v1/health"):
        assert app._before_send(_event(transaction=transaction), None) is None


@pytest.mark.parametrize(
    "constant",
    ["Application startup failed. Exiting.", "Application shutdown failed. Exiting."],
)
def test_lifespan_failure_log_echo_is_dropped(constant):
    """Both halves of the pair, or the causeless issue just moves paths.

    uvicorn logs the bare traceback from both lifespan/on.py:121 (startup.failed)
    and :134 (shutdown.failed). Dropping the traceback while keeping the shutdown
    constant would leave exactly the constant-string, no-cause issue this rule
    exists to retire, on the shutdown path.
    """
    event = _event(logger="uvicorn.error", logentry={"formatted": constant})
    assert app._before_send(event, None) is None


def test_lifespan_traceback_log_echo_is_dropped():
    event = _event(
        logger="uvicorn.error",
        logentry={
            "formatted": (
                "Traceback (most recent call last):\n"
                '  File "/app/src/core/events/autoinstall.py", line 31\n'
                "asyncpg.exceptions.UndefinedColumnError: column "
                "organization.is_demo does not exist"
            )
        },
    )
    assert app._before_send(event, None) is None

    # Same line arriving as event["message"] rather than a logentry.
    assert (
        app._before_send(
            _event(logger="uvicorn.error", message="Traceback (most recent call last):"),
            None,
        )
        is None
    )


def test_other_uvicorn_errors_are_kept():
    """Only the lifespan failure lines go — uvicorn.error is not silenced."""
    event = _event(
        logger="uvicorn.error",
        logentry={"formatted": "Invalid HTTP request received."},
    )
    assert app._before_send(event, None) is event


def test_startup_failure_with_a_real_exception_is_kept():
    """An event carrying a stack trace is the actionable one; never drop it."""
    event = _event(
        logger="uvicorn.error",
        logentry={"formatted": "Application startup failed. Exiting."},
        exception={"values": [{"type": "UndefinedColumnError", "value": "boom"}]},
    )
    assert app._before_send(event, None) is event


def _depletion_event(
    value="429 Your credits are depleted. Top up to continue.",
    transaction="/api/v1/ai/images/generate",
):
    return _event(
        transaction=transaction,
        exception={
            "values": [
                {
                    "type": "ClientError",
                    "value": value,
                    "mechanism": {"type": "google_genai", "handled": False},
                }
            ]
        }
    )


def test_first_quota_depletion_still_reaches_sentry():
    """Depletion must keep an alerting surface.

    A blanket drop left quota exhaustion with no signal anywhere: the first-party
    handlers log it at WARNING, and LoggingIntegration only captures at ERROR.
    The whole point of the throttle is that the FIRST one still gets through.
    """
    event = _depletion_event()
    assert app._before_send(event, None) is event


def test_repeat_quota_depletion_inside_the_window_is_dropped():
    """The SDK captures once per call; streaming endpoints call repeatedly."""
    assert app._before_send(_depletion_event(), None) is not None
    for _ in range(5):
        assert app._before_send(_depletion_event(), None) is None


def test_quota_depletion_reports_again_after_the_window():
    assert app._before_send(_depletion_event(), None) is not None
    # Rewind the throttle past the window rather than sleeping 15 minutes.
    for key in app._quota_last_reported_at:
        app._quota_last_reported_at[key] -= app._QUOTA_REPORT_INTERVAL_SECONDS + 1
    assert app._before_send(_depletion_event(), None) is not None


def test_a_depletion_on_one_endpoint_does_not_suppress_another():
    """The window is per bucket, not global. This is the whole point of the key.

    Depletion is not one Sentry issue: prod has four (image generation, two on
    the activities endpoint, playground generation). With a single shared
    timestamp the first depletion of a window swallowed the FIRST event of every
    other issue, so a newly-opening issue could be delayed 15 minutes or — if
    the depletion cleared inside the window — never open at all.
    """
    first = _depletion_event(transaction="/api/v1/ai/images/generate")
    assert app._before_send(first, None) is first

    # Same window, different endpoint: still has to reach Sentry.
    other = _depletion_event(transaction="/api/v1/playgrounds/generate/start")
    assert app._before_send(other, None) is other

    third = _depletion_event(transaction="/api/v1/activities/{activity_uuid}")
    assert app._before_send(third, None) is third

    # ...and each bucket is independently throttled from then on.
    for transaction in (
        "/api/v1/ai/images/generate",
        "/api/v1/playgrounds/generate/start",
        "/api/v1/activities/{activity_uuid}",
    ):
        assert app._before_send(_depletion_event(transaction=transaction), None) is None


def test_the_throttle_map_cannot_grow_without_bound():
    """A dict on the before_send path needs a ceiling, and the overflow has to
    fail OPEN — dropping the map only costs one extra report per bucket."""
    for i in range(app._QUOTA_REPORT_MAX_KEYS + 5):
        event = _depletion_event(transaction=f"/api/v1/t/{i}")
        assert app._before_send(event, None) is event
    assert len(app._quota_last_reported_at) <= app._QUOTA_REPORT_MAX_KEYS


def test_rate_limit_resource_exhausted_is_never_throttled():
    """RESOURCE_EXHAUSTED is Google's per-minute RPM refusal too.

    That one is actionable — backoff, a concurrency cap, a quota increase — so it
    must not be swept into the depletion rule. Every one of these reaches Sentry,
    including the second and third in a burst.
    """
    for _ in range(3):
        event = _event(
            exception={
                "values": [
                    {
                        "type": "ClientError",
                        "value": (
                            "429 RESOURCE_EXHAUSTED. {'error': {'message': "
                            "'You exceeded your current quota, please check your "
                            "plan and billing details'}}"
                        ),
                        "mechanism": {"type": "google_genai", "handled": False},
                    }
                ]
            }
        )
        assert app._before_send(event, None) is event


def test_depletion_markers_do_not_contain_rate_limit_wording():
    """Pins the narrowing itself, not just one sample body."""
    assert "resource_exhausted" not in app._QUOTA_DEPLETED_MARKERS
    assert "quota exceeded" not in app._QUOTA_DEPLETED_MARKERS
    assert "credits are depleted" in app._QUOTA_DEPLETED_MARKERS


def test_depletion_markers_agree_with_the_provider_classifier():
    """app.py and provider.py must not drift apart on what "terminal" means.

    They are separate lists on purpose — importing provider.py at app.py module
    scope would make an AI import error a total API outage — so the agreement is
    pinned here instead.

    EQUALITY, not a subset. The two tuples are the same list element for element:
    provider.py already excludes per-day/longer-window wording ("it is not a
    spent balance"), so there is nothing for a subset to narrow. A one-way check
    would let provider.py grow a marker app.py never learned about, and that
    direction is a real bug too — an error the app handles cleanly as terminal
    would keep opening Sentry issues at full rate.
    """
    from src.services.ai.llm.provider import QUOTA_DEPLETION_MARKERS

    assert set(app._QUOTA_DEPLETED_MARKERS) == set(QUOTA_DEPLETION_MARKERS), (
        "app.py's _QUOTA_DEPLETED_MARKERS and provider.py's "
        "QUOTA_DEPLETION_MARKERS have drifted apart; they must stay identical"
    )

    # Neither list treats a longer-window quota cap as depletion.
    assert "per day" not in app._QUOTA_DEPLETED_MARKERS
    assert "per day" not in QUOTA_DEPLETION_MARKERS


def test_other_provider_errors_are_kept():
    """An unexpected provider failure is exactly what the integration is for."""
    event = _event(
        exception={
            "values": [
                {
                    "type": "ServerError",
                    "value": "500 INTERNAL",
                    "mechanism": {"type": "google_genai", "handled": False},
                }
            ]
        }
    )
    assert app._before_send(event, None) is event


def test_quota_wording_from_an_unrelated_mechanism_is_kept():
    """The rule is scoped to the SDK integrations, not to the word 'quota'."""
    event = _event(
        exception={
            "values": [
                {
                    "type": "RuntimeError",
                    "value": "storage credits are depleted",
                    "mechanism": {"type": "starlette", "handled": False},
                }
            ]
        }
    )
    assert app._before_send(event, None) is event


def test_ordinary_events_pass_through_untouched():
    event = _event(transaction="/api/v1/orgs", logger="src.services.orgs.orgs")
    assert app._before_send(event, None) is event
