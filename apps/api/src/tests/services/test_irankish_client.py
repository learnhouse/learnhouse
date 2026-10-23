"""Tests for the IranKish HTTP client's response interpretation.

The network layer is mocked; what matters here is that each gateway response
shape maps to the right outcome: success returns the token / result, and the
various failure shapes raise the correct exception class with the response code
preserved.
"""

from unittest.mock import AsyncMock, patch

import pytest

from src.services.payments.irankish import client as c


def _resp(status_code=200, json_body=None):
    """Build a fake httpx.Response-like object."""
    m = AsyncMock()
    resp = AsyncMock()
    resp.status_code = status_code
    resp.json = lambda: json_body
    m.post = AsyncMock(return_value=resp)
    return m


@pytest.fixture(autouse=True)
def _reset_client():
    # Ensure no singleton leaks between tests.
    c._client = None
    c._client_base = None
    yield
    c._client = None
    c._client_base = None


async def test_make_token_success_returns_token():
    body = {
        "status": True,
        "responseCode": "00",
        "result": {"token": "TOKEN123", "transactionType": "Purchase"},
    }
    with patch.object(c, "_get_client", return_value=_resp(json_body=body)):
        token = await c.make_token({"amount": 1000}, {"data": "x", "iv": "y"})
    assert token == "TOKEN123"


async def test_make_token_application_error_raises_irankish_error():
    body = {"status": False, "responseCode": "907", "description": "bad revert uri", "result": None}
    with patch.object(c, "_get_client", return_value=_resp(json_body=body)):
        with pytest.raises(c.IranKishError) as ei:
            await c.make_token({}, {})
    assert ei.value.response_code == "907"


async def test_make_token_non_200_raises_transport_error():
    with patch.object(c, "_get_client", return_value=_resp(status_code=500, json_body={})):
        with pytest.raises(c.IranKishTransportError):
            await c.make_token({}, {})


async def test_confirm_success_returns_result():
    body = {
        "status": True,
        "responseCode": "00",
        "result": {"responseCode": "00", "amount": "1000"},
    }
    with patch.object(c, "_get_client", return_value=_resp(json_body=body)):
        result = await c.confirm(
            terminal_id="02000001",
            retrieval_reference_number="123456789012",
            system_trace_audit_number="123456",
            token_identity="TOKEN123",
            invoice_id="inv1",
            amount=1000,
        )
    assert result["responseCode"] == "00"


async def test_confirm_declined_result_raises_irankish_error():
    body = {
        "status": True,
        "responseCode": "00",
        "result": {"responseCode": "51"},  # insufficient funds on the inner result
    }
    with patch.object(c, "_get_client", return_value=_resp(json_body=body)):
        with pytest.raises(c.IranKishError) as ei:
            await c.confirm(
                terminal_id="02000001",
                retrieval_reference_number="1",
                system_trace_audit_number="2",
                token_identity="T",
            )
    assert ei.value.response_code == "51"


def test_is_enabled_reflects_config():
    class _Cfg:
        irankish_config = None

    with patch("src.services.payments.irankish.client.get_learnhouse_config", return_value=_Cfg()):
        assert c.is_irankish_enabled() is False


def test_get_config_raises_when_unconfigured():
    class _Cfg:
        irankish_config = None

    with patch("src.services.payments.irankish.client.get_learnhouse_config", return_value=_Cfg()):
        with pytest.raises(c.IranKishNotConfigured):
            c.get_config()
