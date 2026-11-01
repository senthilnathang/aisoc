package insights

import "testing"

func TestInsightValidation(t *testing.T) {
	for _, input := range []Input{{}, {Artifact: "user", Kind: "invalid", Content: "fact"}, {Artifact: "user", Kind: "user", Content: "fact", Hint: "close"}, {Artifact: "user", Kind: "user", Content: "fact", ValidFrom: "2026-01-02T00:00:00Z", ValidUntil: "2026-01-01T00:00:00Z"}} {
		if _, _, err := validate(input); err == nil {
			t.Fatalf("accepted %+v", input)
		}
	}
	if _, _, err := validate(Input{Artifact: "User@example.test", Kind: "user", Content: "Executive account", Hint: "none"}); err != nil {
		t.Fatal(err)
	}
}
