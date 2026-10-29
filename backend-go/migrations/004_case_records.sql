CREATE TABLE case_records (
 tenant_id text NOT NULL,
 id text NOT NULL,
 investigation_id text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('artifacts','feedback')),
 document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
 ordinal bigint GENERATED ALWAYS AS IDENTITY,
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 PRIMARY KEY (tenant_id,id),
 FOREIGN KEY (tenant_id,investigation_id) REFERENCES investigations(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX case_records_case ON case_records(tenant_id,investigation_id,kind,updated_at DESC,ordinal DESC);
