"""
SSRF guard for outbound HTTP calls where the URL is user-influenced
(webhook endpoints, link previews, etc.).

The guard has two steps:

1. ``resolve_and_validate_url`` resolves the hostname once and rejects the
   request if any resolved address falls in a private/reserved range. It
   returns the set of validated IPs.
2. ``pinned_transport`` gives httpx a network backend that resolves and
   validates the host again at connect time and connects to the validated
   IP itself, so a DNS answer that flips after step 1 (rebinding) never
   receives a byte.
3. ``assert_connected_peer_allowed`` runs once the response headers arrive
   and re-checks the TCP peer, as a backstop.
"""

import asyncio
import ipaddress
import socket
from urllib.parse import urlparse

import httpcore
import httpx


_BLOCKED_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("::ffff:0:0/96"),  # IPv4-mapped IPv6
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]

_BLOCKED_HOSTNAMES = {"localhost", "metadata.google.internal"}


class SSRFBlockedError(Exception):
    """Raised when a URL or its resolved peer is not permitted."""


def _normalize(ip: ipaddress._BaseAddress) -> ipaddress._BaseAddress:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        return ip.ipv4_mapped
    return ip


# IPv6 prefixes that carry an IPv4 address in their low 32 bits: NAT64
# (64:ff9b::/96) and the deprecated IPv4-compatible form (::/96).
_IPV4_EMBEDDING_NETWORKS = [
    ipaddress.ip_network("64:ff9b::/96"),
    ipaddress.ip_network("::/96"),
]


def _embedded_ipv4(ip: ipaddress._BaseAddress) -> list[ipaddress.IPv4Address]:
    """IPv4 addresses an IPv6 address can route to (mapped, 6to4, Teredo, NAT64)."""
    if not isinstance(ip, ipaddress.IPv6Address):
        return []
    embedded = []
    if ip.ipv4_mapped:
        embedded.append(ip.ipv4_mapped)
    if ip.sixtofour:
        embedded.append(ip.sixtofour)
    if ip.teredo:
        embedded.extend(ip.teredo)
    if any(ip in net for net in _IPV4_EMBEDDING_NETWORKS):
        embedded.append(ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF))
    return embedded


def _is_ip_blocked(ip: ipaddress._BaseAddress) -> bool:
    """Only globally routable unicast addresses are allowed, for the address
    itself and for any IPv4 address embedded in it."""
    for candidate in (_normalize(ip), *_embedded_ipv4(ip)):
        # The explicit list backs up is_global, whose ranges vary by Python version.
        if (
            not candidate.is_global
            or candidate.is_multicast
            or getattr(candidate, "is_site_local", False)
            or any(candidate in net for net in _BLOCKED_NETWORKS)
        ):
            return True
    return False


def resolve_and_validate_url(url: str, *, allow_http: bool = True) -> set[str]:
    """
    Resolve the hostname in ``url`` and verify every returned IP is public.

    Returns the set of validated peer-IP strings that the subsequent httpx
    request is allowed to connect to. Raises :class:`SSRFBlockedError` on
    any validation failure.
    """
    parsed = urlparse(url)

    allowed_schemes = {"http", "https"} if allow_http else {"https"}
    if parsed.scheme not in allowed_schemes:
        raise SSRFBlockedError(f"URL scheme not allowed: {parsed.scheme!r}")

    hostname = parsed.hostname
    if not hostname:
        raise SSRFBlockedError("URL has no hostname")

    return set(_resolve_and_validate_host(hostname))


def _resolve_and_validate_host(hostname: str) -> list[str]:
    """Resolve ``hostname`` and return its addresses, in resolver order, if all are public."""
    if hostname.lower() in _BLOCKED_HOSTNAMES:
        raise SSRFBlockedError(f"Blocked hostname: {hostname}")

    try:
        addr_infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise SSRFBlockedError(f"Could not resolve hostname: {hostname}") from exc

    validated: list[str] = []
    for _, _, _, _, sockaddr in addr_infos:
        ip = ipaddress.ip_address(sockaddr[0])
        if _is_ip_blocked(ip):
            raise SSRFBlockedError(
                f"{hostname} resolves to blocked address range ({ip})"
            )
        key = str(_normalize(ip))
        if key not in validated:
            validated.append(key)

    if not validated:
        raise SSRFBlockedError(f"No addresses resolved for hostname: {hostname}")

    return validated


def connect_validated(hostname: str, port: int, timeout: float) -> socket.socket:
    """Open a TCP connection to ``hostname`` on an address that passed the guard."""
    ip = _resolve_and_validate_host(hostname)[0]
    return socket.create_connection((ip, port), timeout=timeout)


class _PinnedNetworkBackend(httpcore.AsyncNetworkBackend):
    """Resolves and validates the host at connect time, then connects to that IP.

    TLS still runs against the original hostname (httpcore passes it as the
    server name), so certificate checks are unchanged.
    """

    def __init__(self) -> None:
        self._backend = httpcore.AnyIOBackend()

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        ips = await asyncio.to_thread(_resolve_and_validate_host, host)
        return await self._backend.connect_tcp(
            ips[0], port, timeout=timeout, local_address=local_address,
            socket_options=socket_options,
        )

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        raise SSRFBlockedError("Unix sockets are not allowed")

    async def sleep(self, seconds: float) -> None:
        await self._backend.sleep(seconds)


def pinned_transport() -> httpx.AsyncHTTPTransport:
    """An httpx transport that only ever connects to guard-approved addresses."""
    transport = httpx.AsyncHTTPTransport()
    # httpx has no public hook for the network backend; httpx is pinned and
    # tests/security cover this, so a layout change fails loudly.
    pool = transport._pool
    if not isinstance(pool, httpcore.AsyncConnectionPool):
        raise RuntimeError("Unexpected httpx transport layout; cannot pin connections")
    pool._network_backend = _PinnedNetworkBackend()
    return transport


def assert_connected_peer_allowed(
    response: httpx.Response, validated_ips: set[str]
) -> None:
    """
    After an httpx request, confirm the peer httpx actually connected to was
    one of the IPs approved by :func:`resolve_and_validate_url`.

    Defeats DNS rebinding: even if DNS flipped between validation and connect,
    the peer IP is observable on the response's network_stream extension.

    Raises :class:`SSRFBlockedError` on mismatch; callers must discard any
    response body already read in that case.
    """
    stream = response.extensions.get("network_stream")
    if stream is None:
        raise SSRFBlockedError("Cannot determine peer address; fail closed")

    try:
        peer = stream.get_extra_info("server_addr")
    except Exception as exc:  # httpcore / transport idiosyncrasies
        raise SSRFBlockedError(f"Failed to read peer address: {exc}") from exc

    if not peer:
        raise SSRFBlockedError("Peer address unavailable; fail closed")

    peer_host = peer[0] if isinstance(peer, tuple) else str(peer)
    try:
        peer_ip = ipaddress.ip_address(peer_host)
    except ValueError as exc:
        raise SSRFBlockedError(f"Could not parse peer address: {peer_host!r}") from exc

    # Defense in depth: peer must not itself land in a blocked range.
    if _is_ip_blocked(peer_ip):
        raise SSRFBlockedError(f"Connected to blocked peer IP: {peer_ip}")

    peer_key = str(_normalize(peer_ip))
    if peer_key not in validated_ips:
        raise SSRFBlockedError(
            f"DNS rebinding detected: connected to {peer_key}, "
            f"validated addresses were {sorted(validated_ips)}"
        )
