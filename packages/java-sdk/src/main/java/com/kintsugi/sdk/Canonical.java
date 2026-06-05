package com.kintsugi.sdk;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

import java.util.Map;

/**
 * Canonicalization rules shared with the TS / Python / Go SDKs.
 * <p>
 * canonical = METHOD + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + body
 * <p>
 * body == "" when the payload is null / empty Map / empty String;
 * otherwise body is the compact-JSON encoding of the payload.
 * The server-side hmac.guard uses identical rules, so this MUST match byte-for-byte.
 */
final class Canonical {
    private static final ObjectMapper MAPPER;

    static {
        MAPPER = new ObjectMapper();
        // compact output (no INDENT_OUTPUT) — same as JSON.stringify default
        MAPPER.disable(SerializationFeature.INDENT_OUTPUT);
        // do not escape non-ASCII (like ensure_ascii=False in Python)
        // Jackson default already does NOT escape non-ASCII.
    }

    private Canonical() {}

    static String serializeBodyForSign(Object body) {
        if (body == null) return "";
        if (body instanceof String s) return s;
        if (body instanceof Map<?, ?> m && m.isEmpty()) return "";
        try {
            return MAPPER.writeValueAsString(body);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("kintsugi: marshal body: " + e.getMessage(), e);
        }
    }

    /** Test-only access; package-private. */
    static ObjectMapper mapper() {
        return MAPPER;
    }
}
