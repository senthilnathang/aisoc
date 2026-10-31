-- name: Config :one
SELECT version,document,updated_by,updated_at FROM detection_routing_configs WHERE tenant_id=$1;
-- name: LockTenant :one
SELECT id FROM tenants WHERE id=$1 FOR UPDATE;
-- name: SaveConfig :exec
INSERT INTO detection_routing_configs(tenant_id,version,document,updated_by) VALUES($1,$2,$3,$4)
ON CONFLICT(tenant_id) DO UPDATE SET version=EXCLUDED.version,document=EXCLUDED.document,updated_by=EXCLUDED.updated_by,updated_at=now();
-- name: Sample :many
SELECT a.id,a.source,a.external_id,a.rule_id,COALESCE(a.document->>'severity','unknown')::text AS severity,
 COALESCE(a.document->'payload'->>'primary_entity','')::text AS entity,
 COALESCE(r.document->>'routing','Investigate')::text AS fallback,
 COALESCE((r.document->>'enabled')::boolean,false)::boolean AS enabled
FROM alerts a JOIN detection_rules r ON r.tenant_id=a.tenant_id AND r.id=a.rule_id
WHERE a.tenant_id=$1 AND a.created_at<=sqlc.arg(window_end)::timestamptz
ORDER BY a.created_at DESC,a.id COLLATE "C" LIMIT 500;
-- name: SavePreview :exec
INSERT INTO detection_routing_previews(tenant_id,id,base_version,document,sample_hash,window_end) VALUES($1,$2,$3,$4,$5,$6);
-- name: Preview :one
SELECT * FROM detection_routing_previews WHERE tenant_id=$1 AND id=$2;
-- name: PrunePreviews :exec
DELETE FROM detection_routing_previews WHERE tenant_id=$1 AND created_at<now()-interval '24 hours';
-- name: Audit :one
SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY created_at DESC,id),'[]'::jsonb)::jsonb AS items FROM
(SELECT id,action,details-'before'-'after' AS details,created_at FROM audit_events WHERE tenant_id=$1 AND resource='detection_routing' ORDER BY created_at DESC,id LIMIT 100) a;
-- name: EnsureTenant :exec
INSERT INTO tenants(id) VALUES($1) ON CONFLICT DO NOTHING;
