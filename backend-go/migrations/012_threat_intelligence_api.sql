ALTER TABLE threat_intel_reports ADD COLUMN ordinal bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX threat_reports_updated ON threat_intel_reports(tenant_id, updated_at DESC, ordinal DESC);
CREATE INDEX threat_indicators_updated ON threat_indicators(tenant_id, updated_at DESC, ordinal DESC);
CREATE INDEX threat_indicators_report ON threat_indicators(tenant_id, report_id, updated_at DESC, ordinal DESC);
