CREATE TABLE IF NOT EXISTS tenants (
 id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jobs (
 tenant_id text NOT NULL REFERENCES tenants(id),
 id uuid NOT NULL,
 plugin_id text NOT NULL CHECK (plugin_id IN ('python.normalize','rust.sha256')),
 plugin_version text NOT NULL CHECK (plugin_version = '1'),
 input bytea NOT NULL CHECK (octet_length(input) <= 65536),
 output bytea CHECK (octet_length(output) <= 65536),
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','completed','failed','cancelled')),
 attempt_id uuid,
 attempts integer NOT NULL DEFAULT 0,
 max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
 lease_until timestamptz,
 available_at timestamptz NOT NULL DEFAULT now(),
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS jobs_claim ON jobs (available_at, created_at, id) WHERE state IN ('queued','running');
-- Outbox and domain schemas are introduced with their first transactional owner.
