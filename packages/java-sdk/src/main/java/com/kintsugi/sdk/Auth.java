package com.kintsugi.sdk;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.http.HttpRequest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.HexFormat;

/**
 * Auth strategy. Implementations supply request headers (Authorization / X-Access-Key etc.)
 * for a prepared request. The signing path strips query string before HMAC.
 */
public interface Auth {
    /** Apply auth headers to the builder. body is the canonicalized request body. */
    void apply(HttpRequest.Builder builder, String method, String path, String body);

    /** No-op cookie auth — relies on the HttpClient's CookieHandler. */
    static Auth cookie() {
        return new CookieAuth();
    }

    /** Bearer JWT. */
    static Auth bearer(String token) {
        return new BearerAuth(token);
    }

    /** Long-lived HMAC-SHA256 access key. */
    static Auth accessKey(String accessKey, String secretKey) {
        return new AccessKeyAuth(accessKey, secretKey, Clock.systemUTC(), new SecureRandom());
    }

    final class CookieAuth implements Auth {
        @Override
        public void apply(HttpRequest.Builder builder, String method, String path, String body) {
            // no-op
        }
    }

    final class BearerAuth implements Auth {
        private final String token;

        BearerAuth(String token) { this.token = token; }

        @Override
        public void apply(HttpRequest.Builder builder, String method, String path, String body) {
            builder.header("Authorization", "Bearer " + token);
        }
    }

    final class AccessKeyAuth implements Auth {
        private final String accessKey;
        private final String secretKey;
        private final Clock clock;
        private final SecureRandom random;

        AccessKeyAuth(String accessKey, String secretKey, Clock clock, SecureRandom random) {
            this.accessKey = accessKey;
            this.secretKey = secretKey;
            this.clock = clock;
            this.random = random;
        }

        @Override
        public void apply(HttpRequest.Builder builder, String method, String path, String body) {
            String signPath = path;
            int q = signPath.indexOf('?');
            if (q != -1) signPath = signPath.substring(0, q);

            String timestamp = String.valueOf(clock.instant().getEpochSecond());
            byte[] nonceBytes = new byte[8];
            random.nextBytes(nonceBytes);
            String nonce = HexFormat.of().formatHex(nonceBytes);

            String canonical = method.toUpperCase() + "\n" + signPath + "\n"
                    + timestamp + "\n" + nonce + "\n" + body;
            String signature = hmacSha256Hex(secretKey, canonical);

            builder.header("X-Access-Key", accessKey);
            builder.header("X-Timestamp", timestamp);
            builder.header("X-Nonce", nonce);
            builder.header("X-Signature", signature);
        }

        private static String hmacSha256Hex(String secret, String message) {
            try {
                Mac mac = Mac.getInstance("HmacSHA256");
                mac.init(new SecretKeySpec(secret.getBytes(), "HmacSHA256"));
                return HexFormat.of().formatHex(mac.doFinal(message.getBytes()));
            } catch (NoSuchAlgorithmException e) {
                throw new IllegalStateException("HmacSHA256 not available — broken JRE", e);
            } catch (Exception e) {
                throw new RuntimeException("HMAC sign failed: " + e.getMessage(), e);
            }
        }
    }
}
