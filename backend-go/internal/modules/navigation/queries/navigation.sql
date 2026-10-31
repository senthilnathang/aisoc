-- name: BreadcrumbLabel :one
SELECT left(COALESCE(NULLIF(title,''),id),160)::text AS label
FROM investigations WHERE tenant_id=sqlc.arg(tenant_id)::text AND id=sqlc.arg(id)::text AND sqlc.arg(resource)::text='investigations'
UNION ALL
SELECT left(COALESCE(NULLIF(document->>'name',''),id),160)::text AS label
FROM detection_rules WHERE tenant_id=sqlc.arg(tenant_id)::text AND id=sqlc.arg(id)::text AND sqlc.arg(resource)::text='detection-rules'
UNION ALL
SELECT left(COALESCE(NULLIF(title,''),id),160)::text AS label
FROM threat_intel_reports WHERE tenant_id=sqlc.arg(tenant_id)::text AND id=sqlc.arg(id)::text AND sqlc.arg(resource)::text='threat-intel'
UNION ALL
SELECT left(COALESCE(NULLIF(document->>'name',''),id),160)::text AS label
FROM skills WHERE tenant_id=sqlc.arg(tenant_id)::text AND id=sqlc.arg(id)::text AND sqlc.arg(resource)::text='skills'
UNION ALL
SELECT left(COALESCE(NULLIF(document->>'name',''),id),160)::text AS label
FROM hunts WHERE tenant_id=sqlc.arg(tenant_id)::text AND id=sqlc.arg(id)::text AND sqlc.arg(resource)::text='hunts'
LIMIT 1;
