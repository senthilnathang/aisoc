package hunts

import "testing"

func TestLocalSearchValidation(t *testing.T) {
	for _, q := range []string{"", "x", "  ", string(make([]byte, 201))} {
		if validateSearch("request-1", q) == nil {
			t.Fatal("invalid search accepted")
		}
	}
	if validateSearch("request-1", "192.0.2.1") != nil {
		t.Fatal("literal rejected")
	}
	if validateSearch("../bad", "login") == nil {
		t.Fatal("invalid request id")
	}
}
