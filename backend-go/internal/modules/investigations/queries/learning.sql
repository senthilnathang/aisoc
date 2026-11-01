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
-- name: LifecycleSkill :one
SELECT document FROM skills WHERE tenant_id=$1 AND id=$2;
-- name: LockLifecycleSkill :one
SELECT document FROM skills WHERE tenant_id=$1 AND id=$2 FOR UPDATE;
-- name: LifecycleInsight :one
SELECT (document || jsonb_build_object('version',version,'archived',archived,'valid_until',valid_until))::jsonb AS document FROM enterprise_insights WHERE tenant_id=$1 AND id=$2;
-- name: LockLifecycleInsight :one
SELECT (document || jsonb_build_object('version',version,'archived',archived,'valid_until',valid_until))::jsonb AS document FROM enterprise_insights WHERE tenant_id=$1 AND id=$2 FOR UPDATE;
-- name: SaveLifecycleSkill :exec
UPDATE skills SET document=$3,tags_search=($3::jsonb->'tags')::text,updated_at=now() WHERE tenant_id=$1 AND id=$2;
-- name: SaveLifecycleInsight :exec
UPDATE enterprise_insights SET document=$3,version=version+1,archived=sqlc.arg(archived)::boolean,updated_at=now() WHERE tenant_id=$1 AND id=$2;
-- name: LifecycleCurrent :one
SELECT aisoc_learning_current(sqlc.arg(tenant_id)::text,sqlc.arg(document)::jsonb)::boolean AS current;
-- name: ReleasedMaterials :many
SELECT document FROM skill_materials WHERE tenant_id=$1 AND skill_id=$2 AND document->>'archived_at' IS NULL ORDER BY id;
-- name: ArchiveDraftMaterials :exec
UPDATE skill_materials SET document=document || jsonb_build_object('archived_at',now()::text) WHERE tenant_id=$1 AND skill_id=$2 AND NOT(id=ANY(sqlc.arg(retained)::text[]));
-- name: RestoreReleasedMaterial :exec
WITH restored AS (
 UPDATE skill_materials SET document=sqlc.arg(snapshot)::jsonb || jsonb_build_object('version',(document->>'version')::int+1,'archived_at',NULL,'updated_at',now()::text)
 WHERE tenant_id=sqlc.arg(tenant_id) AND skill_id=sqlc.arg(skill_id) AND id=sqlc.arg(id) RETURNING document
) INSERT INTO skill_material_versions(tenant_id,material_id,version,snapshot,created_by,created_at)
SELECT sqlc.arg(tenant_id),sqlc.arg(id),(document->>'version')::int,document,sqlc.arg(actor),now() FROM restored;
