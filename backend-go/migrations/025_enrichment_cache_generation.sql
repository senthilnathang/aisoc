-- Generation is durable metadata, not cached evidence. Changes invalidate hits
-- and negative entries without coordinating Redis with the source transaction.
CREATE TABLE enrichment_generations (
 tenant_id text PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 generation uuid NOT NULL DEFAULT gen_random_uuid()
);
INSERT INTO enrichment_generations(tenant_id) SELECT DISTINCT tenant_id FROM threat_indicators;
CREATE FUNCTION invalidate_local_ioc_cache() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected text;
BEGIN
 IF TG_OP <> 'INSERT' THEN
  affected := OLD.tenant_id;
  INSERT INTO enrichment_generations(tenant_id)
   SELECT id FROM tenants WHERE id=affected
   ON CONFLICT(tenant_id) DO UPDATE SET generation=gen_random_uuid();
 END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
  affected := NEW.tenant_id;
  INSERT INTO enrichment_generations(tenant_id)
   SELECT id FROM tenants WHERE id=affected
   ON CONFLICT(tenant_id) DO UPDATE SET generation=gen_random_uuid();
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER local_ioc_cache_generation
 AFTER INSERT OR UPDATE OR DELETE ON threat_indicators
 FOR EACH ROW EXECUTE FUNCTION invalidate_local_ioc_cache();
