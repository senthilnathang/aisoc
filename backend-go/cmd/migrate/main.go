package main

import (
	"aisoc/backend/internal/platform/config"
	"aisoc/backend/internal/platform/database"
	"context"
	"log/slog"
	"os"
	"time"
)

func main() {
	if err := run(); err != nil {
		slog.Error("migration failed; verify isolated database configuration")
		os.Exit(1)
	}
}
func run() error {
	c, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := database.Open(ctx, c.DatabaseURL, 1)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err == nil {
		slog.Info("framework schema migrated")
	}
	return err
}
