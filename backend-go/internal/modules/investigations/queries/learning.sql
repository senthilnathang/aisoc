-- name: LearningCase :one
SELECT id,title,summary,source,category,severity,status,determination,primary_entity,updated_at FROM investigations WHERE tenant_id=$1 AND id=$2 FOR UPDATE;
-- name: LearningArtifacts :many
SELECT id,document FROM case_records WHERE tenant_id=$1 AND investigation_id=$2 AND kind='artifacts' ORDER BY created_at DESC,id LIMIT 100;
-- name: LearningEvidence :one
SELECT document FROM case_records WHERE tenant_id=$1 AND investigation_id=$2 AND id=$3 AND kind='artifacts' FOR SHARE;
-- name: LearningReceipts :many
SELECT document FROM case_learning WHERE tenant_id=$1 AND investigation_id=$2 ORDER BY created_at DESC LIMIT 50;
-- name: LearningReceipt :one
SELECT request_hash,document FROM case_learning WHERE tenant_id=$1 AND investigation_id=$2 AND source_version=$3;
-- name: InsertLearning :exec
INSERT INTO case_learning(tenant_id,investigation_id,source_version,request_hash,document) VALUES($1,$2,$3,$4,$5);
-- name: AttachSkillLearning :exec
UPDATE skills SET document=document || jsonb_build_object('learning_origin',sqlc.arg(provenance)::jsonb) WHERE tenant_id=sqlc.arg(tenant_id) AND id=sqlc.arg(id);
-- name: AttachInsightLearning :exec
UPDATE enterprise_insights SET document=document || jsonb_build_object('learning_origin',sqlc.arg(provenance)::jsonb) WHERE tenant_id=sqlc.arg(tenant_id) AND id=sqlc.arg(id);
