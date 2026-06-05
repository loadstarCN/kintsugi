"""Auth strategies for the Kintsugi SDK.

Three modes:
  · CookieAuth — browser session cookie (only useful when SDK runs in a logged-in
    browser context; httpx itself doesn't run in a browser, but you can pass the
    raw cookie value through env-injected headers if you need it server-side)
  · BearerAuth — JWT in Authorization header
  · AccessKeyAuth — long-lived HMAC; recommended for server-to-server calls

Each is a tiny dataclass + an apply() that mutates a request dict (method/path/body/headers)
in-place. The caller is responsible for the actual transport.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import hmac
import secrets
import time
from typing import Protocol


class Auth(Protocol):
    """Plug-in auth contract. Receives the prepared request and adds headers / cookies."""

    def apply(self, *, method: str, path: str, body: str, headers: dict[str, str]) -> None: ...

    def use_cookie_jar(self) -> bool: ...


@dataclass(frozen=True)
class CookieAuth:
    """Cookie auth — leave the request as-is and let the cookie jar do the work."""

    def apply(self, **_kwargs) -> None:  # noqa: ANN003
        return None

    def use_cookie_jar(self) -> bool:
        return True


@dataclass(frozen=True)
class BearerAuth:
    token: str

    def apply(self, *, method: str, path: str, body: str, headers: dict[str, str]) -> None:
        del method, path, body
        headers["Authorization"] = f"Bearer {self.token}"

    def use_cookie_jar(self) -> bool:
        return False


@dataclass(frozen=True)
class AccessKeyAuth:
    access_key: str
    secret_key: str

    def apply(self, *, method: str, path: str, body: str, headers: dict[str, str]) -> None:
        # path 不带 query，body 用调用方已经规范化好的字符串。
        # 协议见 docstring + 服务端 hmac.guard。
        sign_path = path.split("?", 1)[0]
        timestamp = str(int(time.time()))
        nonce = secrets.token_hex(8)
        canonical = "\n".join([method.upper(), sign_path, timestamp, nonce, body])
        signature = hmac.new(
            self.secret_key.encode("utf-8"),
            canonical.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        headers["X-Access-Key"] = self.access_key
        headers["X-Timestamp"] = timestamp
        headers["X-Nonce"] = nonce
        headers["X-Signature"] = signature

    def use_cookie_jar(self) -> bool:
        return False
