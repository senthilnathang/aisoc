CREATE TABLE hunt_executions (
 tenant_id text NOT NULL, hunt_id text NOT NULL, run_id text NOT NULL,
 job_id uuid NOT NULL, query text NOT NULL, expected_updated_at text NOT NULL,
 actor text NOT NULL, phase text NOT NULL DEFAULT 'queued',
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,hunt_id,run_id), UNIQUE(tenant_id,job_id),
 FOREIGN KEY(tenant_id,hunt_id) REFERENCES hunts(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,job_id) REFERENCES jobs(tenant_id,id)
);
ALTER TABLE jobs DROP CONSTRAINT jobs_plugin_id_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_plugin_id_check CHECK
 (plugin_id IN ('python.normalize','rust.sha256','rust.wasm_ascii_upper','python.investigate_mock','go.hunt_search'));
