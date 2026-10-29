package main

import (
	"aisoc/backend/internal/modules/intake"
	"aisoc/backend/internal/platform/config"
	"aisoc/backend/internal/platform/database"
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		slog.Error("investigation worker stopped; check isolated configuration and schema")
		os.Exit(1)
	}
}
func run() error {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	c, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := database.Open(ctx, c.DatabaseURL, c.PoolSize)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err = database.Ready(ctx, pool); err != nil {
		return err
	}
	store := intake.Store{Pool: pool}
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			phase, cancel := context.WithTimeout(ctx, 10*time.Second)
			_, err := store.ProcessNext(phase)
			cancel()
			if err != nil && ctx.Err() == nil {
				slog.Error("investigation phase transaction failed")
			}
		}
	}
}
