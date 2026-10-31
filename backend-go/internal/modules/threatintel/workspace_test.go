package threatintel

import "testing"

func TestLinkedHuntInputValidation(t *testing.T) {
	for _, v := range []string{"", "x", string(make([]byte, 201))} {
		if validHuntPhrase(v) {
			t.Fatal("invalid phrase accepted")
		}
	}
	if !validHuntPhrase("192.0.2.42") {
		t.Fatal("IOC rejected")
	}
}
