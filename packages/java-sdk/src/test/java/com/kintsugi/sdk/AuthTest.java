package com.kintsugi.sdk;

import org.junit.jupiter.api.Test;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.http.HttpRequest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class AuthTest {

    @Test
    void bearerSetsAuthorization() {
        HttpRequest.Builder b = HttpRequest.newBuilder().uri(URI.create("https://x/y"));
        Auth.bearer("abc").apply(b, "GET", "/y", "");
        HttpRequest req = b.GET().build();
        assertEquals("Bearer abc", req.headers().firstValue("Authorization").orElseThrow());
    }

    @Test
    void cookieIsNoOp() {
        HttpRequest.Builder b = HttpRequest.newBuilder().uri(URI.create("https://x/y"));
        Auth.cookie().apply(b, "GET", "/y", "");
        HttpRequest req = b.GET().build();
        assertTrue(req.headers().firstValue("Authorization").isEmpty());
    }

    @Test
    void accessKeySignatureMatchesManualHmac() throws Exception {
        // pin clock + nonce so we can compute expected signature
        Clock pinned = Clock.fixed(Instant.ofEpochSecond(1700000000), ZoneOffset.UTC);
        SecureRandom seeded = new SecureRandom() {
            @Override public void nextBytes(byte[] bytes) {
                for (int i = 0; i < bytes.length; i++) bytes[i] = (byte) (0x10 + i);
            }
        };
        Auth.AccessKeyAuth auth = new Auth.AccessKeyAuth("ak_test", "secret", pinned, seeded);
        HttpRequest.Builder b = HttpRequest.newBuilder().uri(URI.create("https://x/api/y?ignore=1"));
        auth.apply(b, "POST", "/api/y?ignore=1", "{\"a\":1}");

        HttpRequest req = b.POST(HttpRequest.BodyPublishers.ofString("{\"a\":1}")).build();
        assertEquals("ak_test", req.headers().firstValue("X-Access-Key").orElseThrow());
        assertEquals("1700000000", req.headers().firstValue("X-Timestamp").orElseThrow());
        // 8-byte nonce hex = 16 chars
        String nonce = req.headers().firstValue("X-Nonce").orElseThrow();
        assertEquals(16, nonce.length());

        String canonical = "POST\n/api/y\n1700000000\n" + nonce + "\n{\"a\":1}";
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec("secret".getBytes(), "HmacSHA256"));
        String want = HexFormat.of().formatHex(mac.doFinal(canonical.getBytes()));
        assertEquals(want, req.headers().firstValue("X-Signature").orElseThrow());
    }
}
