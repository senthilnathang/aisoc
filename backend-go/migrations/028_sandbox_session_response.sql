-- Sandbox-only identity response state. No external IAM credentials or execution.
CREATE TABLE sandbox_response_policy (
 tenant_id text NOT NULL REFERENCES tenants(id),connector_id text NOT NULL,source text NOT NULL,
 stopped boolean NOT NULL DEFAULT true,
 PRIMARY KEY(tenant_id,connector_id,source)
);
CREATE TABLE sandbox_sessions (
 tenant_id text NOT NULL,connector_id text NOT NULL,source text NOT NULL,id text NOT NULL,
 principal_ref text NOT NULL,version bigint NOT NULL DEFAULT 1,
 revoked boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,connector_id,source,id),
 FOREIGN KEY(tenant_id,connector_id,source) REFERENCES sandbox_response_policy(tenant_id,connector_id,source)
);
CREATE TABLE sandbox_session_actions (
 tenant_id text NOT NULL,connector_id text NOT NULL,source text NOT NULL,id text NOT NULL,
 session_id text NOT NULL,expected_version bigint NOT NULL CHECK(expected_version>0),ticket text NOT NULL,
 state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','approved','executed')),
 approved_by text,approval_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),executed_at timestamptz,
 PRIMARY KEY(tenant_id,connector_id,source,id),
 FOREIGN KEY(tenant_id,connector_id,source,session_id) REFERENCES sandbox_sessions(tenant_id,connector_id,source,id)
);
