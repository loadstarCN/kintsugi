package com.kintsugi.sdk;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Synchronous Kintsugi platform client. Built on java.net.http.HttpClient.
 * <p>
 * Use {@link KintsugiClient#builder()} to construct.
 *
 * <pre>
 * KintsugiClient client = KintsugiClient.builder()
 *     .baseUrl("https://kintsugi.example.com")
 *     .appCode("my-app")
 *     .auth(Auth.accessKey(ak, sk))
 *     .build();
 *
 * Map&lt;String,Object&gt; req = Map.of("page", 1);
 * Paged&lt;Map&lt;String,Object&gt;&gt; page = client.dataset("orders").filter(
 *     req,
 *     new TypeReference&lt;Paged&lt;Map&lt;String,Object&gt;&gt;&gt;(){}
 * );
 * </pre>
 */
public final class KintsugiClient {
    private final String baseUrl;
    private final String appCode;
    private final Auth auth;
    private final HttpClient http;
    private final Duration timeout;

    public final SqlNamespace sql;
    public final BffNamespace bff;
    public final ChatsNamespace chats;

    private KintsugiClient(Builder b) {
        this.baseUrl = trimTrailingSlash(Objects.requireNonNull(b.baseUrl, "baseUrl"));
        this.appCode = Objects.requireNonNull(b.appCode, "appCode");
        this.auth = b.auth;
        this.timeout = b.timeout != null ? b.timeout : Duration.ofSeconds(30);
        this.http = b.http != null
                ? b.http
                : HttpClient.newBuilder().connectTimeout(this.timeout).build();
        this.sql = new SqlNamespace(this);
        this.bff = new BffNamespace(this, this.appCode);
        this.chats = new ChatsNamespace(this, this.appCode);
    }

    public static Builder builder() { return new Builder(); }

    public DatasetClient dataset(String datasetCode) {
        return new DatasetClient(this, appCode, datasetCode);
    }

    /** Raw escape hatch. Pass TypeReference for typed deserialization. */
    public <T> T request(String method, String path, Object body, TypeReference<T> typeRef) {
        String bodyStr = Canonical.serializeBodyForSign(body);
        HttpRequest.Builder rb = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + path))
                .timeout(timeout)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .method(method.toUpperCase(),
                        bodyStr.isEmpty()
                                ? HttpRequest.BodyPublishers.noBody()
                                : HttpRequest.BodyPublishers.ofString(bodyStr, StandardCharsets.UTF_8));
        if (auth != null) {
            auth.apply(rb, method, path, bodyStr);
        }
        HttpResponse<byte[]> resp;
        try {
            resp = http.send(rb.build(), HttpResponse.BodyHandlers.ofByteArray());
        } catch (Exception e) {
            throw new RuntimeException("kintsugi: HTTP send failed: " + e.getMessage(), e);
        }
        boolean isJson = resp.headers().firstValue("Content-Type")
                .map(s -> s.startsWith("application/json")).orElse(false);
        byte[] raw = resp.body();
        if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
            String code = null;
            String message = isJson ? "" : new String(raw, StandardCharsets.UTF_8);
            Object envelope = null;
            if (isJson) {
                try {
                    JsonNode node = Canonical.mapper().readTree(raw);
                    if (node != null) {
                        if (node.has("code")) code = node.get("code").asText();
                        if (node.has("message")) message = node.get("message").asText();
                        envelope = Canonical.mapper().treeToValue(node, Object.class);
                    }
                } catch (Exception ignore) {
                    // fall through; envelope stays null
                }
            }
            throw new KintsugiHttpException(resp.statusCode(), code, message, envelope);
        }
        if (typeRef == null) return null;
        if (raw.length == 0) return null;
        if (!isJson) {
            // Only String target supported for non-JSON.
            if (typeRef.getType() == String.class) {
                @SuppressWarnings("unchecked")
                T s = (T) new String(raw, StandardCharsets.UTF_8);
                return s;
            }
            throw new RuntimeException("kintsugi: non-JSON response cannot decode into " + typeRef.getType());
        }
        try {
            return Canonical.mapper().readValue(raw, typeRef);
        } catch (Exception e) {
            throw new RuntimeException("kintsugi: decode response: " + e.getMessage(), e);
        }
    }

    static String urlEscape(Object segment) {
        return URLEncoder.encode(String.valueOf(segment), StandardCharsets.UTF_8)
                .replace("+", "%20"); // path segments use %20 not +
    }

    private static String trimTrailingSlash(String s) {
        int end = s.length();
        while (end > 0 && s.charAt(end - 1) == '/') end--;
        return s.substring(0, end);
    }

    // ---- Builder ----
    public static final class Builder {
        private String baseUrl;
        private String appCode;
        private Auth auth;
        private HttpClient http;
        private Duration timeout;

        public Builder baseUrl(String v) { this.baseUrl = v; return this; }
        public Builder appCode(String v) { this.appCode = v; return this; }
        public Builder auth(Auth v) { this.auth = v; return this; }
        public Builder httpClient(HttpClient v) { this.http = v; return this; }
        public Builder timeout(Duration v) { this.timeout = v; return this; }
        public KintsugiClient build() { return new KintsugiClient(this); }
    }

    // ---- Public response shapes ----

    public record Paged<T>(List<T> data, int total, int page, int pageSize) {}

    public record SqlExecuteResponse(Object data, int rowCount, String riskLevel, String error) {}

    public record ChatsAskResult(String sql, String explanation, Object data, int rowCount, Object chart) {}

    // ---- Namespaces ----

    public static final class SqlNamespace {
        private final KintsugiClient c;
        SqlNamespace(KintsugiClient c) { this.c = c; }

        /** POST /api/sql/{sqlCode}/execute. */
        public SqlExecuteResponse execute(String sqlCode, Map<String, Object> params, String actor, boolean sqlSafe) {
            Map<String, Object> body = new HashMap<>();
            body.put("params", params == null ? Map.of() : params);
            body.put("actor", actor == null || actor.isEmpty() ? "human" : actor);
            body.put("sqlSafe", sqlSafe);
            return c.request("POST", "/api/sql/" + urlEscape(sqlCode) + "/execute", body,
                    new TypeReference<>() {});
        }

        /** Convenience: human actor, no sqlSafe. */
        public SqlExecuteResponse execute(String sqlCode, Map<String, Object> params) {
            return execute(sqlCode, params, "human", false);
        }
    }

    public static final class BffNamespace {
        private final KintsugiClient c;
        private final String appCode;

        BffNamespace(KintsugiClient c, String appCode) {
            this.c = c;
            this.appCode = appCode;
        }

        /** POST /api/bff/exec/{appCode}/{scriptName}, body {payload}. */
        public <T> T execute(String scriptName, Object payload, TypeReference<T> typeRef) {
            String path = "/api/bff/exec/" + urlEscape(appCode) + "/" + urlEscape(scriptName);
            Map<String, Object> envelope = new HashMap<>();
            envelope.put("payload", payload);
            return c.request("POST", path, envelope, typeRef);
        }
    }

    public static final class ChatsNamespace {
        private final KintsugiClient c;
        private final String appCode;

        ChatsNamespace(KintsugiClient c, String appCode) {
            this.c = c;
            this.appCode = appCode;
        }

        /** POST /api/chats/ask. maxTables &lt;= 0 → omit. */
        public ChatsAskResult ask(String question, int maxTables) {
            Map<String, Object> body = new HashMap<>();
            body.put("appCode", appCode);
            body.put("question", question);
            if (maxTables > 0) body.put("maxTables", maxTables);
            return c.request("POST", "/api/chats/ask", body, new TypeReference<>() {});
        }

        public ChatsAskResult ask(String question) {
            return ask(question, 0);
        }
    }
}
