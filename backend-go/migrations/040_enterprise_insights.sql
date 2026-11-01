CREATE TABLE enterprise_insights (
 tenant_id text NOT NULL REFERENCES tenants(id),
 id text NOT NULL,
 document jsonb NOT NULL,
 artifact_key text NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 archived boolean NOT NULL DEFAULT false,
 valid_from timestamptz,
 valid_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),
 CHECK(valid_until IS NULL OR valid_from IS NULL OR valid_until>valid_from)
);
CREATE INDEX enterprise_insights_match ON enterprise_insights(tenant_id,artifact_key) WHERE NOT archived;
CREATE TABLE enterprise_insight_applications (
 tenant_id text NOT NULL,
 insight_id text NOT NULL,
 investigation_id text NOT NULL,
 insight_version integer NOT NULL,
 snapshot jsonb NOT NULL,
 applied_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,insight_id,investigation_id,insight_version),
 FOREIGN KEY(tenant_id,insight_id) REFERENCES enterprise_insights(tenant_id,id),
 FOREIGN KEY(tenant_id,investigation_id) REFERENCES investigations(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX enterprise_insight_uses ON enterprise_insight_applications(tenant_id,applied_at);
