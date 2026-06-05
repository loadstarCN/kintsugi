"""Kintsugi platform SDK for Python.

Sync (KintsugiClient) + async (AsyncKintsugiClient) clients with three auth modes:
  - cookie  (browser session)
  - bearer  (JWT)
  - access-key (HMAC-SHA256, recommended for server-to-server)

The HMAC signature scheme matches the TypeScript SDK exactly:
  canonical = METHOD + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + body
  signature = hmac_sha256(secret, canonical).hex()
  body == "" when payload is None / empty dict / empty string (server-side hmac.guard
  uses the same rule, so the two have to agree).
"""

from .auth import AccessKeyAuth, Auth, BearerAuth, CookieAuth
from .client import AsyncKintsugiClient, KintsugiClient
from .errors import KintsugiHTTPError

__all__ = [
    "AccessKeyAuth",
    "AsyncKintsugiClient",
    "Auth",
    "BearerAuth",
    "CookieAuth",
    "KintsugiClient",
    "KintsugiHTTPError",
]
__version__ = "0.1.0"
