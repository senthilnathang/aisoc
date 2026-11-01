-- Additive local approval ownership; approval authority stays with existing owners.
CREATE VIEW approval_work_items AS
 SELECT s.tenant_id,s.id,'skill'::text AS kind,coalesce(s.document->>'name',s.id) AS title,
 'review'::text AS stage,s.updated_at,
 NULL::timestamptz AS expires_at,
 NOT aisoc_learning_current(s.tenant_id,s.document) AS source_changed,
 s.document - 'request_hash' AS document
 FROM skills s WHERE s.document->>'origin' IN ('user','environment_generated')
 AND coalesce(s.document->>'archived','false')<>'true' AND coalesce(s.document->>'learning_archived','false')<>'true'
 AND (s.document->>'state'='draft' OR s.document ? 'staged_edit' OR NOT aisoc_learning_current(s.tenant_id,s.document))
 UNION ALL
 SELECT e.tenant_id,e.id,'memory',coalesce(e.document->>'artifact',e.id),'review',e.updated_at,e.valid_until,
 NOT aisoc_learning_current(e.tenant_id,e.document - 'approval_state'),
 (e.document - 'request_hash') || jsonb_build_object('version',e.version,'valid_from',e.valid_from,'valid_until',e.valid_until)
 FROM enterprise_insights e WHERE NOT e.archived
 AND coalesce(e.document->>'learning_archived','false')<>'true'
 AND (e.document->>'approval_state'='pending' OR NOT aisoc_learning_current(e.tenant_id,e.document) OR e.valid_until<=now())
 UNION ALL
 SELECT a.tenant_id,a.id,'respond',coalesce(l.document->>'principal_ref',a.session_id),
 CASE WHEN a.state='approved' AND a.approval_expires_at>now() THEN 'execution' ELSE 'review' END,
 a.created_at,a.approval_expires_at,false,
 l.document || jsonb_build_object('id',a.id,'created_by',a.proposed_by,'approved_by',a.approved_by,'state',a.state,'version',a.expected_version,'connector_id',a.connector_id,'source',a.source,'approval_expires_at',a.approval_expires_at,'stopped',p.stopped,'approval_comment',l.approval_comment)
 FROM sandbox_session_actions a
 JOIN case_sandbox_responses l USING(tenant_id,connector_id,source)
 JOIN sandbox_response_policy p USING(tenant_id,connector_id,source)
 WHERE l.action_id=a.id AND a.state<>'executed';
CREATE TABLE approval_assignments (
 tenant_id text NOT NULL REFERENCES tenants(id),kind text NOT NULL,resource_id text NOT NULL,
 connector_id text NOT NULL DEFAULT '',source text NOT NULL DEFAULT '',
 work_token text NOT NULL,owner_id text NOT NULL DEFAULT '',assigned_by text NOT NULL,
 version integer NOT NULL CHECK(version>0),expires_at timestamptz,
 reason text NOT NULL,request_id text NOT NULL,request_hash text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,kind,resource_id,connector_id,source)
);
CREATE TABLE approval_notifications (
 tenant_id text NOT NULL REFERENCES tenants(id),id text NOT NULL,recipient_id text NOT NULL,
 kind text NOT NULL,resource_id text NOT NULL,connector_id text NOT NULL DEFAULT '',source text NOT NULL DEFAULT '',
 title text NOT NULL,event_type text NOT NULL,actor_id text NOT NULL,owner_id text NOT NULL,
 assignment_version integer NOT NULL,work_token text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz,
 PRIMARY KEY(tenant_id,id)
);
CREATE INDEX approval_notification_recipient ON approval_notifications(tenant_id,recipient_id,created_at DESC,id);
