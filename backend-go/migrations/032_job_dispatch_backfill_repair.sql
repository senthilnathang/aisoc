-- Repair the known pre-fence 031 deployment without rewriting its recorded hash.
-- This is also safe (and normally a no-op) after corrected 031 on fresh installs.
LOCK TABLE jobs IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO job_dispatch_tenants(tenant_id)
 SELECT DISTINCT tenant_id FROM jobs ON CONFLICT DO NOTHING;
