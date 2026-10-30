CREATE TABLE auth_events (
 tenant_id VARCHAR NOT NULL, connector_id VARCHAR NOT NULL, source VARCHAR NOT NULL,
 event_key VARCHAR NOT NULL, event_type VARCHAR NOT NULL, event_time TIMESTAMPTZ NOT NULL,
 principal_ref VARCHAR NOT NULL, asset_ref VARCHAR NOT NULL, source_ip VARCHAR NOT NULL,
 PRIMARY KEY (tenant_id,connector_id,source,event_key)
) ON CONFLICT DO NOTHING;

-- Finite-fixture parity with Go SuspiciousLogins, not a production retention policy.
-- Go validates identity/content and canonicalizes IPs before this boundary.
CREATE MATERIALIZED VIEW login_matches AS
 SELECT s.tenant_id,s.connector_id,s.source,s.event_key AS success_key,
 f.event_key AS failure_key,f.event_time AS failure_time
 FROM auth_events s JOIN auth_events f
 ON s.tenant_id=f.tenant_id AND s.connector_id=f.connector_id AND s.source=f.source
 AND s.principal_ref=f.principal_ref AND s.asset_ref=f.asset_ref AND s.source_ip=f.source_ip
 WHERE s.event_type='authentication.succeeded' AND f.event_type='authentication.failed'
 AND f.event_time<s.event_time AND f.event_time>=s.event_time-INTERVAL '5 minutes';

CREATE MATERIALIZED VIEW login_top_failures AS
 SELECT tenant_id,connector_id,source,success_key,failure_key FROM (
 SELECT *,row_number() OVER (
 PARTITION BY tenant_id,connector_id,source,success_key
 ORDER BY failure_time DESC,failure_key DESC) AS position
 FROM login_matches
 ) ranked WHERE position<=3;

CREATE MATERIALIZED VIEW qualifying_logins AS
 SELECT tenant_id,connector_id,source,success_key FROM login_top_failures
 GROUP BY tenant_id,connector_id,source,success_key HAVING count(*)=3;

CREATE MATERIALIZED VIEW finding_edges AS
 SELECT f.tenant_id,f.connector_id,f.source,f.success_key,f.failure_key
 FROM login_top_failures f JOIN qualifying_logins q
 ON f.tenant_id=q.tenant_id AND f.connector_id=q.connector_id
 AND f.source=q.source AND f.success_key=q.success_key;
