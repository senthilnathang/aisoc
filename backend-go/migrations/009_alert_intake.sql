CREATE TABLE alerts (
 tenant_id text NOT NULL, id text NOT NULL, source text NOT NULL, external_id text NOT NULL,
 rule_id text NOT NULL, investigation_id text, document jsonb NOT NULL,
 payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 created_at timestamptz NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,source,external_id),
 FOREIGN KEY(tenant_id,rule_id) REFERENCES detection_rules(tenant_id,id),
 FOREIGN KEY(tenant_id,investigation_id) REFERENCES investigations(tenant_id,id)
);
CREATE INDEX alerts_rule ON alerts(tenant_id,rule_id);
CREATE INDEX alerts_case ON alerts(tenant_id,investigation_id);
CREATE INDEX alerts_order ON alerts(tenant_id,created_at DESC,ordinal DESC);
CREATE TABLE investigation_jobs (
 tenant_id text NOT NULL, id text NOT NULL, investigation_id text NOT NULL, alert_id text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
 phase integer NOT NULL DEFAULT 0 CHECK(phase BETWEEN 0 AND 3), result jsonb NOT NULL DEFAULT '{}', error text,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,investigation_id) REFERENCES investigations(tenant_id,id),
 FOREIGN KEY(tenant_id,alert_id) REFERENCES alerts(tenant_id,id)
);
CREATE INDEX investigation_jobs_case ON investigation_jobs(tenant_id,investigation_id,status);
CREATE UNIQUE INDEX investigation_jobs_active ON investigation_jobs(tenant_id,investigation_id) WHERE status IN ('queued','running');
