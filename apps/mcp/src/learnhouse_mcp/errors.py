from typing import Any


class AtlasToolError(Exception):
    """Typed error raised inside MCP tools.

    The API translates these into `{type:"error", code, message, retriable}`
    SSE events for the frontend. Tool bodies should raise this rather than
    bare exceptions so the contract stays predictable.
    """

    def __init__(
        self,
        code: str,
        message: str,
        guidance: str | None = None,
        retriable: bool = False,
        details: dict[str, Any] | None = None,
    ):
        self.code = code
        self.message = message
        self.guidance = guidance
        self.retriable = retriable
        self.details = details or {}
        super().__init__(f"[{code}] {message}")

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "guidance": self.guidance,
            "retriable": self.retriable,
            "details": self.details,
        }
