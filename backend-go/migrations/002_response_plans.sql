CREATE TABLE response_plans (
 tenant_id text NOT NULL REFERENCES tenants(id),
 id text NOT NULL,
 ordinal bigint GENERATED ALWAYS AS IDENTITY,
 document jsonb NOT NULL CHECK (jsonb_typeof(document)='object'),
 PRIMARY KEY (tenant_id,id)
);
CREATE INDEX response_plans_order ON response_plans(tenant_id,ordinal DESC);
CREATE TABLE response_plan_versions (
 tenant_id text NOT NULL,
 plan_id text NOT NULL,
 version integer NOT NULL CHECK (version>0),
 snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
 action text NOT NULL CHECK (action IN ('created','updated','archived','restored')),
 actor text NOT NULL,
 created_at timestamptz NOT NULL,
 PRIMARY KEY (tenant_id,plan_id,version),
 FOREIGN KEY (tenant_id,plan_id) REFERENCES response_plans(tenant_id,id)
);
