CREATE TABLE investigation_evidence_messages (
 tenant_id text NOT NULL,investigation_id text NOT NULL,actor_id text NOT NULL,id text NOT NULL,
 question text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,investigation_id,actor_id,id),
 FOREIGN KEY(tenant_id,investigation_id) REFERENCES investigations(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX investigation_evidence_messages_order ON investigation_evidence_messages(tenant_id,investigation_id,actor_id,created_at DESC,id);
