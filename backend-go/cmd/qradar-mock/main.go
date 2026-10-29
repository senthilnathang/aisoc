// qradar-mock is an offline deterministic demonstration, not a service or vendor client.
package main

import (
	"aisoc/backend/internal/modules/qradarmock"
	"aisoc/backend/internal/modules/telemetry"
	"encoding/json"
	"fmt"
	"os"
	"time"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	b := telemetry.Binding{TenantID: "sandbox", ConnectorID: "mock-siem", Source: "qradar-siem"}
	events, err := qradarmock.LoginPage(b)
	if err != nil {
		return err
	}
	findings, err := telemetry.SuspiciousLogins(b, events, time.Date(2026, 10, 29, 10, 4, 0, 0, time.UTC))
	if err != nil {
		return err
	}
	var current *qradarmock.CaseRevision
	statuses := []string{}
	for i, status := range []string{"open", "closed", "reopened"} {
		next := qradarmock.CaseRevision{Binding: telemetry.Binding{TenantID: "sandbox", ConnectorID: "mock-soar", Source: "qradar-soar"}, ExternalID: "mock-case", Version: fmt.Sprintf("revision-%d", i), Status: status}
		if current != nil {
			next.PreviousVersion = current.Version
		}
		accepted, _, err := qradarmock.ApplyCase(current, next)
		if err != nil {
			return err
		}
		current = &accepted
		statuses = append(statuses, status)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(struct {
		Mode       string              `json:"mode"`
		Events     int                 `json:"synthetic_events"`
		Findings   []telemetry.Finding `json:"findings"`
		CaseStates []string            `json:"mock_soar_states"`
		Actions    int                 `json:"response_actions"`
	}{"offline mock; no provider, database or model calls", len(events), findings, statuses, 0})
}
