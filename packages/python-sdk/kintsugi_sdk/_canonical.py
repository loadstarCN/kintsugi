"""Canonicalization helpers shared by the sync + async clients."""

from __future__ import annotations

import json
from typing import Any


def serialize_body_for_sign(body: Any) -> str:
    """Match the TS SDK's serializeBodyForSign exactly.

    None / empty dict / empty string → "" (server-side hmac.guard uses the same rule).
    Everything else → JSON.stringify-equivalent (compact, separators with no spaces).
    """
    if body is None:
        return ""
    if isinstance(body, str):
        return body
    if isinstance(body, dict) and len(body) == 0:
        return ""
    return json.dumps(body, ensure_ascii=False, separators=(",", ":"))
