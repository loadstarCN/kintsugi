"""SDK error types."""

from __future__ import annotations

from typing import Any


class KintsugiHTTPError(Exception):
    """Raised when the platform returns a non-2xx response.

    The body (if JSON) gets parsed; otherwise the raw text is kept.
    `code` and `message` come from the server's KintsugiError envelope when present.
    """

    def __init__(self, status: int, body: Any) -> None:
        self.status = status
        self.body = body
        if isinstance(body, dict):
            self.code = body.get("code")
            self.message = body.get("message", "")
        else:
            self.code = None
            self.message = str(body)[:200] if body is not None else ""
        super().__init__(f"HTTP {status} {self.code or ''}: {self.message}".strip())
