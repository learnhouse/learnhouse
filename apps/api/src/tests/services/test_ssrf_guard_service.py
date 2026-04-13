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
    assert not _is_ip_blocked(ipaddress.ip_address("203.0.113.10"))


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
