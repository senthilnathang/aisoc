-- name: RegistryReports :many
SELECT (to_jsonb(r) || jsonb_build_object('indicator_count_actual',(SELECT count(*) FROM threat_indicators i WHERE i.tenant_id=r.tenant_id AND i.report_id=r.id),'linked_hunts',(SELECT count(*) FROM threat_report_hunts h WHERE h.tenant_id=r.tenant_id AND h.report_id=r.id)))::jsonb AS document
FROM threat_intel_reports r WHERE r.tenant_id=$1 AND ($2::text='' OR strpos(lower(concat_ws(' ',r.title,r.summary,r.source,r.threat_actor,r.targeted_industry,r.targeted_region)),lower($2))>0)
AND (NOT $3::boolean OR r.relevant) AND ($4::text='' OR r.status=$4)
ORDER BY r.published_at DESC,r.id LIMIT $5 OFFSET $6;
-- name: RegistryCounts :one
SELECT count(*) AS reports,count(DISTINCT r.source) AS sources FROM threat_intel_reports r WHERE r.tenant_id=$1 AND ($2::text='' OR strpos(lower(concat_ws(' ',r.title,r.summary,r.source,r.threat_actor,r.targeted_industry,r.targeted_region)),lower($2))>0) AND (NOT $3::boolean OR r.relevant) AND ($4::text='' OR r.status=$4);
-- name: ReportHuntLinks :many
SELECT l.request_id,l.hunt_id,l.indicator_id,l.indicator_value,l.actor,l.created_at,EXISTS(SELECT 1 FROM hunts h WHERE h.tenant_id=l.tenant_id AND h.id=l.hunt_id) AS available FROM threat_report_hunts l WHERE l.tenant_id=$1 AND l.report_id=$2 ORDER BY l.created_at DESC,l.request_id LIMIT 100;
-- name: ReportHuntLink :one
SELECT l.hunt_id,l.indicator_id,l.indicator_value,l.actor,EXISTS(SELECT 1 FROM hunts h WHERE h.tenant_id=l.tenant_id AND h.id=l.hunt_id) AS available FROM threat_report_hunts l WHERE l.tenant_id=$1 AND l.report_id=$2 AND l.request_id=$3;
-- name: InsertReportHuntLink :exec
INSERT INTO threat_report_hunts(tenant_id,report_id,request_id,hunt_id,indicator_id,indicator_value,actor) VALUES($1,$2,$3,$4,$5,$6,$7);
-- name: InsertLinkedHunt :exec
INSERT INTO hunts(tenant_id,id,document,updated_at) VALUES($1,$2,$3,$4);
-- name: ReportIndicatorCount :one
SELECT count(*) FROM threat_indicators WHERE tenant_id=$1 AND report_id=$2;
