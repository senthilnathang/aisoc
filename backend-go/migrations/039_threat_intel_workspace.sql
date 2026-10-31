ALTER TABLE threat_intel_reports ADD COLUMN threat_actor text NOT NULL DEFAULT '';
ALTER TABLE threat_intel_reports ADD COLUMN targeted_industry text NOT NULL DEFAULT '';
ALTER TABLE threat_intel_reports ADD COLUMN targeted_region text NOT NULL DEFAULT '';
ALTER TABLE threat_intel_reports ADD COLUMN relevant boolean NOT NULL DEFAULT false;
CREATE TABLE threat_report_hunts (
 tenant_id text NOT NULL,report_id text NOT NULL,request_id text NOT NULL,hunt_id text NOT NULL,
 indicator_id text NOT NULL,indicator_value text NOT NULL,actor text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,report_id,request_id),
 FOREIGN KEY(tenant_id,report_id) REFERENCES threat_intel_reports(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX threat_report_hunts_recent ON threat_report_hunts(tenant_id,report_id,created_at DESC);

-- Hunt IDs intentionally survive hunt deletion as request replay tombstones.
