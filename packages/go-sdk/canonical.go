// Package kintsugi provides the official Go SDK for the Kintsugi platform.
//
// The HMAC signature scheme matches the TypeScript / Python SDKs exactly:
//
//	canonical = METHOD + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + body
//	signature = hmac_sha256(secret, canonical) | hex
//
// body is "" when the request payload is nil / empty map / empty string;
// otherwise it's the JSON encoding (compact, no extra whitespace) of the payload.
// The server-side hmac.guard uses the same rule so the two have to agree byte-for-byte.
package kintsugi

import (
	"bytes"
	"encoding/json"
)

// serializeBodyForSign normalizes a body value to the canonical string form
// used both for HMAC signing and as the actual HTTP request body.
func serializeBodyForSign(body any) (string, error) {
	if body == nil {
		return "", nil
	}
	switch v := body.(type) {
	case string:
		return v, nil
	case []byte:
		return string(v), nil
	case map[string]any:
		if len(v) == 0 {
			return "", nil
		}
	}
	// json.Marshal produces compact output by default (no spaces) — same as JS JSON.stringify.
	// HTMLEscape would change & < > → unicode escapes; we don't want that.
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(body); err != nil {
		return "", err
	}
	// Encode appends a trailing newline; trim it.
	out := buf.Bytes()
	if n := len(out); n > 0 && out[n-1] == '\n' {
		out = out[:n-1]
	}
	return string(out), nil
}
