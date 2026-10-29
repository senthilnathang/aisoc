package main

import (
	"aisoc/backend/internal/platform/config"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"aisoc/backend/internal/platform/plugins"
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		slog.Error("worker stopped; check configuration and isolated schema")
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
	clients := map[string]*plugins.Client{}
	for name, address := range map[string]string{"python.normalize": c.PythonAddress, "python.investigate_mock": c.PythonAddress, "rust.sha256": c.RustAddress, "rust.wasm_ascii_upper": c.RustAddress} {
		if address == "" {
			continue
		}
		client, err := plugins.New(address, c.WorkerToken)
		if err != nil {
			return err
		}
		defer client.Close()
		clients[name] = client
	}
	allowed := make([]string, 0, len(clients))
	for name := range clients {
		allowed = append(allowed, name)
	}
	store := jobs.Store{Pool: pool, Plugins: allowed}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			request, err := store.Claim(ctx)
			if err != nil {
				slog.Error("job claim failed")
				continue
			}
			if request == nil {
				continue
			}
			client := clients[request.PluginId]
			if client == nil {
				_ = store.Retry(ctx, request)
				continue
			}
			result, err := client.Execute(ctx, request)
			if err != nil {
				_ = store.Retry(ctx, request)
				slog.Warn("plugin execution failed", "job_id", request.JobId)
				continue
			}
			if err = store.Complete(ctx, request, result); err != nil {
				slog.Warn("job result not committed", "job_id", request.JobId)
			}
		}
	}
}
