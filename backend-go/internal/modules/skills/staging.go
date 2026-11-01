package skills

// A staged patch is metadata, never the published guidance used by matching.
func stagePatch(r, input map[string]any) {
	if r["published_version"] == nil {
		r["published_version"] = r["version"]
	}
	draft, _ := r["staged_edit"].(map[string]any)
	if draft == nil {
		draft = map[string]any{}
	}
	for k, v := range input {
		if k != "expected_version" {
			draft[k] = v
		}
	}
	r["staged_edit"] = draft
}
