-- Sandbox-only SOAR replica and note effects. No live provider configuration.
CREATE TABLE mock_soar_cases (
 tenant_id text NOT NULL REFERENCES tenants(id), connector_id text NOT NULL,
 external_id text NOT NULL, version text NOT NULL, previous_version text NOT NULL DEFAULT '', status text NOT NULL,
 owner text NOT NULL, analyst_note text NOT NULL DEFAULT '',
 PRIMARY KEY(tenant_id,connector_id,external_id),
 CHECK(length(connector_id) BETWEEN 1 AND 128),
 CHECK(length(external_id) BETWEEN 1 AND 128),
 CHECK(length(version) BETWEEN 1 AND 128),
 CHECK(status IN ('open','closed','reopened')),
 CHECK(octet_length(owner)<=256 AND octet_length(analyst_note)<=4096)
);
CREATE TABLE l1_escalations (
 tenant_id text NOT NULL, job_id uuid NOT NULL, investigation_id text NOT NULL,
 connector_id text NOT NULL, external_id text NOT NULL,
 initial_version text NOT NULL, expected_version text NOT NULL,
 output_hash bytea NOT NULL CHECK(octet_length(output_hash)=32),
 note_body text NOT NULL CHECK(octet_length(note_body)<=8192),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','conflict','synced')),
 note_id text, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,job_id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES jobs(tenant_id,id),
 FOREIGN KEY(tenant_id,investigation_id) REFERENCES investigations(tenant_id,id),
 FOREIGN KEY(tenant_id,connector_id,external_id) REFERENCES mock_soar_cases(tenant_id,connector_id,external_id),
 CHECK((state='synced')=(note_id IS NOT NULL))
);
CREATE TABLE mock_soar_notes (
 tenant_id text NOT NULL, connector_id text NOT NULL, external_id text NOT NULL,
 id text NOT NULL, origin text NOT NULL CHECK(origin='aisoc-mock-l1'),
 job_id uuid NOT NULL, body text NOT NULL CHECK(octet_length(body)<=8192),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,connector_id,external_id,id),
 UNIQUE(tenant_id,job_id),
 FOREIGN KEY(tenant_id,connector_id,external_id) REFERENCES mock_soar_cases(tenant_id,connector_id,external_id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES l1_escalations(tenant_id,job_id)
);
