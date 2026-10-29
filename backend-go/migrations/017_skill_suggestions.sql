CREATE TABLE skill_suggestions (
 tenant_id text NOT NULL REFERENCES tenants(id),id text NOT NULL,signature text NOT NULL,
 document jsonb NOT NULL,ordinal bigint GENERATED ALWAYS AS IDENTITY,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,signature)
);
