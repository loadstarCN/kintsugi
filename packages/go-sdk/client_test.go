package kintsugi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFilterRoundtrip(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/apps/my-app/ds/orders/filter" {
			t.Errorf("path: %s", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		if got := string(body); got != `{"page":1}` {
			t.Errorf("body: got %q want %q", got, `{"page":1}`)
		}
		if r.Header.Get("Authorization") != "Bearer t" {
			t.Errorf("missing auth: %s", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data":     []any{},
			"total":    0,
			"page":     1,
			"pageSize": 50,
		})
	}))
	defer srv.Close()

	c := NewClient(Config{
		BaseURL: srv.URL,
		AppCode: "my-app",
		Auth:    BearerAuth{Token: "t"},
	})
	var out Paged[map[string]any]
	if err := c.Dataset("orders").Filter(context.Background(), FilterRequest{Page: 1}, &out); err != nil {
		t.Fatal(err)
	}
	if out.Total != 0 || out.PageSize != 50 {
		t.Errorf("unexpected: %+v", out)
	}
}

func TestHTTPErrorEnvelope(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(403)
		_, _ = w.Write([]byte(`{"code":"FORBIDDEN","message":"nope"}`))
	}))
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, AppCode: "a", Auth: BearerAuth{Token: "t"}})
	err := c.Request(context.Background(), "POST", "/api/sql/x/execute", map[string]any{}, nil)
	he, ok := err.(*HTTPError)
	if !ok {
		t.Fatalf("expected *HTTPError, got %T: %v", err, err)
	}
	if he.Status != 403 || he.Code != "FORBIDDEN" || he.Message != "nope" {
		t.Errorf("unexpected: %+v", he)
	}
	if !strings.Contains(he.Error(), "FORBIDDEN") {
		t.Errorf("Error() should mention code: %s", he.Error())
	}
}

func TestSQLExecuteDefaults(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var got map[string]any
		_ = json.Unmarshal(body, &got)
		if got["actor"] != "human" {
			t.Errorf("actor default: %v", got["actor"])
		}
		if got["sqlSafe"] != false {
			t.Errorf("sqlSafe default: %v", got["sqlSafe"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[],"rowCount":0,"riskLevel":"low"}`))
	}))
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, AppCode: "a", Auth: BearerAuth{Token: "t"}})
	var out SQLExecuteResponse
	if err := c.SQL.Execute(context.Background(), "x", SQLExecuteRequest{}, &out); err != nil {
		t.Fatal(err)
	}
	if out.RiskLevel != "low" {
		t.Errorf("unmarshal: %+v", out)
	}
}

func TestBFFExecutePayloadEnvelope(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var got map[string]any
		_ = json.Unmarshal(body, &got)
		payload, _ := got["payload"].(map[string]any)
		if payload["tenantCode"] != "acme" {
			t.Errorf("payload not wrapped: %v", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"orders":[]}`))
	}))
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, AppCode: "my-app", Auth: BearerAuth{Token: "t"}})
	var out struct {
		Orders []any `json:"orders"`
	}
	if err := c.BFF.Execute(context.Background(), "orders-summary", map[string]any{"tenantCode": "acme"}, &out); err != nil {
		t.Fatal(err)
	}
}

func TestChatsAskIncludesAppCode(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var got map[string]any
		_ = json.Unmarshal(body, &got)
		if got["appCode"] != "my-app" {
			t.Errorf("missing appCode: %v", got)
		}
		if got["question"] != "hi" {
			t.Errorf("question: %v", got)
		}
		if got["maxTables"] != float64(5) {
			t.Errorf("maxTables: %v", got["maxTables"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"sql":"SELECT 1","explanation":"x","data":[],"rowCount":0}`))
	}))
	defer srv.Close()
	c := NewClient(Config{BaseURL: srv.URL, AppCode: "my-app", Auth: BearerAuth{Token: "t"}})
	out, err := c.Chats.Ask(context.Background(), "hi", 5)
	if err != nil {
		t.Fatal(err)
	}
	if out.SQL != "SELECT 1" {
		t.Errorf("unmarshal: %+v", out)
	}
}
