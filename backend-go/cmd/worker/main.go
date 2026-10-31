package main

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"aisoc/backend/internal/platform/config"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/jobs"
	"aisoc/backend/internal/platform/plugins"
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
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
		tlsConfig := config.WorkerTLS{}
		if name == "python.normalize" || name == "python.investigate_mock" {
			tlsConfig = c.PythonTLS
		}
		client, err := plugins.NewWithTLS(address, c.WorkerToken, tlsConfig)
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
	store := jobs.Store{Pool: pool, Plugins: allowed, TenantLimit: c.TenantWorkerLimit}
	return jobs.Dispatch(ctx, store, func(ctx context.Context, request *pb.ExecuteRequest) ([]byte, error) {
		client := clients[request.PluginId]
		if client == nil {
			return nil, errors.New("plugin unavailable")
		}
		return client.Execute(ctx, request)
	}, c.WorkerConcurrency, func(error) { slog.Warn("job dispatch or execution failed; lease recovery remains available") })
}
