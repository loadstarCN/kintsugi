package com.kintsugi.sdk;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class CanonicalTest {

    @Test
    void nullIsEmpty() {
        assertEquals("", Canonical.serializeBodyForSign(null));
    }

    @Test
    void emptyStringStays() {
        assertEquals("", Canonical.serializeBodyForSign(""));
    }

    @Test
    void emptyMapIsEmpty() {
        assertEquals("", Canonical.serializeBodyForSign(Map.of()));
    }

    @Test
    void stringPassesThrough() {
        assertEquals("raw", Canonical.serializeBodyForSign("raw"));
    }

    @Test
    void mapCompactJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("a", 1);
        m.put("b", "x");
        assertEquals("{\"a\":1,\"b\":\"x\"}", Canonical.serializeBodyForSign(m));
    }

    @Test
    void unicodeNotEscaped() {
        assertEquals("{\"q\":\"中文\"}", Canonical.serializeBodyForSign(Map.of("q", "中文")));
    }

    @Test
    void nested() {
        Map<String, Object> inner = new LinkedHashMap<>();
        inner.put("y", "z");
        Map<String, Object> outer = new LinkedHashMap<>();
        outer.put("k", List.of(1, 2, inner));
        assertEquals("{\"k\":[1,2,{\"y\":\"z\"}]}", Canonical.serializeBodyForSign(outer));
    }
}
