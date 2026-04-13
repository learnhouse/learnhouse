from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from fastapi import HTTPException

from src.services.utils.link_preview import fetch_link_preview
from src.services.utils.ssrf_guard import SSRFBlockedError


class _FakeAsyncClient:
    def __init__(self, responses):
        self._responses = list(responses)
        self.requested_urls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None

    async def get(self, url):
        self.requested_urls.append(url)
        return self._responses.pop(0)


def _make_response(
    *,
    status_code=200,
    url="https://example.com",
    is_redirect=False,
    next_request_url=None,
    content_length=None,
    html="",
    peer_ip="93.184.216.34",
):
    response = SimpleNamespace()
    response.status_code = status_code
    response.is_redirect = is_redirect
    response.next_request = (
        SimpleNamespace(url=next_request_url) if next_request_url else None
    )
    response.headers = {}
    if content_length is not None:
        response.headers["content-length"] = str(content_length)
    response.text = html
    response.extensions = {
        "network_stream": SimpleNamespace(
            get_extra_info=lambda name: (peer_ip, 443) if name == "server_addr" else None
        )
    }
    response.raise_for_status = Mock(return_value=None)
    return response


@pytest.mark.asyncio
async def test_fetch_link_preview_success_with_redirect_and_relative_assets():
    redirect_url = "https://example.com/final"
    responses = [
        _make_response(
            status_code=301,
            is_redirect=True,
            next_request_url=redirect_url,
            html="",
        ),
        _make_response(
            url=redirect_url,
            html=(
                "<html>"
                "<head>"
                "<title>  Example Title  </title>"
                '<meta property="og:description" content="A short description">'
                '<meta property="og:image" content="/images/preview.png">'
                '<meta property="og:type" content="article">'
                '<meta property="og:url" content="https://canonical.example/page">'
                '<link rel="shortcut icon" href="/static/favicon.ico">'
                "</head>"
                "<body>content</body>"
                "</html>"
            ),
        ),
    ]
    fake_client = _FakeAsyncClient(responses)

    with patch(
        "src.services.utils.link_preview.resolve_and_validate_url",
        side_effect=[{"93.184.216.34"}, {"93.184.216.34"}],
    ) as mock_validate, patch(
        "src.services.utils.link_preview.assert_connected_peer_allowed"
    ) as mock_peer_allowed, patch(
        "src.services.utils.link_preview.httpx.AsyncClient",
        return_value=fake_client,
    ):
        result = await fetch_link_preview("https://example.com/start")

    assert result == {
        "title": "Example Title",
        "description": "A short description",
        "og_image": "https://example.com/images/preview.png",
        "favicon": "https://example.com/static/favicon.ico",
        "og_type": "article",
        "og_url": "https://canonical.example/page",
        "url": "https://example.com/start",
    }
    assert fake_client.requested_urls == ["https://example.com/start", redirect_url]
    assert mock_validate.call_args_list[0].args == ("https://example.com/start",)
    assert mock_validate.call_args_list[1].args == (redirect_url,)
    assert mock_peer_allowed.call_count == 2


@pytest.mark.asyncio
async def test_fetch_link_preview_uses_fallbacks_when_metadata_missing():
    response = _make_response(
        html="<html><head></head><body>No metadata</body></html>",
    )
    fake_client = _FakeAsyncClient([response])

    with patch(
        "src.services.utils.link_preview.resolve_and_validate_url",
        return_value={"93.184.216.34"},
    ), patch(
        "src.services.utils.link_preview.assert_connected_peer_allowed"
    ) as mock_peer_allowed, patch(
        "src.services.utils.link_preview.httpx.AsyncClient",
        return_value=fake_client,
    ):
        result = await fetch_link_preview("https://example.com/page")

    assert result == {
        "title": None,
        "description": None,
        "og_image": None,
        "favicon": "https://example.com/favicon.ico",
        "og_type": None,
        "og_url": "https://example.com/page",
        "url": "https://example.com/page",
    }
    mock_peer_allowed.assert_called_once()


@pytest.mark.asyncio
async def test_fetch_link_preview_blocks_invalid_url_before_request():
    with patch(
        "src.services.utils.link_preview.resolve_and_validate_url",
        side_effect=SSRFBlockedError("Blocked hostname: localhost"),
    ), patch(
        "src.services.utils.link_preview.httpx.AsyncClient"
    ) as mock_client:
        with pytest.raises(HTTPException) as exc_info:
            await fetch_link_preview("http://localhost/page")

    assert exc_info.value.status_code == 400
    assert "Blocked hostname" in exc_info.value.detail
    mock_client.assert_not_called()


@pytest.mark.asyncio
async def test_fetch_link_preview_blocks_peer_validation_errors():
    response = _make_response(html="<html><head><title>Title</title></head></html>")
    fake_client = _FakeAsyncClient([response])

    with patch(
        "src.services.utils.link_preview.resolve_and_validate_url",
        return_value={"93.184.216.34"},
    ), patch(
        "src.services.utils.link_preview.assert_connected_peer_allowed",
        side_effect=SSRFBlockedError("DNS rebinding detected"),
    ), patch(
        "src.services.utils.link_preview.httpx.AsyncClient",
        return_value=fake_client,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await fetch_link_preview("https://example.com/page")

    assert exc_info.value.status_code == 400
    assert "DNS rebinding detected" in exc_info.value.detail


@pytest.mark.asyncio
async def test_fetch_link_preview_rejects_oversized_responses():
    response = _make_response(
        content_length=5 * 1024 * 1024 + 1,
        html="<html><head><title>Too big</title></head></html>",
    )
    fake_client = _FakeAsyncClient([response])

    with patch(
        "src.services.utils.link_preview.resolve_and_validate_url",
        return_value={"93.184.216.34"},
    ), patch(
        "src.services.utils.link_preview.assert_connected_peer_allowed"
    ), patch(
        "src.services.utils.link_preview.httpx.AsyncClient",
        return_value=fake_client,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await fetch_link_preview("https://example.com/page")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Response too large"


@pytest.mark.asyncio
async def test_fetch_link_preview_blocks_redirect_peer_validation_and_fallback_favicon():
    redirect_url = "https://example.com/redirected"
    response = _make_response(
        is_redirect=True,
        next_request_url=redirect_url,
        html="<html><head><title>Redirect</title></head></html>",
    )
    fake_client = _FakeAsyncClient(
        [
            response,
            _make_response(
                url=redirect_url,
                html="<html><head><title>Redirected</title></head></html>",
            ),
        ]
    )

    with patch(
        "src.services.utils.link_preview.resolve_and_validate_url",
        side_effect=[{"93.184.216.34"}, {"93.184.216.34"}],
    ), patch(
        "src.services.utils.link_preview.assert_connected_peer_allowed",
        side_effect=[None, SSRFBlockedError("blocked redirect peer")],
    ), patch(
        "src.services.utils.link_preview.httpx.AsyncClient",
        return_value=fake_client,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await fetch_link_preview("https://example.com/page")

    assert exc_info.value.status_code == 400
    assert "blocked redirect peer" in exc_info.value.detail


@pytest.mark.asyncio
async def test_fetch_link_preview_uses_fallback_favicon_for_relative_icon():
    response = _make_response(
        html=(
            "<html><head>"
            "<title>Title</title>"
            '<link rel="icon" href="/favicon-alt.ico">'
            "</head></html>"
        )
    )
    fake_client = _FakeAsyncClient([response])

    with patch(
        "src.services.utils.link_preview.resolve_and_validate_url",
        return_value={"93.184.216.34"},
    ), patch(
        "src.services.utils.link_preview.assert_connected_peer_allowed"
    ), patch(
        "src.services.utils.link_preview.httpx.AsyncClient",
        return_value=fake_client,
    ):
        result = await fetch_link_preview("https://example.com/page")

    assert result["favicon"] == "https://example.com/favicon-alt.ico"
