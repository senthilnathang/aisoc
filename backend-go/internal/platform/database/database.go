package database

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"time"

	"aisoc/backend/migrations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Open(ctx context.Context, url string, max int32) (*pgxpool.Pool, error) {
	c, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("invalid database configuration")
	}
	if !strings.HasPrefix(c.ConnConfig.Database, "aisoc_go_") {
		return nil, fmt.Errorf("replacement database name must begin with aisoc_go_")
	}
	c.MaxConns = max
	c.ConnConfig.ConnectTimeout = 5 * time.Second
	c.ConnConfig.RuntimeParams["application_name"] = "aisoc-go-framework"
	c.ConnConfig.RuntimeParams["statement_timeout"] = "5000"
	c.ConnConfig.RuntimeParams["idle_in_transaction_session_timeout"] = "10000"
	pool, err := pgxpool.NewWithConfig(ctx, c)
	if err != nil {
		return nil, fmt.Errorf("database pool initialization failed")
	}
	return pool, nil
}

func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(714203001)`); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	files, err := migrations.Files.ReadDir(".")
	if err != nil {
		return err
	}
	for _, file := range files {
		data, err := migrations.Files.ReadFile(file.Name())
		if err != nil {
			return err
		}
		checksum := fmt.Sprintf("%x", sha256.Sum256(data))
		var prior string
		err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, file.Name()).Scan(&prior)
		if err == nil {
			if prior != checksum {
				return fmt.Errorf("migration checksum mismatch: %s", file.Name())
			}
			continue
		}
		if err != pgx.ErrNoRows {
			return err
		}
		if _, err = tx.Exec(ctx, string(data)); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES ($1,$2)`, file.Name(), checksum); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func Ready(ctx context.Context, pool *pgxpool.Pool) error {
	if err := pool.Ping(ctx); err != nil {
		return err
	}
	files, err := migrations.Files.ReadDir(".")
	if err != nil {
		return err
	}
	for _, file := range files {
		data, err := migrations.Files.ReadFile(file.Name())
		if err != nil {
			return err
		}
		var checksum string
		if err = pool.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, file.Name()).Scan(&checksum); err != nil {
			return err
		}
		if checksum != fmt.Sprintf("%x", sha256.Sum256(data)) {
			return fmt.Errorf("schema version mismatch")
		}
	}
	return nil
}
