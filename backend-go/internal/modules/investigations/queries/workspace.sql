-- name: EvidenceMessages :many
SELECT id,question,response,created_at FROM investigation_evidence_messages
WHERE tenant_id=$1 AND investigation_id=$2 AND actor_id=$3 ORDER BY created_at DESC,id LIMIT 50;
-- name: EvidenceMessage :one
SELECT question,response FROM investigation_evidence_messages WHERE tenant_id=$1 AND investigation_id=$2 AND actor_id=$3 AND id=$4;
-- name: InsertEvidenceMessage :exec
INSERT INTO investigation_evidence_messages(tenant_id,investigation_id,actor_id,id,question,response) VALUES($1,$2,$3,$4,$5,$6);
-- name: EvidenceMessageCount :one
SELECT count(*) FROM investigation_evidence_messages WHERE tenant_id=$1 AND investigation_id=$2 AND actor_id=$3;
-- name: LookupRecords :many
SELECT kind,id,document FROM case_records WHERE tenant_id=$1 AND investigation_id=$2 AND kind='artifacts' ORDER BY updated_at DESC,ordinal DESC LIMIT 100;
-- name: LookupSteps :many
SELECT id,document FROM investigation_steps WHERE tenant_id=$1 AND investigation_id=$2 ORDER BY created_at DESC,ordinal DESC LIMIT 100;
-- name: LookupCase :one
SELECT title,summary,source,primary_entity,determination,status FROM investigations WHERE tenant_id=$1 AND id=$2;
