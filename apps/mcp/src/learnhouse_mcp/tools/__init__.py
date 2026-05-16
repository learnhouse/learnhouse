"""Tool registration entry point.

Each submodule exposes `register(mcp, lh)`; `register_all` calls them in
order so a single import wires the full Atlas tool catalog.
"""

from mcp.server.fastmcp import FastMCP

from ..lh_client import LHClient
from . import destructive, macros, reads, writes


def register_all(mcp: FastMCP, lh: LHClient) -> None:
    reads.register(mcp, lh)
    writes.register(mcp, lh)
    destructive.register(mcp, lh)
    macros.register(mcp, lh)
