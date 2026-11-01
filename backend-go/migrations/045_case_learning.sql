-- Immutable approval receipts survive source/destination deletion for replay safety.
CREATE TABLE case_learning (
 tenant_id text NOT NULL REFERENCES tenants(id), investigation_id text NOT NULL,
 source_version text NOT NULL, request_hash text NOT NULL, document jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,investigation_id,source_version)
);
