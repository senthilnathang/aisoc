// integration-probe performs explicit, bounded read-only vendor calls. It never
// advances an ingestion cursor or writes a SOAR case.
package main

import (
	"aisoc/backend/internal/modules/integrations"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Integration probe failed; inspect configuration and provider access without logging credentials")
		os.Exit(1)
	}
}
func run() error {
	config := flag.String("config", "", "Private QRadarConfig JSON path")
	provider := flag.String("provider", "qradar", "qradar or sentinel")
	nextLink := flag.String("next-link", "", "Sentinel continuation from a previously accepted page")
	savedSearch := flag.Int64("saved-search", 0, "Submit an allowlisted Ariel saved search")
	searchID := flag.String("search-id", "", "Fetch completed bounded Ariel evidence")
	out := flag.String("out", "", "New private result file (required)")
	incident := flag.Int64("incident", 0, "SOAR incident ID; omit for SIEM offenses")
	since := flag.Int64("since-ms", 0, "Inclusive replay-window lower bound")
	after := flag.Int64("after-id", 0, "ID at the lower-bound timestamp")
	until := flag.Int64("until-ms", time.Now().UnixMilli(), "Fixed polling-window upper bound")
	flag.Parse()
	if *config == "" || *out == "" {
		return integrations.ErrContract
	}
	file, err := os.Open(*config)
	if err != nil {
		return err
	}
	defer file.Close()
	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var result any
	if *provider == "sentinel" {
		var c integrations.SentinelConfig
		if err = decoder.Decode(&c); err != nil {
			return err
		}
		client, e := integrations.NewSentinel(c)
		if e != nil {
			return e
		}
		result, err = client.Incidents(ctx, *nextLink)
	} else if *provider == "qradar" {
		var c integrations.QRadarConfig
		if err = decoder.Decode(&c); err != nil {
			return err
		}
		client, e := integrations.NewQRadar(c)
		if e != nil {
			return e
		}
		if *savedSearch != 0 && *searchID != "" {
			return integrations.ErrContract
		}
		if *savedSearch != 0 {
			result, err = client.StartSavedSearch(ctx, *savedSearch)
		} else if *searchID != "" {
			var rows []json.RawMessage
			var truncated bool
			rows, truncated, err = client.SearchResults(ctx, *searchID)
			result = map[string]any{"events": rows, "requires_query_refinement": truncated}
		} else if c.Product == "qradar-soar" {
			result, err = client.Incident(ctx, *incident)
		} else {
			var rows []integrations.Offense
			var next integrations.OffenseCursor
			rows, next, err = client.Offenses(ctx, integrations.OffenseCursor{PersistedMillis: *since, ID: *after}, *until)
			result = map[string]any{"records": rows, "proposed_next_cursor": next, "cursor_committed": false}
		}
	} else {
		return integrations.ErrContract
	}
	if err != nil {
		return err
	}
	output, err := os.OpenFile(*out, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer output.Close()
	if err = json.NewEncoder(output).Encode(result); err != nil {
		return err
	}
	return output.Sync()
}
