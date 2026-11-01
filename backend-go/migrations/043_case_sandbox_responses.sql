-- Durable case linkage for the existing local-only session executor.
CREATE TABLE case_sandbox_responses (
 tenant_id text NOT NULL, investigation_id text NOT NULL,
 connector_id text NOT NULL, source text NOT NULL, action_id text NOT NULL,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
 receipt jsonb, approval_comment text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,connector_id,source,action_id),
 FOREIGN KEY(tenant_id,investigation_id) REFERENCES investigations(tenant_id,id),
 FOREIGN KEY(tenant_id,connector_id,source,action_id) REFERENCES sandbox_session_actions(tenant_id,connector_id,source,id),
 CHECK(octet_length(document::text)<=32768)
);
CREATE INDEX case_sandbox_responses_case ON case_sandbox_responses(tenant_id,investigation_id,created_at DESC);
-- Separate from L1 note approval: one append-only response receipt per action.
CREATE TABLE mock_soar_response_notes (
 tenant_id text NOT NULL, connector_id text NOT NULL, external_id text NOT NULL,
 id text NOT NULL, investigation_id text NOT NULL,
 body text NOT NULL CHECK(octet_length(body)<=8192), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,connector_id,external_id) REFERENCES mock_soar_cases(tenant_id,connector_id,external_id),
 FOREIGN KEY(tenant_id,investigation_id) REFERENCES investigations(tenant_id,id)
);
