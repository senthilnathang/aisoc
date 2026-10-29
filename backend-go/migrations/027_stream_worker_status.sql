CREATE TABLE stream_worker_status (
 tenant_id text NOT NULL REFERENCES tenants(id), connector_id text NOT NULL, source text NOT NULL,
 processor text NOT NULL, worker_id text NOT NULL,
 last_seen timestamptz NOT NULL DEFAULT now(), error_code text NOT NULL DEFAULT '',
 PRIMARY KEY(tenant_id,connector_id,source,processor,worker_id),
 CHECK(error_code IN ('','PIPELINE_RETRY'))
);
