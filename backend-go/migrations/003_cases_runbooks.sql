CREATE TABLE investigations (
 tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL,
 title text NOT NULL, summary text NOT NULL DEFAULT '', source text NOT NULL,
 category text NOT NULL DEFAULT 'other',
 severity text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','contained','resolved','closed')),
 determination text NOT NULL DEFAULT 'unknown' CHECK (determination IN ('unknown','benign','suspicious','malicious','mitigated')),
 risk_score integer NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
 owner text NOT NULL DEFAULT 'AISOC Agent', primary_entity text NOT NULL DEFAULT '',
 replay_count integer NOT NULL DEFAULT 0, insight_refs jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 PRIMARY KEY (tenant_id,id), CHECK (jsonb_typeof(insight_refs)='array')
);
CREATE INDEX investigations_order ON investigations(tenant_id,updated_at DESC,id);
CREATE TABLE audit_events (
 tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL,
 resource text NOT NULL, resource_id text NOT NULL, action text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}', ordinal bigint GENERATED ALWAYS AS IDENTITY,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 PRIMARY KEY (tenant_id,id)
);
CREATE INDEX audit_events_resource ON audit_events(tenant_id,resource,resource_id,created_at DESC,ordinal DESC);
CREATE TABLE case_runbooks (
 tenant_id text NOT NULL, id text NOT NULL, investigation_id text NOT NULL, plan_id text NOT NULL,
 document jsonb NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
 PRIMARY KEY (tenant_id,id), UNIQUE (tenant_id,investigation_id,plan_id),
 FOREIGN KEY (tenant_id,investigation_id) REFERENCES investigations(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id,plan_id) REFERENCES response_plans(tenant_id,id)
);
CREATE INDEX case_runbooks_case ON case_runbooks(tenant_id,investigation_id,ordinal DESC);
CREATE TABLE case_runbook_events (
 tenant_id text NOT NULL, assignment_id text NOT NULL, version integer NOT NULL CHECK (version>0),
 document jsonb NOT NULL, PRIMARY KEY (tenant_id,assignment_id,version),
 FOREIGN KEY (tenant_id,assignment_id) REFERENCES case_runbooks(tenant_id,id) ON DELETE CASCADE
);
