package kintsugi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestBearerAuth(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://x/api/y", nil)
	BearerAuth{Token: "abc"}.Apply(req, "")
	if got := req.Header.Get("Authorization"); got != "Bearer abc" {
		t.Errorf("got %q, want %q", got, "Bearer abc")
	}
}

func TestCookieAuthNoOp(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://x/api/y", nil)
	CookieAuth{}.Apply(req, "")
	if len(req.Header) != 0 {
		t.Errorf("CookieAuth should not set headers, got %v", req.Header)
	}
}

func TestAccessKeyAuthSignature(t *testing.T) {
	req, _ := http.NewRequest("POST", "https://x/api/orders/filter?ignore=me", strings.NewReader(""))
	auth := AccessKeyAuth{
		AccessKey: "ak_test",
		SecretKey: "secret",
		nowFn:     func() time.Time { return time.Unix(1700000000, 0) },
		nonceFn:   func() string { return "deadbeef12345678" },
	}
	body := `{"a":1}`
	auth.Apply(req, body)

	if got := req.Header.Get("X-Access-Key"); got != "ak_test" {
		t.Errorf("X-Access-Key: got %q want ak_test", got)
	}
	if got := req.Header.Get("X-Timestamp"); got != "1700000000" {
		t.Errorf("X-Timestamp: got %q", got)
	}
	if got := req.Header.Get("X-Nonce"); got != "deadbeef12345678" {
		t.Errorf("X-Nonce: got %q", got)
	}
	// canonical string strips query: should be /api/orders/filter (not ?ignore=me)
	canonical := "POST\n/api/orders/filter\n1700000000\ndeadbeef12345678\n" + body
	mac := hmac.New(sha256.New, []byte("secret"))
	_, _ = mac.Write([]byte(canonical))
	want := hex.EncodeToString(mac.Sum(nil))
	if got := req.Header.Get("X-Signature"); got != want {
		t.Errorf("X-Signature: got %q want %q", got, want)
	}
}
