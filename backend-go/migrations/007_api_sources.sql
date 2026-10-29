CREATE TABLE api_sources (
 id text PRIMARY KEY,
 tenant_id text NOT NULL,
 name text NOT NULL, provider text NOT NULL, rule_id text NOT NULL,
 key_hash bytea CHECK(key_hash IS NULL OR octet_length(key_hash)=32),
 mapping jsonb NOT NULL DEFAULT '{"fields":{}}'::jsonb,
 expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 ordinal bigint GENERATED ALWAYS AS IDENTITY,
 FOREIGN KEY(tenant_id,rule_id) REFERENCES detection_rules(tenant_id,id)
);
CREATE INDEX api_sources_tenant_order ON api_sources(tenant_id,created_at DESC,ordinal DESC);
CREATE INDEX api_sources_rule ON api_sources(tenant_id,rule_id);
CREATE INDEX api_sources_provider ON api_sources(tenant_id,provider);
