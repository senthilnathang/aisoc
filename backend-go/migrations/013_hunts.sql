CREATE TABLE hunts (
 tenant_id text NOT NULL REFERENCES tenants(id),
 id text NOT NULL,
 document jsonb NOT NULL,
 updated_at timestamptz NOT NULL,
 ordinal bigint GENERATED ALWAYS AS IDENTITY,
 PRIMARY KEY(tenant_id,id)
);
CREATE INDEX hunts_updated ON hunts(tenant_id,updated_at DESC,ordinal DESC);
