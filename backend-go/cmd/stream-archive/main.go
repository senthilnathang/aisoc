package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/config"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/eventstate"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Archive failed; no unverified state was compacted")
		os.Exit(1)
	}
}
func run() error {
	scopeID := flag.String("scope", "", "Configured sandbox scope")
	directory := flag.String("directory", "output/stream-archives", "Private local archive directory")
	after := flag.String("after", "", "Continue after this event key")
	days := flag.Int("min-age-days", 7, "Completed event age, 1..365 days")
	verify := flag.String("verify", "", "Verify a compressed archive instead of exporting")
	hash := flag.String("sha256", "", "Expected uncompressed bundle hash for verification")
	verifyDB := flag.Bool("verify-database", false, "Verify every archived payload reference in the configured restored database")
	flag.Parse()
	if *verify != "" {
		bundle, err := eventstate.VerifyArchive(*verify, *hash)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"verified": true, "events": len(bundle.Events), "binding": bundle.Binding})
	}
	if *days < 1 || *days > 365 {
		return errors.New("invalid retention age")
	}
	c, err := config.Load()
	if err != nil {
		return err
	}
	if !*verifyDB && (c.Auth.Mode != "local" || os.Getenv("AISOC_GO_ENV") == "production") {
		return errors.New("local sandbox export only")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := database.Open(ctx, c.DatabaseURL, c.PoolSize)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err = database.Ready(ctx, pool); err != nil {
		return err
	}
	if *verifyDB {
		rows, err := pool.Query(ctx, `SELECT a.tenant_id,a.connector_id,a.source,a.event_key,a.file_path,a.sha256,e.content_hash,e.envelope FROM stream_event_archives a JOIN stream_events e USING(tenant_id,connector_id,source,event_key) ORDER BY a.file_path,a.sha256,a.event_key`)
		if err != nil {
			return err
		}
		defer rows.Close()
		lastPath, lastHash := "", ""
		var bundle eventstate.ArchiveBundle
		var records map[string]string
		count := 0
		for rows.Next() {
			var b telemetry.Binding
			var key, path, hash, content string
			var raw []byte
			if err = rows.Scan(&b.TenantID, &b.ConnectorID, &b.Source, &key, &path, &hash, &content, &raw); err != nil {
				return err
			}
			if path != lastPath || hash != lastHash {
				bundle, err = eventstate.VerifyArchive(path, hash)
				if err != nil {
					return err
				}
				records = map[string]string{}
				for _, event := range bundle.Events {
					records[event.EventKey] = event.ContentHash
				}
				lastPath, lastHash = path, hash
			}
			var pointer struct {
				Archived bool `json:"_archive"`
			}
			if json.Unmarshal(raw, &pointer) != nil || !pointer.Archived || bundle.Binding != b || records[key] != content {
				return eventstate.ErrConflict
			}
			count++
		}
		if err = rows.Err(); err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"verified": true, "archived_payloads": count})
	}
	for _, s := range c.Auth.StreamOperations {
		if s.ID == *scopeID && s.OperatorID == "local-development" && s.AllowRetry {
			actor := auth.Principal{ID: s.OperatorID, Tenant: s.TenantID}
			b := telemetry.Binding{TenantID: s.TenantID, ConnectorID: s.ConnectorID, Source: s.Source}
			o := eventstate.OperatorRecovery{Store: eventstate.Store{Pool: pool}, Grants: []eventstate.RecoveryGrant{{Operator: actor, Binding: b}}}
			receipt, err := o.ArchiveCompleted(ctx, actor, b, s.Processor, *after, *directory, time.Duration(*days)*24*time.Hour)
			if err != nil {
				return err
			}
			return json.NewEncoder(os.Stdout).Encode(receipt)
		}
	}
	return eventstate.ErrRecoveryDenied
}
