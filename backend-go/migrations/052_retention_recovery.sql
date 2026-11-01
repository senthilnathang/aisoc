-- Explicit local archive snapshots. Domain evidence and audit rows are retained.
CREATE TABLE retention_policies (
 tenant_id text NOT NULL REFERENCES tenants(id),kind text NOT NULL,
 enabled boolean NOT NULL DEFAULT false,age_days integer NOT NULL CHECK(age_days BETWEEN 1 AND 3650),
 version integer NOT NULL DEFAULT 1,updated_by text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,kind)
);
CREATE TABLE retention_snapshots (
 tenant_id text NOT NULL REFERENCES tenants(id),id text NOT NULL,kind text NOT NULL,resource_id text NOT NULL,
 recipient_id text NOT NULL DEFAULT '',title text NOT NULL,digest text NOT NULL,
 document jsonb NOT NULL,actor text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,kind,resource_id,digest)
);
CREATE INDEX retention_snapshot_catalog ON retention_snapshots(tenant_id,kind,created_at DESC,id);
CREATE VIEW retention_records AS
 SELECT tenant_id,'detection'::text kind,id,coalesce(document->>'name',id) title,updated_at touched,
 document->>'enabled'='false' eligible,''::text recipient_id,to_jsonb(r) document FROM detection_rules r
 UNION ALL SELECT tenant_id,'investigation',id,title,updated_at,status IN ('resolved','closed') AND NOT EXISTS(SELECT 1 FROM investigation_jobs j WHERE j.tenant_id=r.tenant_id AND j.investigation_id=r.id AND j.status IN ('queued','running','failed')) AND NOT EXISTS(SELECT 1 FROM case_sandbox_responses c JOIN sandbox_session_actions a ON a.tenant_id=c.tenant_id AND a.id=c.action_id AND a.connector_id=c.connector_id AND a.source=c.source WHERE c.tenant_id=r.tenant_id AND c.investigation_id=r.id AND a.state<>'executed'),'',to_jsonb(r) FROM investigations r
 UNION ALL SELECT tenant_id,'response',jsonb_build_array(connector_id,source,id)::text,id,coalesce(executed_at,created_at),state='executed','',to_jsonb(r) FROM sandbox_session_actions r
 UNION ALL SELECT tenant_id,'hunt',id,coalesce(document->>'name',id),updated_at,coalesce(document->>'status'='completed',false),'',to_jsonb(r) FROM hunts r
 UNION ALL SELECT tenant_id,'intel',id,title,updated_at,status='archived','',to_jsonb(r) FROM threat_intel_reports r
 UNION ALL SELECT tenant_id,'skill',id,coalesce(document->>'name',id),updated_at,(document->>'archived'='true' OR document->>'learning_archived'='true') IS TRUE,'',to_jsonb(r) FROM skills r
 UNION ALL SELECT tenant_id,'memory',id,coalesce(document->>'artifact',id),updated_at,archived,'',to_jsonb(r) FROM enterprise_insights r
 UNION ALL SELECT tenant_id,'integration',id,name,updated_at,state='archived','',to_jsonb(r) FROM local_integration_profiles r
 UNION ALL SELECT b.tenant_id,'import_batch',b.id,b.name,
 greatest(b.created_at,coalesce((SELECT max(i.updated_at) FROM local_import_batch_items i WHERE i.tenant_id=b.tenant_id AND i.batch_id=b.id),b.created_at)),
 EXISTS(SELECT 1 FROM local_import_batch_items i WHERE i.tenant_id=b.tenant_id AND i.batch_id=b.id) AND NOT EXISTS(SELECT 1 FROM local_import_batch_items i WHERE i.tenant_id=b.tenant_id AND i.batch_id=b.id AND i.state<>'accepted'),'',
 to_jsonb(b)||jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.case_key) FROM local_import_batch_items i WHERE i.tenant_id=b.tenant_id AND i.batch_id=b.id),'[]'::jsonb)) FROM local_import_batches b
 UNION ALL SELECT tenant_id,'notification',id,title,coalesce(read_at,created_at),read_at IS NOT NULL,recipient_id,to_jsonb(r) FROM approval_notifications r;
