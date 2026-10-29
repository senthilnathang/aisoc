-- Additive streaming foundation. No existing HTTP intake/job tables are changed.
CREATE TABLE stream_source_checkpoints (
 tenant_id text NOT NULL REFERENCES tenants(id),
 connector_id text NOT NULL CHECK(length(connector_id) BETWEEN 1 AND 128),
 source text NOT NULL CHECK(length(source) BETWEEN 1 AND 128),
 cursor text NOT NULL DEFAULT '' CHECK(octet_length(cursor)<=2048),
 version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,connector_id,source)
);
CREATE TABLE stream_events (
 tenant_id text NOT NULL, connector_id text NOT NULL, source text NOT NULL,
 event_key text NOT NULL CHECK(event_key ~ '^[0-9a-f]{64}$'),
 content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
 envelope bytea NOT NULL CHECK(octet_length(envelope) BETWEEN 1 AND 16384),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,connector_id,source,event_key),
 FOREIGN KEY(tenant_id,connector_id,source) REFERENCES stream_source_checkpoints(tenant_id,connector_id,source)
);
CREATE TABLE stream_outbox (
 tenant_id text NOT NULL, connector_id text NOT NULL, source text NOT NULL, event_key text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','publishing','published','failed')),
 attempt_id uuid, attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 20),
 lease_until timestamptz, available_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz, message_id text CHECK(length(message_id) BETWEEN 1 AND 128),
 error_code text CHECK(error_code IN ('PUBLISH_FAILED','ATTEMPTS_EXHAUSTED')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,connector_id,source,event_key),
 FOREIGN KEY(tenant_id,connector_id,source,event_key) REFERENCES stream_events(tenant_id,connector_id,source,event_key),
 CHECK ((state='publishing') = (lease_until IS NOT NULL)),
 CHECK (state!='publishing' OR attempt_id IS NOT NULL),
 CHECK ((state='published') = (published_at IS NOT NULL)),
 CHECK ((state='published') = (message_id IS NOT NULL))
);
CREATE INDEX stream_outbox_pending ON stream_outbox(tenant_id,connector_id,source,available_at,created_at,event_key)
 WHERE state IN ('queued','publishing');
CREATE TABLE stream_inbox (
 tenant_id text NOT NULL, connector_id text NOT NULL, source text NOT NULL,
 processor text NOT NULL CHECK(length(processor) BETWEEN 1 AND 128), event_key text NOT NULL,
 content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
 disposition text NOT NULL CHECK(disposition IN ('filtered','finding','rejected')),
 processed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,connector_id,source,processor,event_key),
 FOREIGN KEY(tenant_id,connector_id,source,event_key) REFERENCES stream_events(tenant_id,connector_id,source,event_key)
);
