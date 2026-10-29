-- Verified local payload offload. Durable event identity, hash and inbox stay.
CREATE TABLE stream_event_archives (
 tenant_id text NOT NULL,connector_id text NOT NULL,source text NOT NULL,event_key text NOT NULL,
 file_path text NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 archived_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,connector_id,source,event_key),
 FOREIGN KEY(tenant_id,connector_id,source,event_key) REFERENCES stream_events(tenant_id,connector_id,source,event_key) ON DELETE CASCADE
);
