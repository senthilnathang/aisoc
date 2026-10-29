CREATE TABLE remediations (
 tenant_id text NOT NULL,
 id text NOT NULL,
 investigation_id text NOT NULL,
 document jsonb NOT NULL CHECK (jsonb_typeof(document)='object'),
 ordinal bigint GENERATED ALWAYS AS IDENTITY,
 updated_at timestamptz NOT NULL,
 PRIMARY KEY (tenant_id,id),
 FOREIGN KEY (tenant_id,investigation_id) REFERENCES investigations(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX remediations_case ON remediations(tenant_id,investigation_id,updated_at DESC,ordinal DESC);
CREATE INDEX remediations_order ON remediations(tenant_id,updated_at DESC,ordinal DESC);
