package detection

import (
	_ "embed"
	"encoding/json"
	"strings"
)

//go:embed catalog.json
var catalogJSON []byte

// Catalog contains reviewed local starter metadata, never executable queries.
func Catalog(search string) (map[string]any, error) {
	var records []map[string]any
	if err := json.Unmarshal(catalogJSON, &records); err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for _, r := range records {
		if strings.Contains(strings.ToLower(r["name"].(string)+" "+r["description"].(string)), strings.ToLower(search)) {
			items = append(items, r)
		}
	}
	return map[string]any{"version": "1", "items": items, "total": len(items)}, nil
}
