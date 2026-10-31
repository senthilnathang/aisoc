CREATE TABLE response_workflow_policies (
 tenant_id text NOT NULL, plan_id text NOT NULL, version integer NOT NULL CHECK(version>0),
 document jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,plan_id),
 FOREIGN KEY(tenant_id,plan_id) REFERENCES response_plans(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE response_workflow_previews (
 tenant_id text NOT NULL, plan_id text NOT NULL, id text NOT NULL,
 actor text NOT NULL, document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,plan_id,id),
 FOREIGN KEY(tenant_id,plan_id) REFERENCES response_plans(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX response_workflow_previews_recent ON response_workflow_previews(tenant_id,plan_id,created_at DESC);
CREATE TABLE response_workflow_policy_history (
 tenant_id text NOT NULL, plan_id text NOT NULL, version integer NOT NULL,
 actor text NOT NULL, document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,plan_id,version),
 FOREIGN KEY(tenant_id,plan_id) REFERENCES response_plans(tenant_id,id) ON DELETE CASCADE
);
