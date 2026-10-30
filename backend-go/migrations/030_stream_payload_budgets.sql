-- Derived payload counters avoid rescanning retained evidence on every intake.
-- The checkpoint lock still serializes intake/archival decisions. Statement
-- triggers keep insert, payload offload, deletion and rollback accounting exact.
CREATE TABLE stream_payload_budgets (
 tenant_id text NOT NULL, connector_id text NOT NULL, source text NOT NULL,
 total_events bigint NOT NULL CHECK(total_events>=0),
 hot_events bigint NOT NULL CHECK(hot_events>=0 AND hot_events<=total_events),
 hot_bytes bigint NOT NULL CHECK(hot_bytes>=0),
 PRIMARY KEY(tenant_id,connector_id,source),
 FOREIGN KEY(tenant_id,connector_id,source) REFERENCES stream_source_checkpoints(tenant_id,connector_id,source) ON DELETE CASCADE
);
CREATE FUNCTION stream_payload_hot(raw bytea) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT substring(raw FROM 1 FOR octet_length(convert_to('{"_archive":true,','UTF8')))<>convert_to('{"_archive":true,','UTF8')
$$;
INSERT INTO stream_payload_budgets
 SELECT tenant_id,connector_id,source,count(*),count(*) FILTER(WHERE stream_payload_hot(envelope)),
 COALESCE(sum(octet_length(envelope)) FILTER(WHERE stream_payload_hot(envelope)),0)
 FROM stream_events GROUP BY tenant_id,connector_id,source;

CREATE FUNCTION stream_payload_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO stream_payload_budgets
 SELECT tenant_id,connector_id,source,count(*),count(*) FILTER(WHERE stream_payload_hot(envelope)),
 COALESCE(sum(octet_length(envelope)) FILTER(WHERE stream_payload_hot(envelope)),0)
 FROM new_payloads GROUP BY tenant_id,connector_id,source ORDER BY tenant_id,connector_id,source
 ON CONFLICT(tenant_id,connector_id,source) DO UPDATE SET
 total_events=stream_payload_budgets.total_events+EXCLUDED.total_events,
 hot_events=stream_payload_budgets.hot_events+EXCLUDED.hot_events,
 hot_bytes=stream_payload_budgets.hot_bytes+EXCLUDED.hot_bytes;
 RETURN NULL;
END $$;
CREATE FUNCTION stream_payload_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE stream_payload_budgets b SET total_events=b.total_events-d.total,hot_events=b.hot_events-d.hot,hot_bytes=b.hot_bytes-d.bytes
 FROM (SELECT tenant_id,connector_id,source,count(*) total,count(*) FILTER(WHERE stream_payload_hot(envelope)) hot,
 COALESCE(sum(octet_length(envelope)) FILTER(WHERE stream_payload_hot(envelope)),0) bytes
 FROM old_payloads GROUP BY tenant_id,connector_id,source) d
 WHERE b.tenant_id=d.tenant_id AND b.connector_id=d.connector_id AND b.source=d.source;
 RETURN NULL;
END $$;
CREATE FUNCTION stream_payload_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE stream_payload_budgets b SET hot_events=b.hot_events+d.hot,hot_bytes=b.hot_bytes+d.bytes
 FROM (SELECT tenant_id,connector_id,source,sum(hot) hot,sum(bytes) bytes FROM (
 SELECT tenant_id,connector_id,source,CASE WHEN stream_payload_hot(envelope) THEN 1 ELSE 0 END hot,
 CASE WHEN stream_payload_hot(envelope) THEN octet_length(envelope) ELSE 0 END bytes FROM new_payloads
 UNION ALL
 SELECT tenant_id,connector_id,source,CASE WHEN stream_payload_hot(envelope) THEN -1 ELSE 0 END,
 CASE WHEN stream_payload_hot(envelope) THEN -octet_length(envelope) ELSE 0 END FROM old_payloads
 ) changes GROUP BY tenant_id,connector_id,source HAVING sum(hot)<>0 OR sum(bytes)<>0) d
 WHERE b.tenant_id=d.tenant_id AND b.connector_id=d.connector_id AND b.source=d.source;
 RETURN NULL;
END $$;
CREATE TRIGGER stream_payload_insert AFTER INSERT ON stream_events REFERENCING NEW TABLE AS new_payloads FOR EACH STATEMENT EXECUTE FUNCTION stream_payload_insert();
CREATE TRIGGER stream_payload_delete AFTER DELETE ON stream_events REFERENCING OLD TABLE AS old_payloads FOR EACH STATEMENT EXECUTE FUNCTION stream_payload_delete();
CREATE TRIGGER stream_payload_update AFTER UPDATE ON stream_events REFERENCING OLD TABLE AS old_payloads NEW TABLE AS new_payloads FOR EACH STATEMENT EXECUTE FUNCTION stream_payload_update();
CREATE FUNCTION stream_payload_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.tenant_id,NEW.connector_id,NEW.source,NEW.event_key) IS DISTINCT FROM (OLD.tenant_id,OLD.connector_id,OLD.source,OLD.event_key) THEN
 RAISE EXCEPTION 'stream event identity is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stream_payload_identity BEFORE UPDATE ON stream_events FOR EACH ROW EXECUTE FUNCTION stream_payload_identity_immutable();
