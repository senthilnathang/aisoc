package migration

import (
	"reflect"
	"testing"
)

func TestMappingOrderSurvivesReverseExport(t *testing.T) {
	sequence := []any{"title", "external_id", "severity"}
	row := Row{"mapping": map[string]any{"fields": map[string]any{"severity": "event.level", "title": "event.name", "external_id": "event.id"}}, "mapping_order": sequence}
	restored, err := backward("api_sources", row, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := mappingOrder(restored["mapping_json"].(string)); !reflect.DeepEqual(got, []string{"title", "external_id", "severity"}) {
		t.Fatal(got)
	}
	row["mapping_order"] = []any{"title"}
	if _, err := backward("api_sources", row, nil); err == nil {
		t.Fatal("incomplete order silently accepted")
	}
}
