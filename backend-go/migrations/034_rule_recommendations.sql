CREATE TABLE detection_alert_labels (
 tenant_id text NOT NULL, alert_id text NOT NULL, rule_id text NOT NULL,
 label text NOT NULL CHECK(label IN ('true_positive','false_positive','unreviewed')),
 rationale text NOT NULL, reviewer text NOT NULL, version integer NOT NULL CHECK(version>0),updated_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,alert_id),
 FOREIGN KEY(tenant_id,alert_id) REFERENCES alerts(tenant_id,id),
 FOREIGN KEY(tenant_id,rule_id) REFERENCES detection_rules(tenant_id,id)
);
CREATE INDEX detection_labels_rule ON detection_alert_labels(tenant_id,rule_id);
CREATE TABLE detection_rule_recommendations (
 tenant_id text NOT NULL,id text NOT NULL,rule_id text NOT NULL,
 base_version integer NOT NULL,base_query text NOT NULL,proposed_query text NOT NULL,
 title text NOT NULL,rationale text NOT NULL,
 sample jsonb NOT NULL CHECK(jsonb_typeof(sample)='array'),sample_hash text NOT NULL,
 window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','dismissed')),
 validation jsonb, test_result jsonb,tested_at timestamptz,
 created_by text NOT NULL,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,rule_id) REFERENCES detection_rules(tenant_id,id)
);
CREATE INDEX detection_recommendations_rule ON detection_rule_recommendations(tenant_id,rule_id,created_at DESC,id);
CREATE UNIQUE INDEX detection_recommendations_dedup ON detection_rule_recommendations(tenant_id,rule_id,base_version,sample_hash,proposed_query);
