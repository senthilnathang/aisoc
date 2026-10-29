-- Derived retained-record counters. Original work/gap rows remain authoritative.
-- Statement triggers preserve rollback and bulk-load/delete accounting.
CREATE TABLE stream_metadata_budgets (
 tenant_id text NOT NULL, connector_id text NOT NULL, source text NOT NULL,
 processor text NOT NULL, retained_records bigint NOT NULL CHECK(retained_records>=0),
 PRIMARY KEY(tenant_id,connector_id,source,processor),
 FOREIGN KEY(tenant_id,connector_id,source) REFERENCES stream_source_checkpoints(tenant_id,connector_id,source) ON DELETE CASCADE
);
INSERT INTO stream_metadata_budgets
 SELECT tenant_id,connector_id,source,processor,count(*) FROM (
 SELECT tenant_id,connector_id,source,processor FROM stream_consumer_work
 UNION ALL SELECT tenant_id,connector_id,source,processor FROM stream_replay_gaps
 ) records GROUP BY tenant_id,connector_id,source,processor;

CREATE FUNCTION stream_metadata_budget_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO stream_metadata_budgets(tenant_id,connector_id,source,processor,retained_records)
 SELECT tenant_id,connector_id,source,processor,count(*) FROM new_records
 GROUP BY tenant_id,connector_id,source,processor ORDER BY tenant_id,connector_id,source,processor
 ON CONFLICT(tenant_id,connector_id,source,processor) DO UPDATE
 SET retained_records=stream_metadata_budgets.retained_records+EXCLUDED.retained_records;
 RETURN NULL;
END $$;
CREATE FUNCTION stream_metadata_budget_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE stream_metadata_budgets b SET retained_records=b.retained_records-d.n
 FROM (SELECT tenant_id,connector_id,source,processor,count(*) n FROM old_records
 GROUP BY tenant_id,connector_id,source,processor) d
 WHERE b.tenant_id=d.tenant_id AND b.connector_id=d.connector_id AND b.source=d.source AND b.processor=d.processor;
 RETURN NULL;
END $$;
CREATE FUNCTION stream_metadata_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.tenant_id,NEW.connector_id,NEW.source,NEW.processor) IS DISTINCT FROM
 (OLD.tenant_id,OLD.connector_id,OLD.source,OLD.processor) THEN
 RAISE EXCEPTION 'stream metadata scope is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stream_work_budget_insert AFTER INSERT ON stream_consumer_work REFERENCING NEW TABLE AS new_records FOR EACH STATEMENT EXECUTE FUNCTION stream_metadata_budget_insert();
CREATE TRIGGER stream_work_budget_delete AFTER DELETE ON stream_consumer_work REFERENCING OLD TABLE AS old_records FOR EACH STATEMENT EXECUTE FUNCTION stream_metadata_budget_delete();
CREATE TRIGGER stream_work_scope BEFORE UPDATE ON stream_consumer_work FOR EACH ROW EXECUTE FUNCTION stream_metadata_identity_immutable();
CREATE TRIGGER stream_gap_budget_insert AFTER INSERT ON stream_replay_gaps REFERENCING NEW TABLE AS new_records FOR EACH STATEMENT EXECUTE FUNCTION stream_metadata_budget_insert();
CREATE TRIGGER stream_gap_budget_delete AFTER DELETE ON stream_replay_gaps REFERENCING OLD TABLE AS old_records FOR EACH STATEMENT EXECUTE FUNCTION stream_metadata_budget_delete();
CREATE TRIGGER stream_gap_scope BEFORE UPDATE ON stream_replay_gaps FOR EACH ROW EXECUTE FUNCTION stream_metadata_identity_immutable();
