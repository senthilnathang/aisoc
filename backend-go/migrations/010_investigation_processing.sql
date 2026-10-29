CREATE TABLE investigation_steps (
 tenant_id text NOT NULL,id text NOT NULL,investigation_id text NOT NULL,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
 created_at timestamptz NOT NULL,ordinal bigint GENERATED ALWAYS AS IDENTITY,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,investigation_id) REFERENCES investigations(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX investigation_steps_case ON investigation_steps(tenant_id,investigation_id,created_at,ordinal);
-- Storage required by the local comparison phase. Authoring APIs and imports
-- for reports/indicators are separate migration work; no seed data is inserted.
CREATE TABLE threat_intel_reports (
 tenant_id text NOT NULL REFERENCES tenants(id),id text NOT NULL,
 title text NOT NULL,summary text NOT NULL DEFAULT '',source text NOT NULL DEFAULT 'AISOC',
 report_type text NOT NULL DEFAULT 'threat_report' CHECK(report_type IN ('threat_report','advisory','ioc_feed','hunt_pack')),
 severity text NOT NULL CHECK(severity IN ('low','medium','high','critical')),
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewing','actionable','archived')),
 ioc_count integer NOT NULL DEFAULT 0,hunt_status text NOT NULL DEFAULT 'not_started' CHECK(hunt_status IN ('not_started','hunting','completed','no_findings')),
 hunts_launched integer NOT NULL DEFAULT 0,findings_count integer NOT NULL DEFAULT 0,
 tags jsonb NOT NULL DEFAULT '[]',published_at timestamptz NOT NULL,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE threat_indicators (
 tenant_id text NOT NULL,id text NOT NULL,report_id text NOT NULL,
 indicator_type text NOT NULL CHECK(indicator_type IN ('ip','domain','hash_sha256','hash_md5','url','email','cve')),
 value text NOT NULL,severity text NOT NULL DEFAULT 'medium',
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','mitigated','expired','false_positive')),
 hits integer NOT NULL DEFAULT 0,last_seen_at timestamptz,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
 ordinal bigint GENERATED ALWAYS AS IDENTITY,PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,report_id) REFERENCES threat_intel_reports(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX threat_indicators_match ON threat_indicators(tenant_id,indicator_type,value,ordinal) WHERE status='active';
CREATE INDEX investigation_jobs_pending ON investigation_jobs(updated_at,ordinal) WHERE status IN ('queued','running');
