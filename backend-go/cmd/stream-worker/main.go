package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/modules/telemetrypipeline"
	"aisoc/backend/internal/platform/config"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/eventstate"
	"aisoc/backend/internal/platform/streams"
)

func main() {
	if err := run(); err != nil && !errors.Is(err, context.Canceled) {
		slog.Error("sandbox stream worker stopped; inspect configuration and database readiness")
		os.Exit(1)
	}
}
func run() error {
	c, err := config.Load()
	if err != nil {
		return err
	}
	if os.Getenv("AISOC_GO_ENV") == "production" || len(c.Auth.StreamOperations) == 0 {
		return errors.New("explicit sandbox scopes required")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	pool, err := database.Open(ctx, c.DatabaseURL, c.PoolSize)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err = database.Ready(ctx, pool); err != nil {
		return err
	}
	pub, err := streams.New(streams.Config{Address: os.Getenv("AISOC_STREAM_REDIS_ADDR"), Username: "aisoc-publisher", Password: os.Getenv("AISOC_STREAM_REDIS_PUBLISHER_PASSWORD")})
	if err != nil {
		return err
	}
	defer pub.Close()
	consumer, err := streams.New(streams.Config{Address: os.Getenv("AISOC_STREAM_REDIS_ADDR"), Username: "aisoc-consumer", Password: os.Getenv("AISOC_STREAM_REDIS_CONSUMER_PASSWORD")})
	if err != nil {
		return err
	}
	defer consumer.Close()
	var wg sync.WaitGroup
	errs := make(chan error, len(c.Auth.StreamOperations))
	seen := map[string]bool{}
	for _, s := range c.Auth.StreamOperations {
		if !s.AllowMockImport {
			continue
		}
		key := s.TenantID + ":" + s.ConnectorID + ":" + s.Source + ":" + s.Processor
		if seen[key] {
			continue
		}
		seen[key] = true
		if _, err = pool.Exec(ctx, `INSERT INTO tenants(id) VALUES($1) ON CONFLICT DO NOTHING`, s.TenantID); err != nil {
			return err
		}
		r := telemetrypipeline.Runtime{Store: eventstate.Store{Pool: pool, MaxEvents: 1000, MaxPayloadBytes: 16 << 20}, Binding: telemetry.Binding{TenantID: s.TenantID, ConnectorID: s.ConnectorID, Source: s.Source}, Publisher: pub, Consumer: consumer, Processor: s.Processor, ConsumerName: "sandbox-worker", MaxEntries: 2000, MaxRecoveryRecords: 2000, MaxAttempts: 3}
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := r.RunMock(ctx)
			errs <- err
			if err != nil {
				cancel()
			}
		}()
	}
	if len(seen) == 0 {
		return errors.New("no mock source enabled")
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil && !errors.Is(err, context.Canceled) {
			return err
		}
	}
	return nil
}
