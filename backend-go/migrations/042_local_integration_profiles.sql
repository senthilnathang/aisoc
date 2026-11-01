CREATE TABLE local_integration_profiles (
 tenant_id text NOT NULL REFERENCES tenants(id),
 id text NOT NULL,
 scope_id text NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','sealed')),
 document jsonb NOT NULL CHECK(octet_length(document::text)<=65536),
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id)
);
CREATE INDEX local_integration_scope ON local_integration_profiles(tenant_id,scope_id);
