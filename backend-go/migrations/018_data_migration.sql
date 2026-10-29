CREATE TABLE migration_imports (
 snapshot_hash text PRIMARY KEY,
 metadata jsonb NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now()
);
