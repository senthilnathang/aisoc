-- Optional stream finding admission; existing HTTP intake remains unchanged.
CREATE TABLE stream_admission_tenants (
 tenant_id text PRIMARY KEY REFERENCES tenants(id),
 last_dispatched timestamptz NOT NULL DEFAULT '-infinity'
);
CREATE TABLE stream_findings (
 tenant_id text NOT NULL, connector_id text NOT NULL, source text NOT NULL,
 finding_id text NOT NULL CHECK(finding_id ~ '^[0-9a-f]{64}$'),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
 rule_id text NOT NULL, alert_id text NOT NULL, investigation_id text NOT NULL, job_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,connector_id,source,finding_id),
 UNIQUE(tenant_id,job_id),
 UNIQUE(tenant_id,investigation_id),
 FOREIGN KEY(tenant_id) REFERENCES stream_admission_tenants(tenant_id),
 FOREIGN KEY(tenant_id,connector_id,source) REFERENCES stream_source_checkpoints(tenant_id,connector_id,source),
 FOREIGN KEY(tenant_id,rule_id) REFERENCES detection_rules(tenant_id,id),
 FOREIGN KEY(tenant_id,alert_id) REFERENCES alerts(tenant_id,id),
 FOREIGN KEY(tenant_id,investigation_id) REFERENCES investigations(tenant_id,id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES investigation_jobs(tenant_id,id)
);
