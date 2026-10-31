-- Additive scheduler state. Old binaries may ignore it safely during rollback.
CREATE TABLE job_dispatch_tenants (
 tenant_id text PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 last_claimed_at timestamptz NOT NULL DEFAULT 'epoch'
);
CREATE FUNCTION register_job_dispatch_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO job_dispatch_tenants(tenant_id) VALUES(NEW.tenant_id) ON CONFLICT DO NOTHING;
 RETURN NEW;
END;
$$;
CREATE TRIGGER jobs_register_dispatch AFTER INSERT ON jobs
 FOR EACH ROW EXECUTE FUNCTION register_job_dispatch_tenant();
-- CREATE TRIGGER holds a write-conflicting lock until transaction commit.
-- Backfill after that fence so an earlier in-flight INSERT cannot be missed.
INSERT INTO job_dispatch_tenants(tenant_id) SELECT DISTINCT tenant_id FROM jobs
 ON CONFLICT DO NOTHING;
CREATE INDEX jobs_tenant_running ON jobs(tenant_id,lease_until) WHERE state='running';
