package intake

import "testing"

func TestLegacyJSONStringifySeparators(t *testing.T) {
	raw, err := jsonBytes([]string{"\u2028", `\u2028`, "\u2029", `\u2029`, "<>&"})
	want := `["` + "\u2028" + `","\\u2028","` + "\u2029" + `","\\u2029","<>&"]`
	if err != nil || string(raw) != want {
		t.Fatalf("legacy serialization differs: %q %v", raw, err)
	}
}
