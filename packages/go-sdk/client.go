package kintsugi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Config holds Client construction options.
type Config struct {
	BaseURL string
	AppCode string
	Auth    Auth
	// HTTPClient is optional. When nil, a sensible default with 30s timeout is used.
	HTTPClient *http.Client
	// Timeout is used only if HTTPClient is nil.
	Timeout time.Duration
}

// Client is the entry point for the Kintsugi SDK.
type Client struct {
	cfg  Config
	base string
	http *http.Client
	// namespaces
	SQL      *sqlNamespace
	BFF      *bffNamespace
	Chats    *chatsNamespace
}

// NewClient constructs a Client. It does not perform any I/O.
func NewClient(cfg Config) *Client {
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		timeout := cfg.Timeout
		if timeout == 0 {
			timeout = 30 * time.Second
		}
		httpClient = &http.Client{Timeout: timeout}
	}
	c := &Client{
		cfg:  cfg,
		base: strings.TrimRight(cfg.BaseURL, "/"),
		http: httpClient,
	}
	c.SQL = &sqlNamespace{c: c}
	c.BFF = &bffNamespace{c: c}
	c.Chats = &chatsNamespace{c: c}
	return c
}

// Dataset returns a generic dataset client for the given datasetCode under
// this client's appCode. Unmarshalling is done into the caller-supplied target
// (pointer) — pass &MyType to get strongly typed results.
func (c *Client) Dataset(datasetCode string) *DatasetClient {
	return &DatasetClient{
		c:           c,
		datasetCode: datasetCode,
		base: fmt.Sprintf(
			"/api/apps/%s/ds/%s",
			url.PathEscape(c.cfg.AppCode),
			url.PathEscape(datasetCode),
		),
	}
}

// Request performs a raw API request. Most callers should use the namespace
// helpers (Dataset / SQL / BFF / Chats) — Request is the escape hatch for new
// or undocumented endpoints.
//
//	out is a pointer to the destination JSON-decode target (or nil to discard).
func (c *Client) Request(ctx context.Context, method, path string, body any, out any) error {
	bodyStr, err := serializeBodyForSign(body)
	if err != nil {
		return fmt.Errorf("kintsugi: marshal body: %w", err)
	}
	var bodyReader io.Reader
	if bodyStr != "" {
		bodyReader = bytes.NewReader([]byte(bodyStr))
	}
	req, err := http.NewRequestWithContext(ctx, strings.ToUpper(method), c.base+path, bodyReader)
	if err != nil {
		return fmt.Errorf("kintsugi: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if c.cfg.Auth != nil {
		c.cfg.Auth.Apply(req, bodyStr)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("kintsugi: do request: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("kintsugi: read body: %w", err)
	}
	isJSON := strings.HasPrefix(resp.Header.Get("Content-Type"), "application/json")
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		he := &HTTPError{Status: resp.StatusCode}
		if isJSON {
			var env struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			}
			if err := json.Unmarshal(raw, &env); err == nil {
				he.Code = env.Code
				he.Message = env.Message
			}
			var generic any
			_ = json.Unmarshal(raw, &generic)
			he.Body = generic
		} else {
			he.Message = string(raw)
			he.Body = string(raw)
		}
		return he
	}
	if out == nil {
		return nil
	}
	if isJSON {
		return json.Unmarshal(raw, out)
	}
	// non-JSON response into *string is supported, otherwise error.
	if sp, ok := out.(*string); ok {
		*sp = string(raw)
		return nil
	}
	return fmt.Errorf("kintsugi: non-JSON response (Content-Type=%q) cannot decode into %T", resp.Header.Get("Content-Type"), out)
}
