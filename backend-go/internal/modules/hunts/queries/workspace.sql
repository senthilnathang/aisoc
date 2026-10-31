-- name: LockHunt :one
SELECT document FROM hunts WHERE tenant_id=$1 AND id=$2 FOR UPDATE;
-- name: HuntRuns :many
SELECT document FROM hunt_search_runs WHERE tenant_id=$1 AND hunt_id=$2 ORDER BY created_at DESC,id DESC LIMIT 20;
-- name: HuntRun :one
SELECT document FROM hunt_search_runs WHERE tenant_id=$1 AND hunt_id=$2 AND id=$3;
-- name: InsertHuntRun :exec
INSERT INTO hunt_search_runs(tenant_id,hunt_id,id,document) VALUES($1,$2,$3,$4);
-- name: HuntRunCount :one
SELECT count(*) FROM hunt_search_runs WHERE tenant_id=$1 AND hunt_id=$2;
-- name: HuntNotes :many
SELECT id,actor,body,created_at FROM hunt_notes WHERE tenant_id=$1 AND hunt_id=$2 ORDER BY created_at,id LIMIT 100;
-- name: HuntNote :one
SELECT actor,body FROM hunt_notes WHERE tenant_id=$1 AND hunt_id=$2 AND id=$3;
-- name: HuntNoteCount :one
SELECT count(*) FROM hunt_notes WHERE tenant_id=$1 AND hunt_id=$2;
-- name: InsertHuntNote :exec
INSERT INTO hunt_notes(tenant_id,hunt_id,id,actor,body) VALUES($1,$2,$3,$4,$5);
-- name: HuntEvidence :many
WITH recent_cases AS (
 SELECT id,title,summary,source,primary_entity FROM investigations i WHERE i.tenant_id=$1 ORDER BY updated_at DESC,id LIMIT 500
), recent_artifacts AS (
 SELECT id,investigation_id,document FROM case_records a WHERE a.tenant_id=$1 AND a.kind='artifacts' ORDER BY updated_at DESC,ordinal DESC LIMIT 500
), candidates AS (
 SELECT id AS record_id,id AS case_id,'case'::text AS kind,left(title,200)::text AS label, left(summary,2000)::text AS excerpt,source,left(primary_entity,500)::text AS entity,
 concat_ws(' ',title,summary,source,primary_entity) AS searchable FROM recent_cases
 UNION ALL
 SELECT id,investigation_id,'artifact',left(COALESCE(document->>'label',document->>'type','Artifact'),200),left(COALESCE(document->>'value',''),2000),'Stored case artifact',left(COALESCE(document->>'value',''),500),concat_ws(' ',document->>'label',document->>'type',document->>'value') FROM recent_artifacts
)
SELECT record_id,case_id,kind,label,excerpt,source,entity FROM candidates WHERE strpos(lower(searchable),lower($2::text))>0 ORDER BY kind,record_id LIMIT 101;
-- name: HuntDocument :one
SELECT document FROM hunts WHERE tenant_id=$1 AND id=$2;
