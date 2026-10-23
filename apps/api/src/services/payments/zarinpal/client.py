"""
HTTP client for the ZarinPal payment gateway (REST API v4).

Mirrors the conventions of ``src/services/payments/irankish/client.py``: a
lazily-built, rebuilt-on-config-change ``httpx.AsyncClient`` singleton, an
``is_*_enabled()`` probe, and a three-way exception split so the service layer
can map each failure class to the right HTTP status:

  - ZarinPalNotConfigured  : no merchant id on this instance (-> 503).
  - ZarinPalTransportError : network / DNS / timeout / non-200 (-> 502).
  - ZarinPalError          : a gateway *application* error carrying the ZarinPal
                             numeric ``code`` so callers can distinguish e.g. a
                             declined request from an invalid merchant id (-> 4xx).

Two gateway operations are wrapped:

  * ``request_payment`` -> POST pg/v4/payment/request.json (get an authority)
  * ``verify``          -> POST pg/v4/payment/verify.json   (settle after callback)

The redirect to the payment page itself is a browser GET to
``{start_pay_base_url}/pg/StartPay/{authority}`` and is built in the service
layer, not here.

ZarinPal response shape (v4):
    { "data": { "code": 100, "authority": "A000...", ... }, "errors": [] }
On error ``data`` may be an empty list and ``errors`` carries the detail:
    { "data": [], "errors": { "code": -9, "message": "...", ... } }
"""

import logging
from typing import Any, Optional

import httpx

from config.config import ZarinPalConfig, get_learnhouse_config

logger = logging.getLogger(__name__)

# Relative resources under the configured API base host.
RESOURCE_REQUEST = "/pg/v4/payment/request.json"
RESOURCE_VERIFY = "/pg/v4/payment/verify.json"
# The hosted payment page path the buyer is redirected to (browser GET). The
# authority is appended: /pg/StartPay/{authority}.
RESOURCE_START_PAY = "/pg/StartPay/"

# ZarinPal numeric success codes.
CODE_SUCCESS = 100          # request accepted / payment verified
CODE_ALREADY_VERIFIED = 101  # verify called again on an already-settled payment


class ZarinPalNotConfigured(Exception):
    """Raised when the ZarinPal integration has no merchant id set."""


class ZarinPalTransportError(Exception):
    """A network / infrastructure failure (DNS, timeout, SSL, non-200).

    Distinct from a gateway application error so it can be retried / logged
    separately.
    """


class ZarinPalError(Exception):
    """A ZarinPal *application* error.

    Carries the ZarinPal numeric ``code`` (e.g. -9 validation error, -11 request
    not found, -51 unsuccessful payment) and the human message so the service
    layer can choose an appropriate HTTP status and message.
    """

    def __init__(self, code: Any, message: Optional[str] = None):
        self.code = code
        self.message = message
        super().__init__(f"ZarinPal error {code}: {message or ''}".strip())


# Lazy singleton client, rebuilt whenever the configured base host changes.
_client: Optional[httpx.AsyncClient] = None
_client_base: Optional[str] = None


def get_config() -> ZarinPalConfig:
    """Return the ZarinPal config or raise if the integration is not configured."""
    cfg = get_learnhouse_config().zarinpal_config
    if cfg is None:
        raise ZarinPalNotConfigured(
            "ZarinPal integration is not configured. Set "
            "LEARNHOUSE_ZARINPAL_MERCHANT_ID."
        )
    return cfg


def is_zarinpal_enabled() -> bool:
    return get_learnhouse_config().zarinpal_config is not None


def get_start_pay_url(authority: str) -> str:
    """Absolute URL of the hosted payment page the buyer is redirected to."""
    cfg = get_config()
    return f"{cfg.start_pay_base_url}{RESOURCE_START_PAY}{authority}"


def _get_client() -> httpx.AsyncClient:
    global _client, _client_base

    base_url = get_config().base_url
    if _client is not None and _client_base == base_url:
        return _client

    _client = httpx.AsyncClient(
        base_url=base_url,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "LearnHouse-ZarinPal/1.0",
        },
        timeout=20.0,
    )
    _client_base = base_url
    return _client


def _extract_error(data: dict) -> ZarinPalError:
    """Build a ZarinPalError from a gateway response's ``errors`` block."""
    errors = data.get("errors")
    if isinstance(errors, dict) and errors:
        return ZarinPalError(errors.get("code", "unknown"), errors.get("message"))
    # Some error shapes put the failure code inside ``data``.
    payload = data.get("data")
    if isinstance(payload, dict) and payload.get("code") is not None:
        return ZarinPalError(payload.get("code"), payload.get("message"))
    return ZarinPalError("unknown", "ZarinPal returned an unspecified error")


async def _post(resource: str, payload: dict) -> dict:
    """POST JSON to a gateway resource and return the decoded response dict.

    Raises ZarinPalTransportError for any network/non-200/non-JSON problem. The
    caller interprets ``data.code`` / ``errors`` in the returned dict.
    """
    client = _get_client()
    try:
        response = await client.post(resource, json=payload)
    except httpx.HTTPError as exc:
        logger.warning("ZarinPal transport error on %s: %s", resource, exc)
        raise ZarinPalTransportError(str(exc)) from exc

    # ZarinPal returns application-level failures as HTTP 4xx with a JSON body
    # describing the error, so parse the body before treating a non-200 purely
    # as a transport failure.
    try:
        data = response.json()
    except ValueError:
        if response.status_code != 200:
            logger.warning(
                "ZarinPal returned HTTP %s on %s", response.status_code, resource
            )
            raise ZarinPalTransportError(
                f"ZarinPal returned HTTP {response.status_code}"
            )
        raise ZarinPalTransportError("ZarinPal returned a non-JSON response")

    if not isinstance(data, dict):
        raise ZarinPalTransportError("ZarinPal returned an unexpected response shape")

    return data


async def request_payment(
    *,
    amount: int,
    callback_url: str,
    description: str,
    currency: str = "IRR",
    mobile: Optional[str] = None,
    email: Optional[str] = None,
) -> str:
    """Create a payment and return the ``authority`` string.

    Raises:
        ZarinPalNotConfigured / ZarinPalTransportError as above.
        ZarinPalError: the gateway rejected the request (code != 100 or no
            authority returned).
    """
    cfg = get_config()
    payload: dict = {
        "merchant_id": cfg.merchant_id,
        "currency": currency,
        "amount": amount,
        "callback_url": callback_url,
        "description": description,
    }
    metadata: dict = {}
    if mobile:
        metadata["mobile"] = mobile
    if email:
        metadata["email"] = email
    if metadata:
        payload["metadata"] = metadata

    data = await _post(RESOURCE_REQUEST, payload)

    result = data.get("data")
    code = result.get("code") if isinstance(result, dict) else None
    authority = result.get("authority") if isinstance(result, dict) else None

    if code != CODE_SUCCESS or not authority:
        raise _extract_error(data)

    return authority


async def verify(*, amount: int, authority: str) -> dict:
    """Verify (settle) a payment after the buyer returns from the gateway.

    Returns the ``data`` object (``{code, ref_id, card_pan, ...}``) on a 100 or
    101 (already-verified) result; raises ZarinPalError otherwise.
    """
    cfg = get_config()
    payload = {
        "merchant_id": cfg.merchant_id,
        "amount": amount,
        "authority": authority,
    }
    data = await _post(RESOURCE_VERIFY, payload)

    result = data.get("data")
    code = result.get("code") if isinstance(result, dict) else None

    if code not in (CODE_SUCCESS, CODE_ALREADY_VERIFIED):
        raise _extract_error(data)

    return result  # type: ignore[return-value]


async def close_zarinpal_client() -> None:
    """Shutdown hook: close the singleton client if open."""
    global _client, _client_base
    if _client is not None:
        await _client.aclose()
        _client = None
        _client_base = None


__all__ = [
    "CODE_ALREADY_VERIFIED",
    "CODE_SUCCESS",
    "ZarinPalError",
    "ZarinPalNotConfigured",
    "ZarinPalTransportError",
    "close_zarinpal_client",
    "get_config",
    "get_start_pay_url",
    "is_zarinpal_enabled",
    "request_payment",
    "verify",
]
