-- name: RetentionPolicy :one
SELECT * FROM retention_policies WHERE tenant_id=$1 AND kind=$2;
-- name: SaveRetentionPolicy :one
INSERT INTO retention_policies(tenant_id,kind,enabled,age_days,updated_by) VALUES($1,$2,$3,$4,$5)
ON CONFLICT(tenant_id,kind) DO UPDATE SET enabled=EXCLUDED.enabled,age_days=EXCLUDED.age_days,updated_by=EXCLUDED.updated_by,updated_at=now(),version=retention_policies.version+1 RETURNING *;
-- name: RetentionRecords :many
SELECT * FROM retention_records WHERE tenant_id=$1 AND kind=$2 AND (recipient_id='' OR recipient_id=$3) ORDER BY touched,id LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);
-- name: RetentionRecord :one
SELECT * FROM retention_records WHERE tenant_id=$1 AND kind=$2 AND id=$3 AND (recipient_id='' OR recipient_id=$4);
-- name: SaveRetentionSnapshot :one
INSERT INTO retention_snapshots(tenant_id,id,kind,resource_id,recipient_id,title,digest,document,actor,reason)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(tenant_id,kind,resource_id,digest) DO UPDATE SET digest=retention_snapshots.digest RETURNING *;
-- name: RetentionSnapshot :one
SELECT * FROM retention_snapshots WHERE tenant_id=$1 AND id=$2 AND (recipient_id='' OR recipient_id=$3);
-- name: RetentionSnapshots :many
SELECT id,kind,resource_id,title,digest,actor,created_at FROM retention_snapshots WHERE tenant_id=$1 AND kind=$2 AND (recipient_id='' OR recipient_id=$3) ORDER BY created_at DESC,id LIMIT 25 OFFSET sqlc.arg(page_offset);
-- name: RetentionNotificationLock :one
SELECT id FROM approval_notifications WHERE tenant_id=$1 AND id=$2 AND recipient_id=$3 FOR UPDATE;
-- name: RetentionNotificationDelete :execrows
DELETE FROM approval_notifications WHERE tenant_id=$1 AND id=$2 AND recipient_id=$3 AND read_at IS NOT NULL AND to_jsonb(approval_notifications)=sqlc.arg(snapshot)::jsonb;
-- name: RetentionNotificationRestore :execrows
INSERT INTO approval_notifications(tenant_id,id,recipient_id,kind,resource_id,connector_id,source,title,event_type,actor_id,owner_id,assignment_version,work_token,created_at,read_at) SELECT r.tenant_id,r.id,r.recipient_id,r.kind,r.resource_id,r.connector_id,r.source,r.title,r.event_type,r.actor_id,r.owner_id,r.assignment_version,r.work_token,r.created_at,r.read_at FROM jsonb_populate_record(NULL::approval_notifications,sqlc.arg(snapshot)::jsonb) r
WHERE r.tenant_id=sqlc.arg(tenant_id)::text AND r.recipient_id=sqlc.arg(recipient_id)::text AND r.read_at IS NOT NULL
ON CONFLICT(tenant_id,id) DO NOTHING;
-- name: RetentionCoordinationLock :exec
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(lock_key)::text,0));

-- name: RetentionSnapshotByDigest :one
SELECT * FROM retention_snapshots WHERE tenant_id=$1 AND kind=$2 AND resource_id=$3 AND digest=$4;
-- name: RetentionSnapshotCount :one
SELECT count(*) FROM retention_snapshots WHERE tenant_id=$1;

-- name: RetentionAudit :exec
INSERT INTO audit_events(tenant_id,id,resource,resource_id,action,details,created_at,updated_at) VALUES($1,$2,'retention',$3,$4,$5,now(),now());
