ALTER TABLE investigations ADD COLUMN ordinal bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX investigations_queue_order ON investigations(tenant_id,created_at DESC,ordinal DESC);
CREATE INDEX investigation_jobs_latest ON investigation_jobs(tenant_id,investigation_id,created_at DESC,ordinal DESC);
