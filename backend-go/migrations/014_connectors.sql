CREATE TABLE connectors (
 tenant_id text NOT NULL REFERENCES tenants(id),
 id text NOT NULL,
 document jsonb NOT NULL CHECK (NOT (document ?| ARRAY['secret','secret_ciphertext'])),
 secret_ciphertext bytea,
 updated_at timestamptz NOT NULL,
 ordinal bigint GENERATED ALWAYS AS IDENTITY,
 PRIMARY KEY(tenant_id,id)
);
CREATE INDEX connectors_updated ON connectors(tenant_id,updated_at DESC,ordinal DESC);
