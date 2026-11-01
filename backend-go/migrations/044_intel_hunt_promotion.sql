-- Import receipts intentionally survive report deletion as replay tombstones.
CREATE TABLE threat_json_imports (
 tenant_id text NOT NULL REFERENCES tenants(id), source text NOT NULL, external_id text NOT NULL,
 report_id text NOT NULL, content_hash text NOT NULL, actor text NOT NULL,
 document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,source,external_id)
);
CREATE INDEX threat_json_imports_report ON threat_json_imports(tenant_id,report_id);
-- Promotion receipts retain immutable evidence even if the hunt or case is removed.
CREATE TABLE hunt_promotions (
 tenant_id text NOT NULL REFERENCES tenants(id), hunt_id text NOT NULL, run_id text NOT NULL,
 finding_kind text NOT NULL, record_id text NOT NULL, investigation_id text NOT NULL,
 document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,hunt_id,run_id,finding_kind,record_id)
);
CREATE INDEX hunt_promotions_case ON hunt_promotions(tenant_id,investigation_id);
