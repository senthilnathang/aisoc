CREATE TABLE detection_coverage_assessments (
 tenant_id text NOT NULL REFERENCES tenants(id),
 technique_id text NOT NULL,
 reference_version text NOT NULL,
 state text NOT NULL CHECK (state IN ('unassessed','gap','covered','accepted_risk','alternative_control','not_applicable')),
 evidence_ref text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '',
 rule_id text NOT NULL DEFAULT '',
 rule_version integer NOT NULL DEFAULT 0,
 reviewer text NOT NULL,
 reviewed_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 version integer NOT NULL CHECK(version>0),
 PRIMARY KEY(tenant_id,reference_version,technique_id)
);
