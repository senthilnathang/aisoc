package legacy

import (
	"encoding/json"
	"testing"
)

func TestIntegerBoundaries(t *testing.T) {
	for _, raw := range []string{`true`, `null`, `[]`, `"NaN"`, `"Inf"`, `"0x1p2"`, `"1_0"`, `"2147483648"`, `-2147483649`, `1.5`, `""`} {
		if _, err := Integer(json.RawMessage(raw)); err == nil {
			t.Errorf("accepted %s", raw)
		}
	}
	for raw, want := range map[string]int32{`"37"`: 37, `" 3.0 "`: 3, `1e2`: 100, `2147483647`: 2147483647, `-2147483648`: -2147483648} {
		got, err := Integer(json.RawMessage(raw))
		if err != nil || got != want {
			t.Errorf("%s: %d %v", raw, got, err)
		}
	}
}
