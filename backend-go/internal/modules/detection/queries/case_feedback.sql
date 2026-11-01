-- name: FeedbackCase :one
SELECT id,title,status,determination FROM investigations WHERE tenant_id=$1 AND id=$2;
-- name: FeedbackAlertCount :one
SELECT count(*) FROM alerts WHERE tenant_id=$1 AND investigation_id=$2;
-- name: FeedbackAlerts :many
SELECT jsonb_build_object('id',a.id,'rule_id',a.rule_id,'rule_name',COALESCE(r.document->>'name',a.rule_id),'rule_version',r.version,'rule_enabled',r.document->'enabled',
 'title',COALESCE(a.document->>'title',''),'source',a.source,'external_id',a.external_id,'created_at',a.created_at,
 'primary_entity',COALESCE(a.document->'payload'->>'primary_entity',''),'summary',left(COALESCE(a.document->'payload'->>'summary',''),2000),
 'severity',COALESCE(a.document->>'severity','unknown'),'label',COALESCE(l.label,'unreviewed'),'label_version',COALESCE(l.version,0),
 'rationale',COALESCE(l.rationale,''),'reviewer',COALESCE(l.reviewer,''),'label_updated_at',l.updated_at) AS document
FROM alerts a JOIN detection_rules r ON r.tenant_id=a.tenant_id AND r.id=a.rule_id
LEFT JOIN detection_alert_labels l ON l.tenant_id=a.tenant_id AND l.alert_id=a.id
WHERE a.tenant_id=sqlc.arg(tenant_id) AND a.investigation_id=sqlc.arg(investigation_id)
ORDER BY a.created_at DESC,a.id LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);
-- name: FeedbackAlertRule :one
SELECT rule_id FROM alerts WHERE tenant_id=$1 AND investigation_id=$2 AND id=$3;
-- name: LockFeedbackAlert :one
SELECT rule_id FROM alerts WHERE tenant_id=$1 AND investigation_id=$2 AND id=$3 FOR SHARE;
