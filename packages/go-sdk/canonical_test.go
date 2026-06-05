package kintsugi

import "testing"

func TestSerializeBodyForSign(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want string
	}{
		{"nil", nil, ""},
		{"empty map", map[string]any{}, ""},
		{"empty string", "", ""},
		{"string passthrough", "raw", "raw"},
		{"map compact", map[string]any{"a": 1}, `{"a":1}`},
		{"unicode not escaped", map[string]any{"q": "中文"}, `{"q":"中文"}`},
		{"html-ish chars not escaped", map[string]any{"k": "<x>&y"}, `{"k":"<x>&y"}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := serializeBodyForSign(c.in)
			if err != nil {
				t.Fatalf("err: %v", err)
			}
			if got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}
