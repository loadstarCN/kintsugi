package com.kintsugi.sdk;

import com.fasterxml.jackson.core.type.TypeReference;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static com.kintsugi.sdk.KintsugiClient.urlEscape;

/**
 * Generic dataset client. Returned by {@link KintsugiClient#dataset(String)}.
 * <p>
 * Each method takes a TypeReference for typed deserialization (or null to discard).
 * Pass {@code new TypeReference<Map<String, Object>>(){}} for loose typing,
 * or your own {@code Order} record for strong typing.
 */
public final class DatasetClient {
    private final KintsugiClient client;
    private final String base;

    DatasetClient(KintsugiClient client, String appCode, String datasetCode) {
        this.client = client;
        this.base = "/api/apps/" + urlEscape(appCode) + "/ds/" + urlEscape(datasetCode);
    }

    /** POST <base>/filter — paged list. */
    public <T> KintsugiClient.Paged<T> filter(FilterRequest req, TypeReference<KintsugiClient.Paged<T>> typeRef) {
        Object body = req == null ? Map.of() : req;
        return client.request("POST", base + "/filter", body, typeRef);
    }

    /** GET <base>/{id}. */
    public <T> T getOne(Object id, TypeReference<T> typeRef) {
        return client.request("GET", base + "/" + urlEscape(id), null, typeRef);
    }

    /** POST <base>. */
    public <T> T create(Object data, TypeReference<T> typeRef) {
        return client.request("POST", base, data, typeRef);
    }

    /** PATCH <base>/{id}. */
    public <T> T update(Object id, Object data, TypeReference<T> typeRef) {
        return client.request("PATCH", base + "/" + urlEscape(id), data, typeRef);
    }

    /** DELETE <base>/{id}. */
    public Map<String, Object> delete(Object id) {
        return client.request("DELETE", base + "/" + urlEscape(id), null,
                new TypeReference<>() {});
    }

    /** POST <base>/batchCreate {rows}. */
    public Map<String, Object> batchCreate(List<?> rows) {
        Map<String, Object> body = new HashMap<>();
        body.put("rows", rows == null ? List.of() : rows);
        return client.request("POST", base + "/batchCreate", body, new TypeReference<>() {});
    }

    /** POST <base>/aggregate. */
    public <T> T aggregate(Object req, TypeReference<T> typeRef) {
        return client.request("POST", base + "/aggregate", req, typeRef);
    }

    /** GET <base>/options/{field}. */
    public Map<String, Object> getSelectOptions(String field) {
        return client.request("GET", base + "/options/" + urlEscape(field), null,
                new TypeReference<>() {});
    }

    // ---- request shape ----

    public static final class FilterRequest {
        public List<Where> where;
        public List<OrderBy> orderBy;
        public Integer page;
        public Integer pageSize;
        public List<String> select;
        public Boolean includeDeleted;

        public static FilterRequest of() { return new FilterRequest(); }
        public FilterRequest where(List<Where> v) { this.where = v; return this; }
        public FilterRequest orderBy(List<OrderBy> v) { this.orderBy = v; return this; }
        public FilterRequest page(int v) { this.page = v; return this; }
        public FilterRequest pageSize(int v) { this.pageSize = v; return this; }
        public FilterRequest select(List<String> v) { this.select = v; return this; }
        public FilterRequest includeDeleted(boolean v) { this.includeDeleted = v; return this; }
    }

    public record Where(String field, String op, Object value) {
        public static Where eq(String f, Object v) { return new Where(f, "eq", v); }
        public static Where ne(String f, Object v) { return new Where(f, "ne", v); }
        public static Where gt(String f, Object v) { return new Where(f, "gt", v); }
        public static Where gte(String f, Object v) { return new Where(f, "gte", v); }
        public static Where lt(String f, Object v) { return new Where(f, "lt", v); }
        public static Where lte(String f, Object v) { return new Where(f, "lte", v); }
        public static Where like(String f, Object v) { return new Where(f, "like", v); }
        public static Where in(String f, List<?> v) { return new Where(f, "in", v); }
        public static Where isNull(String f) { return new Where(f, "isNull", null); }
        public static Where isNotNull(String f) { return new Where(f, "isNotNull", null); }
    }

    public record OrderBy(String field, String direction) {
        public static OrderBy asc(String f) { return new OrderBy(f, "asc"); }
        public static OrderBy desc(String f) { return new OrderBy(f, "desc"); }
    }
}
