-- name: AssignmentWork :one
SELECT jsonb_build_object('id',w.id,'kind',w.kind,'title',w.title,'stage',w.stage,'expires_at',w.expires_at,'document',w.document,'source_changed',w.source_changed,
 'source_revision',(SELECT i.updated_at::text FROM investigations i WHERE i.tenant_id=w.tenant_id AND i.id=w.document#>>'{learning_origin,source_case,id}'))
FROM approval_work_items w WHERE w.tenant_id=$1 AND w.kind=$2 AND w.id=$3 AND coalesce(w.document->>'connector_id','')=sqlc.arg(connector_id)::text AND coalesce(w.document->>'source','')=sqlc.arg(source)::text;
-- name: LockAssignmentSkill :one
SELECT id FROM skills WHERE tenant_id=$1 AND id=$2 FOR UPDATE;
-- name: LockAssignmentMemory :one
SELECT id FROM enterprise_insights WHERE tenant_id=$1 AND id=$2 FOR UPDATE;
-- name: LockAssignmentResponse :one
SELECT id FROM sandbox_session_actions WHERE tenant_id=$1 AND id=$2 AND connector_id=$3 AND source=$4 FOR UPDATE;
-- name: Assignment :one
SELECT * FROM approval_assignments WHERE tenant_id=$1 AND kind=$2 AND resource_id=$3 AND connector_id=$4 AND source=$5;
-- name: SaveAssignment :one
INSERT INTO approval_assignments(tenant_id,kind,resource_id,connector_id,source,work_token,owner_id,assigned_by,version,expires_at,reason,request_id,request_hash)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$11,$12)
ON CONFLICT(tenant_id,kind,resource_id,connector_id,source) DO UPDATE SET work_token=EXCLUDED.work_token,owner_id=EXCLUDED.owner_id,assigned_by=EXCLUDED.assigned_by,version=approval_assignments.version+1,expires_at=EXCLUDED.expires_at,reason=EXCLUDED.reason,request_id=EXCLUDED.request_id,request_hash=EXCLUDED.request_hash,updated_at=now() RETURNING *;
-- name: NotifyAssignment :exec
INSERT INTO approval_notifications(tenant_id,id,recipient_id,kind,resource_id,connector_id,source,title,event_type,actor_id,owner_id,assignment_version,work_token) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13);
-- name: AssignmentAudit :exec
INSERT INTO audit_events(tenant_id,id,resource,resource_id,action,details,created_at,updated_at) VALUES($1,$2,'approval_assignment',$3,$4,$5,now(),now());
-- name: ApprovalNotifications :one
WITH filtered AS (SELECT * FROM approval_notifications WHERE tenant_id=$1 AND recipient_id=$2), page AS (
 SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset))
SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'kind',p.kind,'resource_id',p.resource_id,'connector_id',p.connector_id,'source',p.source,'title',p.title,'event_type',p.event_type,'actor_id',p.actor_id,'owner_id',p.owner_id,'assignment_version',p.assignment_version,'created_at',p.created_at,'read_at',p.read_at) ORDER BY p.created_at DESC,p.id) FROM page p),'[]'::jsonb),
 'total',(SELECT count(*) FROM filtered),'unread',(SELECT count(*) FROM filtered WHERE read_at IS NULL));
-- name: ReadApprovalNotification :one
UPDATE approval_notifications SET read_at=coalesce(read_at,now()) WHERE tenant_id=$1 AND recipient_id=$2 AND id=$3 RETURNING id;
