"""
HTTP client for the IranKish (Shaparak) IPG REST services.

Mirrors the conventions of ``src/services/skyroom/client.py``: a lazily-built,
rebuilt-on-config-change ``httpx.AsyncClient`` singleton, an ``is_*_enabled()``
probe, and a three-way exception split so the service layer can map each failure
class to the right HTTP status:

  - IranKishNotConfigured  : no terminal credentials on this instance (-> 503).
  - IranKishTransportError : network / DNS / timeout / non-200 (-> 502).
  - IranKishError          : a gateway *application* error carrying the Shaparak
                             ``responseCode`` so callers can distinguish e.g. an
                             expired token from a declined card (-> 4xx).

Three gateway operations are wrapped:

  * ``make_token``  -> POST api/v3/tokenization/make  (get a payment token)
  * ``confirm``     -> POST api/v3/confirmation/purchase (verify after callback)
  * ``reverse``     -> POST api/v3/confirmation/reversePurchase (refund)

The redirect to the payment page itself is a browser-driven HTML form POST to
``/iuiv3/IPG/Index/`` and is built in the service layer, not here.
"""

import logging
from typing import Any, Optional

import httpx

from config.config import IranKishConfig, get_learnhouse_config

logger = logging.getLogger(__name__)

# Relative resources under the configured base host.
RESOURCE_MAKE_TOKEN = "/api/v3/tokenization/make"
RESOURCE_CONFIRM_PURCHASE = "/api/v3/confirmation/purchase"
RESOURCE_REVERSE_PURCHASE = "/api/v3/confirmation/reversePurchase"
# The HTML payment page the cardholder is redirected to (browser form POST).
RESOURCE_IPG_INDEX = "/iuiv3/IPG/Index/"

# A successful Shaparak transaction/confirmation uses ISO-8583 response code "00".
RESPONSE_CODE_SUCCESS = "00"


class IranKishNotConfigured(Exception):
    """Raised when the IranKish integration has no terminal credentials set."""


class IranKishTransportError(Exception):
    """A network / infrastructure failure (DNS, timeout, SSL, non-200).

    Distinct from a gateway application error so it can be retried / logged
    separately.
    """


class IranKishError(Exception):
    """An IranKish *application* error.

    Carries the Shaparak ``responseCode`` (ISO-8583, e.g. "51" insufficient
    funds, "907" invalid revert URL) and the human description so the service
    layer can choose an appropriate HTTP status and message.
    """

    def __init__(self, response_code: str, description: Optional[str] = None):
        self.response_code = response_code
        self.description = description
        super().__init__(f"IranKish error {response_code}: {description or ''}".strip())


# Lazy singleton client, rebuilt whenever the configured base host changes.
_client: Optional[httpx.AsyncClient] = None
_client_base: Optional[str] = None


def get_config() -> IranKishConfig:
    """Return the IranKish config or raise if the integration is not configured."""
    cfg = get_learnhouse_config().irankish_config
    if cfg is None:
        raise IranKishNotConfigured(
            "IranKish integration is not configured. Set the "
            "LEARNHOUSE_IRANKISH_* credentials."
        )
    return cfg


def is_irankish_enabled() -> bool:
    return get_learnhouse_config().irankish_config is not None


def get_payment_page_url() -> str:
    """Absolute URL of the hosted payment page the cardholder is POSTed to."""
    return f"{get_config().base_url}{RESOURCE_IPG_INDEX}"


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
            "User-Agent": "LearnHouse-IranKish/1.0",
        },
        timeout=20.0,
    )
    _client_base = base_url
    return _client


async def _post(resource: str, payload: dict) -> dict:
    """POST JSON to a gateway resource and return the decoded response dict.

    Raises IranKishTransportError for any network/non-200/non-JSON problem. The
    caller interprets ``responseCode`` / ``status`` in the returned dict.
    """
    client = _get_client()
    try:
        response = await client.post(resource, json=payload)
    except httpx.HTTPError as exc:
        logger.warning("IranKish transport error on %s: %s", resource, exc)
        raise IranKishTransportError(str(exc)) from exc

    if response.status_code != 200:
        logger.warning(
            "IranKish returned HTTP %s on %s", response.status_code, resource
        )
        raise IranKishTransportError(
            f"IranKish returned HTTP {response.status_code}"
        )

    try:
        data = response.json()
    except ValueError as exc:
        raise IranKishTransportError(
            "IranKish returned a non-JSON response"
        ) from exc

    if not isinstance(data, dict):
        raise IranKishTransportError("IranKish returned an unexpected response shape")

    return data


async def make_token(request_body: dict, authentication_envelope: dict) -> str:
    """Call the token service and return the ``token`` string.

    Raises:
        IranKishNotConfigured / IranKishTransportError as above.
        IranKishError: the gateway rejected the token request (status false or
            a non-"00" responseCode).
    """
    payload = {
        "authenticationEnvelope": authentication_envelope,
        "request": request_body,
    }
    data = await _post(RESOURCE_MAKE_TOKEN, payload)

    response_code = str(data.get("responseCode", ""))
    status_ok = bool(data.get("status"))
    result = data.get("result") or {}
    token = result.get("token") if isinstance(result, dict) else None

    if not status_ok or response_code != RESPONSE_CODE_SUCCESS or not token:
        raise IranKishError(response_code or "unknown", data.get("description"))

    return token


async def confirm(
    *,
    terminal_id: str,
    retrieval_reference_number: str,
    system_trace_audit_number: str,
    token_identity: str,
    invoice_id: Optional[str] = None,
    amount: Optional[int] = None,
) -> dict:
    """Confirm (verify) a purchase so the gateway settles it to the merchant.

    Must be called within ~20 minutes of the payment or the gateway
    auto-reverses. Returns the ``result`` object (``TransactionResponse``) on a
    "00" confirmation; raises IranKishError otherwise.
    """
    payload: dict = {
        "terminalId": terminal_id,
        "retrievalReferenceNumber": retrieval_reference_number,
        "systemTraceAuditNumber": system_trace_audit_number,
        "tokenIdentity": token_identity,
    }
    if invoice_id is not None:
        payload["invoiceId"] = invoice_id
    if amount is not None:
        payload["amount"] = str(amount)

    data = await _post(RESOURCE_CONFIRM_PURCHASE, payload)

    response_code = str(data.get("responseCode", ""))
    status_ok = bool(data.get("status"))
    result = data.get("result") or {}
    result_code = str(result.get("responseCode", "")) if isinstance(result, dict) else ""

    if not status_ok or response_code != RESPONSE_CODE_SUCCESS or result_code != RESPONSE_CODE_SUCCESS:
        raise IranKishError(
            result_code or response_code or "unknown", data.get("description")
        )

    return result


async def reverse(
    *,
    terminal_id: str,
    retrieval_reference_number: str,
    system_trace_audit_number: str,
    token_identity: str,
) -> dict:
    """Reverse (refund) a previously-confirmed purchase.

    Returns the ``result`` object on success; raises IranKishError otherwise.
    """
    payload = {
        "terminalId": terminal_id,
        "retrievalReferenceNumber": retrieval_reference_number,
        "systemTraceAuditNumber": system_trace_audit_number,
        "tokenIdentity": token_identity,
    }
    data = await _post(RESOURCE_REVERSE_PURCHASE, payload)

    response_code = str(data.get("responseCode", ""))
    status_ok = bool(data.get("status"))
    result = data.get("result") or {}
    result_code = str(result.get("responseCode", "")) if isinstance(result, dict) else ""

    if not status_ok or response_code != RESPONSE_CODE_SUCCESS or result_code != RESPONSE_CODE_SUCCESS:
        raise IranKishError(
            result_code or response_code or "unknown", data.get("description")
        )

    return result


async def close_irankish_client() -> None:
    """Shutdown hook: close the singleton client if open."""
    global _client, _client_base
    if _client is not None:
        await _client.aclose()
        _client = None
        _client_base = None


__all__ = [
    "IranKishError",
    "IranKishNotConfigured",
    "IranKishTransportError",
    "RESPONSE_CODE_SUCCESS",
    "close_irankish_client",
    "confirm",
    "get_config",
    "get_payment_page_url",
    "is_irankish_enabled",
    "make_token",
    "reverse",
]
