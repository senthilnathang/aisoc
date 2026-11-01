-- Local/mock batch manifests and recoverable per-case intake checkpoints.
CREATE TABLE local_import_batches (
 tenant_id text NOT NULL REFERENCES tenants(id),
 id text NOT NULL, scope_id text NOT NULL, name text NOT NULL,
 request_hash text NOT NULL, actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE local_import_batch_items (
 tenant_id text NOT NULL, batch_id text NOT NULL, case_key text NOT NULL,
 profile_id text NOT NULL, name text NOT NULL, document jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','invalid','running','failed','accepted')),
 version integer NOT NULL DEFAULT 1, error_code text NOT NULL DEFAULT '', attempts integer NOT NULL DEFAULT 0,
 claim_token text NOT NULL DEFAULT '', lease_until timestamptz,
 accepted_inserted integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,batch_id,case_key),
 UNIQUE(tenant_id,profile_id),
 FOREIGN KEY(tenant_id,batch_id) REFERENCES local_import_batches(tenant_id,id),
 CHECK(octet_length(document::text)<=131072)
);
CREATE INDEX local_import_batches_scope ON local_import_batches(tenant_id,scope_id,created_at DESC);
