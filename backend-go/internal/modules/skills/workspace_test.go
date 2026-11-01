package skills

import "testing"

func TestWorkspaceMutationValidation(t *testing.T) {
	for _, input := range []map[string]any{{"tenant_id": "other"}, {"origin": "user"}, {"modules": "investigations"}, {"alert_types": []any{""}}, {"tags": []any{true}}, {"expected_version": float64(1.5)}, {"name": "  "}} {
		if validateMutation("patch", input) == nil {
			t.Fatalf("accepted %#v", input)
		}
	}
	if err := validateMutation("patch", map[string]any{"modules": []any{"investigations"}, "tags": []string{"identity"}}); err != nil {
		t.Fatal(err)
	}
}
