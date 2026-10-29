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
	if c.Auth.Mode != "local" || os.Getenv("AISOC_GO_ENV") == "production" {
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
