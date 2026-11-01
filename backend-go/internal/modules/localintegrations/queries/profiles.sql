-- name: LockTenant :one
SELECT id FROM tenants WHERE id=$1 FOR UPDATE;
-- name: GetProfile :one
SELECT * FROM local_integration_profiles WHERE tenant_id=$1 AND id=$2;
-- name: LockProfile :one
SELECT * FROM local_integration_profiles WHERE tenant_id=$1 AND id=$2 FOR UPDATE;
-- name: ListProfiles :many
SELECT * FROM local_integration_profiles WHERE tenant_id=$1 ORDER BY updated_at DESC,id LIMIT 200;
-- name: CountProfiles :one
SELECT count(*) FROM local_integration_profiles WHERE tenant_id=$1;
-- name: InsertProfile :one
INSERT INTO local_integration_profiles(tenant_id,id,scope_id,name,document,actor) VALUES($1,$2,$3,$4,$5,$6) RETURNING *;
-- name: UpdateProfile :one
UPDATE local_integration_profiles SET name=$3,document=$4,actor=$5,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *;
-- name: SealProfile :one
UPDATE local_integration_profiles SET state='sealed',updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *;
-- name: AuditProfile :exec
INSERT INTO audit_events(tenant_id,id,resource,resource_id,action,details,created_at,updated_at) VALUES($1,$2,'local_integrations',$3,$4,$5,now(),now());
-- name: ReadyProfiles :many
SELECT p.* FROM local_integration_profiles p
LEFT JOIN stream_worker_status w ON w.tenant_id=p.tenant_id AND w.connector_id=p.id AND w.source='qradar-siem' AND w.processor='build-login-v1' AND w.worker_id='build-worker'
WHERE p.state='sealed' AND EXISTS(SELECT 1 FROM jsonb_to_recordset(sqlc.arg(grants)::jsonb) AS g(tenant_id text,scope_id text) WHERE g.tenant_id=p.tenant_id AND g.scope_id=p.scope_id) AND NOT EXISTS(
 SELECT 1 FROM stream_findings f JOIN l1_escalations e ON e.tenant_id=f.tenant_id AND e.investigation_id=f.investigation_id
 WHERE f.tenant_id=p.tenant_id AND f.connector_id=p.id AND (e.state='synced' OR (e.review_required AND e.reviewed_by IS NULL)))
ORDER BY w.last_seen ASC NULLS FIRST,p.created_at,p.id LIMIT 10;
-- name: EnsureTenant :exec
INSERT INTO tenants(id) VALUES($1) ON CONFLICT DO NOTHING;

-- name: ArchiveProfile :one
UPDATE local_integration_profiles SET state='archived',version=version+1,actor=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *;
-- name: CanArchiveProfile :one
SELECT EXISTS(SELECT 1 FROM stream_findings f JOIN l1_escalations e ON e.tenant_id=f.tenant_id AND e.investigation_id=f.investigation_id WHERE f.tenant_id=$1 AND f.connector_id=$2 AND e.state='synced')
 AND NOT EXISTS(SELECT 1 FROM stream_findings f LEFT JOIN l1_escalations e ON e.tenant_id=f.tenant_id AND e.investigation_id=f.investigation_id WHERE f.tenant_id=$1 AND f.connector_id=$2 AND (e.state IS NULL OR e.state<>'synced')) AS allowed;
-- name: InsertClone :one
INSERT INTO local_integration_profiles(tenant_id,id,scope_id,name,document,actor,cloned_from,cloned_version,clone_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$4) RETURNING *;
-- name: ProfileHistory :many
SELECT version,name,state,actor,recorded_at FROM local_integration_revisions WHERE tenant_id=$1 AND profile_id=$2 ORDER BY version DESC LIMIT 50;
-- name: ProfileIntakeStatus :one
SELECT (SELECT count(*) FROM stream_events ev WHERE ev.tenant_id=$1 AND ev.connector_id=$2 AND ev.source='qradar-siem') AS accepted_events,
 (SELECT count(*) FROM stream_inbox i WHERE i.tenant_id=$1 AND i.connector_id=$2 AND i.source='qradar-siem' AND i.processor='build-login-v1') AS processed_events;
-- name: ProfileSnapshotReady :one
SELECT (SELECT count(*) FROM stream_events ev WHERE ev.tenant_id=p.tenant_id AND ev.connector_id=p.id AND ev.source='qradar-siem')=jsonb_array_length(p.document->'events')
 AND (SELECT count(*) FROM stream_inbox i WHERE i.tenant_id=p.tenant_id AND i.connector_id=p.id AND i.source='qradar-siem' AND i.processor='build-login-v1')=jsonb_array_length(p.document->'events') AS ready
 FROM local_integration_profiles p WHERE p.tenant_id=$1 AND p.id=$2;
