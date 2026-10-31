-- name: RecommendationAlerts :many
SELECT a.id,jsonb_build_object('title',COALESCE(a.document->>'title',''),'source',a.source,'investigation_id',COALESCE(a.investigation_id,''),'primary_entity',COALESCE(a.document->'payload'->>'primary_entity',''),'severity',COALESCE(a.document->>'severity','unknown')) AS document,a.created_at,COALESCE(l.label,'unreviewed')::text AS label,COALESCE(l.version,0)::integer AS label_version,
 COALESCE(l.rationale,'')::text AS rationale,COALESCE(l.reviewer,'')::text AS reviewer
FROM alerts a LEFT JOIN detection_alert_labels l ON l.tenant_id=a.tenant_id AND l.alert_id=a.id
WHERE a.tenant_id=sqlc.arg(tenant_id)::text AND a.rule_id=sqlc.arg(rule_id)::text
AND a.created_at>=sqlc.arg(window_start)::timestamptz AND a.created_at<=sqlc.arg(window_end)::timestamptz
ORDER BY a.created_at DESC,a.id COLLATE "C" LIMIT 501;

-- name: RecommendationLabelSummary :one
SELECT count(*)::integer AS alerts,
 count(*) FILTER(WHERE l.label='false_positive')::integer AS false_positives,
 count(*) FILTER(WHERE l.label='true_positive')::integer AS true_positives
FROM alerts a LEFT JOIN detection_alert_labels l ON l.tenant_id=a.tenant_id AND l.alert_id=a.id
WHERE a.tenant_id=sqlc.arg(tenant_id)::text AND a.rule_id=sqlc.arg(rule_id)::text
AND a.created_at>=sqlc.arg(window_start)::timestamptz AND a.created_at<=sqlc.arg(window_end)::timestamptz;

-- name: SaveRecommendationLabel :one
INSERT INTO detection_alert_labels(tenant_id,alert_id,rule_id,label,rationale,reviewer,version,updated_at)
SELECT a.tenant_id,a.id,a.rule_id,sqlc.arg(label)::text,sqlc.arg(rationale)::text,sqlc.arg(reviewer)::text,1,now()
FROM alerts a WHERE a.tenant_id=sqlc.arg(tenant_id)::text AND a.rule_id=sqlc.arg(rule_id)::text AND a.id=sqlc.arg(alert_id)::text
AND (sqlc.arg(expected_version)::integer=0 OR EXISTS(SELECT 1 FROM detection_alert_labels l WHERE l.tenant_id=a.tenant_id AND l.alert_id=a.id))
ON CONFLICT(tenant_id,alert_id) DO UPDATE SET label=EXCLUDED.label,rationale=EXCLUDED.rationale,reviewer=EXCLUDED.reviewer,version=detection_alert_labels.version+1,updated_at=now()
WHERE detection_alert_labels.version=sqlc.arg(expected_version)::integer
RETURNING version;

-- name: InsertRecommendation :execrows
INSERT INTO detection_rule_recommendations(tenant_id,id,rule_id,base_version,base_query,proposed_query,title,rationale,sample,sample_hash,window_start,window_end,created_by,created_at,updated_at)
VALUES(sqlc.arg(tenant_id),sqlc.arg(id),sqlc.arg(rule_id),sqlc.arg(base_version),sqlc.arg(base_query),sqlc.arg(proposed_query),sqlc.arg(title),sqlc.arg(rationale),sqlc.arg(sample),sqlc.arg(sample_hash),sqlc.arg(window_start),sqlc.arg(window_end),sqlc.arg(created_by),now(),now()) ON CONFLICT(tenant_id,rule_id,base_version,sample_hash,proposed_query) DO NOTHING;

-- name: ListRecommendations :one
SELECT COALESCE(jsonb_agg(to_jsonb(r)-'tenant_id'-'sample' ORDER BY created_at DESC,id),'[]'::jsonb)::jsonb AS items FROM
(SELECT * FROM detection_rule_recommendations WHERE tenant_id=sqlc.arg(tenant_id)::text AND rule_id=sqlc.arg(rule_id)::text ORDER BY created_at DESC,id LIMIT 30) r;

-- name: LockRecommendation :one
SELECT * FROM detection_rule_recommendations WHERE tenant_id=sqlc.arg(tenant_id) AND rule_id=sqlc.arg(rule_id) AND id=sqlc.arg(id) FOR UPDATE;

-- name: UpdateRecommendationReceipt :exec
UPDATE detection_rule_recommendations SET validation=sqlc.arg(validation),test_result=sqlc.arg(test_result),tested_at=sqlc.narg(tested_at),updated_at=now()
WHERE tenant_id=sqlc.arg(tenant_id) AND id=sqlc.arg(id);

-- name: SetRecommendationStatus :exec
UPDATE detection_rule_recommendations SET status=sqlc.arg(status),updated_at=now() WHERE tenant_id=sqlc.arg(tenant_id) AND id=sqlc.arg(id);

-- name: ApplyRecommendationRule :exec
UPDATE detection_rules SET document=sqlc.arg(document),version=sqlc.arg(version),updated_at=now() WHERE tenant_id=sqlc.arg(tenant_id) AND id=sqlc.arg(id);
