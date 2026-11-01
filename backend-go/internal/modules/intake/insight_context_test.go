package intake

import (
	"reflect"
	"testing"
)

func TestInsightContextUsesEntityValuesOnly(t *testing.T) {
	c := skillContext(AlertInput{PrimaryEntity: "main.example", Evidence: []Evidence{{Type: "user", Label: "Admin user", Value: "different@example.test"}}}, []any{map[string]any{"indicator_type": "ip", "value": "192.0.2.1"}})
	if !reflect.DeepEqual(c.InsightEntities, []string{"main.example", "different@example.test", "192.0.2.1"}) {
		t.Fatal("insight matching included scope metadata", c.InsightEntities)
	}
}
