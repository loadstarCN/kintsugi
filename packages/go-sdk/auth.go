package kintsugi

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Auth applies authentication headers to a prepared request.
type Auth interface {
	Apply(req *http.Request, body string)
}

// CookieAuth — relies on a cookie jar configured on the http.Client.
type CookieAuth struct{}

func (CookieAuth) Apply(req *http.Request, _ string) {
	// no-op; cookie jar handles it
}

// BearerAuth — sets Authorization: Bearer <token>.
type BearerAuth struct {
	Token string
}

func (a BearerAuth) Apply(req *http.Request, _ string) {
	req.Header.Set("Authorization", "Bearer "+a.Token)
}

// AccessKeyAuth — long-lived HMAC-SHA256 credentials. Recommended for
// server-to-server.
type AccessKeyAuth struct {
	AccessKey string
	SecretKey string
	// nowFn / nonceFn allow tests to pin time + nonce. Default: time.Now / crypto/rand.
	nowFn   func() time.Time
	nonceFn func() string
}

func (a AccessKeyAuth) Apply(req *http.Request, body string) {
	now := time.Now
	if a.nowFn != nil {
		now = a.nowFn
	}
	nonce := newNonce()
	if a.nonceFn != nil {
		nonce = a.nonceFn()
	}
	timestamp := strconv.FormatInt(now().Unix(), 10)
	// path 不带 query —— server hmac.guard 也是这么签的。
	signPath := req.URL.Path
	if i := strings.Index(signPath, "?"); i != -1 {
		signPath = signPath[:i]
	}
	canonical := strings.Join([]string{
		strings.ToUpper(req.Method),
		signPath,
		timestamp,
		nonce,
		body,
	}, "\n")
	mac := hmac.New(sha256.New, []byte(a.SecretKey))
	_, _ = mac.Write([]byte(canonical))
	sig := hex.EncodeToString(mac.Sum(nil))
	req.Header.Set("X-Access-Key", a.AccessKey)
	req.Header.Set("X-Timestamp", timestamp)
	req.Header.Set("X-Nonce", nonce)
	req.Header.Set("X-Signature", sig)
}

func newNonce() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// extremely rare; fall back to time-based; signature is still unique-enough
		// because timestamp varies per request.
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	return hex.EncodeToString(b)
}
