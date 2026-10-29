package main

import (
	"aisoc/backend/internal/platform/config"
	"aisoc/backend/internal/platform/database"
	"aisoc/backend/internal/platform/migration"
	"context"
	"encoding/json"
	"fmt"
	"os"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	if len(os.Args) != 3 || (os.Args[1] != "import" && os.Args[1] != "export") {
		return fmt.Errorf("usage: data-migrate import|export snapshot.json")
	}
	c, err := config.Load()
	if err != nil {
		return err
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, c.DatabaseURL, c.PoolSize)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err = database.Migrate(ctx, pool); err != nil {
		return fmt.Errorf("schema migration failed")
	}
	if os.Args[1] == "import" {
		raw, err := os.ReadFile(os.Args[2])
		if err != nil {
			return err
		}
		report, err := migration.Import(ctx, pool, raw, c.ConnectorKey)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(report)
	}
	snapshot, err := migration.Export(ctx, pool, c.ConnectorKey)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(os.Args[2], os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	if err = json.NewEncoder(f).Encode(snapshot); err != nil {
		return err
	}
	fmt.Println("Snapshot exported to a new private file.")
	return nil
}
