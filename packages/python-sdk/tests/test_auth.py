"""Auth header generation — make sure HMAC matches what the server expects."""

import hashlib
import hmac

from kintsugi_sdk.auth import AccessKeyAuth, BearerAuth, CookieAuth


def test_bearer_sets_authorization():
    headers: dict[str, str] = {}
    BearerAuth("abc").apply(method="GET", path="/x", body="", headers=headers)
    assert headers["Authorization"] == "Bearer abc"


def test_cookie_no_op():
    headers: dict[str, str] = {}
    CookieAuth().apply(method="GET", path="/x", body="", headers=headers)
    assert headers == {}


def test_access_key_sets_4_headers():
    auth = AccessKeyAuth(access_key="ak_test", secret_key="s3cret")
    headers: dict[str, str] = {}
    auth.apply(method="POST", path="/api/x", body='{"a":1}', headers=headers)
    assert headers["X-Access-Key"] == "ak_test"
    assert "X-Timestamp" in headers
    assert len(headers["X-Nonce"]) >= 16
    # signature is hex-encoded SHA256, 64 chars
    assert len(headers["X-Signature"]) == 64
    # verify it matches manual HMAC over the canonical string
    canonical = (
        f"POST\n/api/x\n{headers['X-Timestamp']}\n{headers['X-Nonce']}\n" + '{"a":1}'
    )
    expected = hmac.new(
        b"s3cret", canonical.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    assert headers["X-Signature"] == expected


def test_access_key_strips_query_from_path():
    """Server signs the path WITHOUT query string. If we sign with query, mismatch."""
    auth = AccessKeyAuth("ak", "s")
    h_with_query: dict[str, str] = {}
    h_no_query: dict[str, str] = {}
    auth.apply(method="GET", path="/api/x?a=1", body="", headers=h_with_query)
    # use same timestamp + nonce to compare just the canonical handling
    auth_clone = AccessKeyAuth("ak", "s")
    auth_clone.apply(method="GET", path="/api/x", body="", headers=h_no_query)
    # signatures differ only because timestamp / nonce differ — but recompute manually
    canonical_q = (
        f"GET\n/api/x\n{h_with_query['X-Timestamp']}\n{h_with_query['X-Nonce']}\n"
    )
    expected_q = hmac.new(
        b"s", canonical_q.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    assert h_with_query["X-Signature"] == expected_q  # path was stripped of `?a=1`
