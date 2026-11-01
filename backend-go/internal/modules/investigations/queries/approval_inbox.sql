-- name: ApprovalInbox :one
-- Read-only projection of existing owners. No independent approval state is stored here.
WITH candidates AS (
 SELECT s.id,'skill'::text AS kind,coalesce(s.document->>'name',s.id) AS title,
 'review'::text AS stage,s.updated_at,
 NULL::timestamptz AS expires_at,
 NOT aisoc_learning_current(s.tenant_id,s.document) AS source_changed,
 s.document - 'request_hash' AS document
 FROM skills s WHERE s.tenant_id=sqlc.arg(tenant_id)
 AND s.document->>'origin' IN ('user','environment_generated')
 AND coalesce(s.document->>'archived','false')<>'true' AND coalesce(s.document->>'learning_archived','false')<>'true'
 AND (s.document->>'state'='draft' OR s.document ? 'staged_edit' OR NOT aisoc_learning_current(s.tenant_id,s.document))
 UNION ALL
 SELECT e.id,'memory',coalesce(e.document->>'artifact',e.id),'review',e.updated_at,e.valid_until,
 NOT aisoc_learning_current(e.tenant_id,e.document - 'approval_state'),
 (e.document - 'request_hash') || jsonb_build_object('version',e.version,'valid_from',e.valid_from,'valid_until',e.valid_until)
 FROM enterprise_insights e WHERE e.tenant_id=sqlc.arg(tenant_id) AND NOT e.archived
 AND coalesce(e.document->>'learning_archived','false')<>'true'
 AND (e.document->>'approval_state'='pending' OR NOT aisoc_learning_current(e.tenant_id,e.document) OR e.valid_until<=now())
 UNION ALL
 SELECT a.id,'respond',coalesce(l.document->>'principal_ref',a.session_id),
 CASE WHEN a.state='approved' AND a.approval_expires_at>now() THEN 'execution' ELSE 'review' END,
 a.created_at,a.approval_expires_at,false,
 l.document || jsonb_build_object('id',a.id,'created_by',a.proposed_by,'approved_by',a.approved_by,'state',a.state,'version',a.expected_version,'connector_id',a.connector_id,'source',a.source,'approval_expires_at',a.approval_expires_at,'stopped',p.stopped,'approval_comment',l.approval_comment)
 FROM sandbox_session_actions a
 JOIN case_sandbox_responses l USING(tenant_id,connector_id,source)
 JOIN sandbox_response_policy p USING(tenant_id,connector_id,source)
 WHERE a.tenant_id=sqlc.arg(tenant_id) AND l.action_id=a.id AND a.state<>'executed'
), filtered AS (
 SELECT * FROM candidates WHERE (sqlc.arg(kind)::text='all' OR kind=sqlc.arg(kind))
 AND (sqlc.arg(stage)::text='all' OR stage=sqlc.arg(stage))
 AND (sqlc.arg(search)::text='' OR strpos(lower(title||' '||id),lower(sqlc.arg(search)))>0)
), page AS (SELECT * FROM filtered ORDER BY updated_at DESC,kind,id,document->>'connector_id',document->>'source' LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset))
SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(page ORDER BY updated_at DESC,kind,id,document->>'connector_id',document->>'source') FROM page),'[]'::jsonb),
 'total',(SELECT count(*) FROM filtered),'as_of',now(),
 'counts',jsonb_build_object('review',(SELECT count(*) FROM candidates WHERE stage='review'),'execution',(SELECT count(*) FROM candidates WHERE stage='execution')));
