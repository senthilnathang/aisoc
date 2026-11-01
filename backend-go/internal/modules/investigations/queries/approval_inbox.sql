-- name: ApprovalInbox :one
-- Read-only projection of existing owners. No independent approval state is stored here.
WITH candidates AS (
 SELECT w.*,(SELECT i.updated_at::text FROM investigations i WHERE i.tenant_id=w.tenant_id AND i.id=w.document#>>'{learning_origin,source_case,id}') AS source_revision
 FROM approval_work_items w WHERE w.tenant_id=sqlc.arg(tenant_id)
), filtered AS (
 SELECT c.*,jsonb_build_object('version',coalesce(a.version,0),'owner_id',coalesce(a.owner_id,''),'work_token',coalesce(a.work_token,''),'expires_at',a.expires_at,'assigned_by',a.assigned_by,'reason',a.reason) AS assignment
 FROM candidates c LEFT JOIN approval_assignments a ON a.tenant_id=c.tenant_id AND a.kind=c.kind AND a.resource_id=c.id AND a.connector_id=coalesce(c.document->>'connector_id','') AND a.source=coalesce(c.document->>'source','') WHERE (sqlc.arg(kind)::text='all' OR c.kind=sqlc.arg(kind))
 AND (sqlc.arg(stage)::text='all' OR c.stage=sqlc.arg(stage))
 AND (sqlc.arg(search)::text='' OR strpos(lower(c.title||' '||c.id),lower(sqlc.arg(search)))>0)
), page AS (SELECT * FROM filtered ORDER BY updated_at DESC,kind,id,document->>'connector_id',document->>'source' LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset))
SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(page ORDER BY updated_at DESC,kind,id,document->>'connector_id',document->>'source') FROM page),'[]'::jsonb),
 'total',(SELECT count(*) FROM filtered),'as_of',now(),
 'counts',jsonb_build_object('review',(SELECT count(*) FROM candidates WHERE stage='review'),'execution',(SELECT count(*) FROM candidates WHERE stage='execution')));
