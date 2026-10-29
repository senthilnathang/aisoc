CREATE TABLE detection_rules (
 tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL,
 ordinal bigint GENERATED ALWAYS AS IDENTITY,
 PRIMARY KEY(tenant_id,id),
 CHECK(jsonb_typeof(document->'enabled')='boolean')
);
CREATE INDEX detection_rules_order ON detection_rules(tenant_id,updated_at DESC,ordinal);
CREATE TABLE detection_rule_versions (
 tenant_id text NOT NULL, rule_id text NOT NULL, version integer NOT NULL CHECK(version>0),
 snapshot jsonb NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,rule_id,version),
 FOREIGN KEY(tenant_id,rule_id) REFERENCES detection_rules(tenant_id,id) ON DELETE CASCADE
);
