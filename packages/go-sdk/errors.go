package kintsugi

import "fmt"

// HTTPError is returned for any non-2xx response. Body is the parsed JSON
// envelope (when content-type is JSON) or the raw text otherwise.
type HTTPError struct {
	Status  int
	Code    string
	Message string
	Body    any
}

func (e *HTTPError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("kintsugi: HTTP %d %s: %s", e.Status, e.Code, e.Message)
	}
	return fmt.Sprintf("kintsugi: HTTP %d: %s", e.Status, e.Message)
}
