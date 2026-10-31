CREATE TABLE hunt_search_runs (
 tenant_id text NOT NULL,hunt_id text NOT NULL,id text NOT NULL,document jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,hunt_id,id),
 FOREIGN KEY(tenant_id,hunt_id) REFERENCES hunts(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX hunt_search_runs_latest ON hunt_search_runs(tenant_id,hunt_id,created_at DESC,id);
CREATE TABLE hunt_notes (
 tenant_id text NOT NULL,hunt_id text NOT NULL,id text NOT NULL,actor text NOT NULL,body text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,hunt_id,id),
 FOREIGN KEY(tenant_id,hunt_id) REFERENCES hunts(tenant_id,id) ON DELETE CASCADE
);
