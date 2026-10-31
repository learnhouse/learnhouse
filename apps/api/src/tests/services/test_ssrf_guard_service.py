import ipaddress
import socket
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from src.services.utils.ssrf_guard import (
    SSRFBlockedError,
    _is_ip_blocked,
    _normalize,
    assert_connected_peer_allowed,
    resolve_and_validate_url,
)


def _response_with_peer(peer_value):
    return SimpleNamespace(
        extensions={
            "network_stream": SimpleNamespace(
                get_extra_info=lambda name: peer_value if name == "server_addr" else None
            )
        }
    )


def test_normalize_unwraps_ipv4_mapped_ipv6():
    mapped = ipaddress.ip_address("::ffff:192.0.2.10")

    normalized = _normalize(mapped)

    assert str(normalized) == "192.0.2.10"


def test_is_ip_blocked_matches_private_and_public_ranges():
    assert _is_ip_blocked(ipaddress.ip_address("10.1.2.3"))
    assert not _is_ip_blocked(ipaddress.ip_address("93.184.216.34"))


def test_resolve_and_validate_url_rejects_disallowed_scheme():
    with pytest.raises(SSRFBlockedError, match="URL scheme not allowed"):
        resolve_and_validate_url("ftp://example.com")


def test_resolve_and_validate_url_rejects_missing_hostname():
    with pytest.raises(SSRFBlockedError, match="URL has no hostname"):
        resolve_and_validate_url("http:///no-host")


@pytest.mark.parametrize(
    "hostname",
    ["localhost", "LOCALHOST", "metadata.google.internal"],
)
def test_resolve_and_validate_url_rejects_blocked_hostnames(hostname):
    with pytest.raises(SSRFBlockedError, match="Blocked hostname"):
        resolve_and_validate_url(f"https://{hostname}/page")


def test_resolve_and_validate_url_wraps_dns_errors():
    with patch(
        "src.services.utils.ssrf_guard.socket.getaddrinfo",
        side_effect=socket.gaierror("boom"),
    ):
        with pytest.raises(SSRFBlockedError, match="Could not resolve hostname"):
            resolve_and_validate_url("https://example.com")


def test_resolve_and_validate_url_rejects_blocked_ip_ranges():
    addr_info = [
        (None, None, None, None, ("10.0.0.4", 443)),
    ]

    with patch(
        "src.services.utils.ssrf_guard.socket.getaddrinfo",
        return_value=addr_info,
    ):
        with pytest.raises(SSRFBlockedError, match="blocked address range"):
            resolve_and_validate_url("https://example.com")


def test_resolve_and_validate_url_rejects_empty_resolution():
    with patch(
        "src.services.utils.ssrf_guard.socket.getaddrinfo",
        return_value=[],
    ):
        with pytest.raises(SSRFBlockedError, match="No addresses resolved"):
            resolve_and_validate_url("https://example.com")


def test_resolve_and_validate_url_returns_normalized_address_set():
    addr_info = [
        (None, None, None, None, ("93.184.216.34", 443)),
        (None, None, None, None, ("93.184.216.34", 443)),
    ]

    with patch(
        "src.services.utils.ssrf_guard.socket.getaddrinfo",
        return_value=addr_info,
    ):
        validated = resolve_and_validate_url("https://example.com")

    assert validated == {"93.184.216.34"}


def test_assert_connected_peer_allowed_requires_network_stream():
    response = SimpleNamespace(extensions={})

    with pytest.raises(SSRFBlockedError, match="Cannot determine peer address"):
        assert_connected_peer_allowed(response, {"93.184.216.34"})


def test_assert_connected_peer_allowed_wraps_stream_errors():
    response = SimpleNamespace(
        extensions={
            "network_stream": SimpleNamespace(
                get_extra_info=lambda name: (_ for _ in ()).throw(RuntimeError("bad stream"))
            )
        }
    )

    with pytest.raises(SSRFBlockedError, match="Failed to read peer address"):
        assert_connected_peer_allowed(response, {"93.184.216.34"})


def test_assert_connected_peer_allowed_requires_peer_address():
    response = _response_with_peer(None)

    with pytest.raises(SSRFBlockedError, match="Peer address unavailable"):
        assert_connected_peer_allowed(response, {"93.184.216.34"})


def test_assert_connected_peer_allowed_rejects_unparseable_peer():
    response = _response_with_peer(("not-an-ip", 443))

    with pytest.raises(SSRFBlockedError, match="Could not parse peer address"):
        assert_connected_peer_allowed(response, {"93.184.216.34"})


def test_assert_connected_peer_allowed_rejects_blocked_peer_ip():
    response = _response_with_peer(("127.0.0.1", 443))

    with pytest.raises(SSRFBlockedError, match="Connected to blocked peer IP"):
        assert_connected_peer_allowed(response, {"127.0.0.1"})


def test_assert_connected_peer_allowed_rejects_rebinding():
    response = _response_with_peer(("93.184.216.35", 443))

    with pytest.raises(SSRFBlockedError, match="DNS rebinding detected"):
        assert_connected_peer_allowed(response, {"93.184.216.34"})


def test_assert_connected_peer_allowed_accepts_ipv4_mapped_peer():
    response = _response_with_peer(("::ffff:93.184.216.34", 443))

    assert_connected_peer_allowed(response, {"93.184.216.34"})


class _RecordingServer:
    """Plain HTTP server on loopback that records the requests it receives."""

    def __init__(self):
        import threading
        from http.server import BaseHTTPRequestHandler, HTTPServer

        hits = self.hits = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                hits.append((self.path, self.headers.get("Host")))
                self.send_response(200)
                self.end_headers()

            def log_message(self, *args):
                pass

        self._server = HTTPServer(("127.0.0.1", 0), Handler)
        self.port = self._server.server_address[1]
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

    def close(self):
        self._server.shutdown()
        self._server.server_close()


@pytest.fixture
def recording_server():
    server = _RecordingServer()
    yield server
    server.close()


@pytest.mark.asyncio
async def test_pinned_transport_refuses_a_name_that_rebinds_to_a_private_address(recording_server):
    import httpx
    from src.services.utils.ssrf_guard import pinned_transport

    # Whatever the caller validated earlier, the connect-time lookup says loopback
    loopback = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 0))]
    with patch("src.services.utils.ssrf_guard.socket.getaddrinfo", return_value=loopback):
        async with httpx.AsyncClient(transport=pinned_transport()) as client:
            with pytest.raises(SSRFBlockedError):
                await client.get(f"http://rebind.test:{recording_server.port}/admin")

    assert recording_server.hits == []


@pytest.mark.asyncio
async def test_pinned_transport_connects_to_the_validated_address(recording_server):
    import httpx
    from src.services.utils.ssrf_guard import pinned_transport

    # Stand in for a validated public address; the OS resolver is never asked
    with patch(
        "src.services.utils.ssrf_guard._resolve_and_validate_host", return_value=["127.0.0.1"]
    ), patch(
        "src.services.utils.ssrf_guard.socket.getaddrinfo", side_effect=AssertionError("re-resolved")
    ):
        async with httpx.AsyncClient(transport=pinned_transport()) as client:
            response = await client.get(f"http://pinned.test:{recording_server.port}/ok")

    assert response.status_code == 200
    assert recording_server.hits == [("/ok", f"pinned.test:{recording_server.port}")]


@pytest.mark.asyncio
async def test_pinned_transport_falls_back_to_the_next_validated_address(recording_server):
    import httpx
    from src.services.utils.ssrf_guard import pinned_transport

    # First address refuses (nothing listens on ::1 here), the second works
    with patch(
        "src.services.utils.ssrf_guard._resolve_and_validate_host",
        return_value=["::1", "127.0.0.1"],
    ):
        async with httpx.AsyncClient(transport=pinned_transport()) as client:
            response = await client.get(f"http://multi.test:{recording_server.port}/ok")

    assert response.status_code == 200
    assert recording_server.hits == [("/ok", f"multi.test:{recording_server.port}")]


def test_connect_validated_falls_back_to_the_next_address(recording_server):
    from src.services.utils.ssrf_guard import connect_validated

    with patch(
        "src.services.utils.ssrf_guard._resolve_and_validate_host",
        return_value=["::1", "127.0.0.1"],
    ):
        with connect_validated("multi.test", recording_server.port, timeout=2) as sock:
            assert sock.getpeername()[0] == "127.0.0.1"
