"""Sign-canonicalization tests.

These mirror the TS SDK's serializeBodyForSign exactly. If they drift, the server
hmac.guard rejects requests with "signature mismatch" — keep these green.
"""

from kintsugi_sdk._canonical import serialize_body_for_sign


def test_none_is_empty_string():
    assert serialize_body_for_sign(None) == ""


def test_empty_dict_is_empty_string():
    assert serialize_body_for_sign({}) == ""


def test_empty_string_stays_empty():
    assert serialize_body_for_sign("") == ""


def test_string_passes_through():
    assert serialize_body_for_sign("raw") == "raw"


def test_dict_compact_json():
    # JSON.stringify in JS produces compact (no spaces) JSON; we match.
    assert serialize_body_for_sign({"a": 1, "b": "x"}) == '{"a":1,"b":"x"}'


def test_nested():
    assert serialize_body_for_sign({"k": [1, 2, {"y": "z"}]}) == '{"k":[1,2,{"y":"z"}]}'


def test_unicode_not_escaped():
    # ensure_ascii=False so 中文 stays as 中文 (matches JS default behavior).
    assert serialize_body_for_sign({"q": "中文"}) == '{"q":"中文"}'
