package kintsugi

import (
	"context"
	"fmt"
	"net/url"
)

// ---- SQL ----

type sqlNamespace struct{ c *Client }

// SQLExecuteRequest — params bound by name (`:name`) into the prepared statement.
//
// `actor` 和 `sqlSafe` 故意不带 omitempty —— 服务端期望永远收到这俩字段
// （actor 缺省 → 用 "human"；sqlSafe=false 是默认要显式发，不能被 omit）。
// Execute() 会在零值时填默认。
type SQLExecuteRequest struct {
	Params  map[string]any `json:"params"`
	Actor   string         `json:"actor"`   // "human" | "agent"
	SQLSafe bool           `json:"sqlSafe"` // platform-admin only
}

// SQLExecuteResponse mirrors the server-side envelope.
type SQLExecuteResponse struct {
	Data      any    `json:"data"`
	RowCount  int    `json:"rowCount"`
	RiskLevel string `json:"riskLevel"`
	Error     string `json:"error,omitempty"`
}

// Execute — POST /api/sql/{sqlCode}/execute.
//
// If req has zero values for Actor, "human" is sent.
func (s *sqlNamespace) Execute(ctx context.Context, sqlCode string, req SQLExecuteRequest, out *SQLExecuteResponse) error {
	if req.Actor == "" {
		req.Actor = "human"
	}
	if req.Params == nil {
		req.Params = map[string]any{}
	}
	return s.c.Request(ctx, "POST", "/api/sql/"+url.PathEscape(sqlCode)+"/execute", req, out)
}

// ---- BFF ----

type bffNamespace struct{ c *Client }

// Execute — POST /api/bff/exec/{appCode}/{scriptName}, body {payload}.
// out is a pointer to whatever shape the script returns.
func (b *bffNamespace) Execute(ctx context.Context, scriptName string, payload any, out any) error {
	path := fmt.Sprintf(
		"/api/bff/exec/%s/%s",
		url.PathEscape(b.c.cfg.AppCode),
		url.PathEscape(scriptName),
	)
	return b.c.Request(ctx, "POST", path, map[string]any{"payload": payload}, out)
}

// ---- Chats ----

type chatsNamespace struct{ c *Client }

// ChatsAskResult mirrors the platform response shape.
type ChatsAskResult struct {
	SQL         string `json:"sql"`
	Explanation string `json:"explanation"`
	Data        any    `json:"data"`
	RowCount    int    `json:"rowCount"`
	Chart       any    `json:"chart,omitempty"`
}

// Ask — POST /api/chats/ask. maxTables=0 → omit.
func (ch *chatsNamespace) Ask(ctx context.Context, question string, maxTables int) (*ChatsAskResult, error) {
	body := map[string]any{
		"appCode":  ch.c.cfg.AppCode,
		"question": question,
	}
	if maxTables > 0 {
		body["maxTables"] = maxTables
	}
	var out ChatsAskResult
	if err := ch.c.Request(ctx, "POST", "/api/chats/ask", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
