-- Durable retry/DLQ metadata. Payloads remain in stream_events, not failure logs.
ALTER TABLE stream_outbox ADD COLUMN recovery_count integer NOT NULL DEFAULT 0 CHECK(recovery_count BETWEEN 0 AND 3);
CREATE TABLE stream_consumer_work (
 tenant_id text NOT NULL,connector_id text NOT NULL,source text NOT NULL,
 processor text NOT NULL CHECK(length(processor) BETWEEN 1 AND 128),
 work_key text NOT NULL CHECK(length(work_key) BETWEEN 1 AND 140),
 state text NOT NULL DEFAULT 'waiting' CHECK(state IN ('waiting','running','done','dead')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 max_attempts integer NOT NULL CHECK(max_attempts BETWEEN 1 AND 10),
 attempt_id uuid,lease_until timestamptz,available_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,connector_id,source,processor,work_key),
 FOREIGN KEY(tenant_id,connector_id,source) REFERENCES stream_source_checkpoints(tenant_id,connector_id,source),
 CHECK((state='running')=(lease_until IS NOT NULL)),
 CHECK(state!='running' OR attempt_id IS NOT NULL)
);
CREATE TABLE stream_dead_letters (
 tenant_id text NOT NULL,connector_id text NOT NULL,source text NOT NULL,processor text NOT NULL,work_key text NOT NULL,
 message_id text NOT NULL CHECK(length(message_id) BETWEEN 1 AND 128),
 reason text NOT NULL CHECK(reason IN ('INVALID_DELIVERY','UNKNOWN_EVENT','CONTENT_CONFLICT','HANDLER_FAILED','ATTEMPTS_EXHAUSTED')),
 attempts integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,connector_id,source,processor,work_key),
 FOREIGN KEY(tenant_id,connector_id,source,processor,work_key) REFERENCES stream_consumer_work(tenant_id,connector_id,source,processor,work_key)
);
CREATE TABLE stream_replay_gaps (
 tenant_id text NOT NULL,connector_id text NOT NULL,source text NOT NULL,processor text NOT NULL,
 message_id text NOT NULL CHECK(length(message_id) BETWEEN 1 AND 128),
 event_key text CHECK(event_key ~ '^[0-9a-f]{64}$'),observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,connector_id,source,processor,message_id),
 FOREIGN KEY(tenant_id,connector_id,source) REFERENCES stream_source_checkpoints(tenant_id,connector_id,source)
);
