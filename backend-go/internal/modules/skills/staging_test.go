package skills

import "testing"

func TestStageDoesNotReplacePublishedGuidance(t *testing.T) {
	r := map[string]any{"state": "published", "version": float64(2), "content_markdown": "approved"}
	stagePatch(r, map[string]any{"content_markdown": "draft", "expected_version": float64(2)})
	if r["content_markdown"] != "approved" || r["published_version"] != float64(2) {
		t.Fatal(r)
	}
	if r["staged_edit"].(map[string]any)["content_markdown"] != "draft" {
		t.Fatal(r)
	}
}
