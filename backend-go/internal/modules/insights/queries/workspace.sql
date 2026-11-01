-- name: Registry :one
WITH filtered AS (
 SELECT (e.document - 'request_hash') || jsonb_build_object('id',e.id,'version',e.version,'archived',e.archived,'valid_from',e.valid_from,'valid_until',e.valid_until,'created_at',e.created_at,'updated_at',e.updated_at,
 'learning_current',aisoc_learning_current(e.tenant_id,e.document),'active_now',aisoc_learning_current(e.tenant_id,e.document) AND NOT e.archived AND (e.valid_from IS NULL OR e.valid_from<=now()) AND (e.valid_until IS NULL OR e.valid_until>now()),
 'uses_30d',(SELECT count(DISTINCT a.investigation_id) FROM enterprise_insight_applications a WHERE a.tenant_id=e.tenant_id AND a.insight_id=e.id AND a.applied_at>=now()-interval '30 days'),
 'last_used',(SELECT max(a.applied_at) FROM enterprise_insight_applications a WHERE a.tenant_id=e.tenant_id AND a.insight_id=e.id)) AS doc,e.updated_at,e.id
 FROM enterprise_insights e WHERE e.tenant_id=sqlc.arg(tenant_id) AND NOT e.archived
 AND (sqlc.arg(search)::text='' OR strpos(lower(e.document::text),lower(sqlc.arg(search)))>0)
), page AS (SELECT * FROM filtered ORDER BY updated_at DESC,id LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset))
SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(doc ORDER BY updated_at DESC,id) FROM page),'[]'::jsonb),'total',(SELECT count(*) FROM filtered));

-- name: Summary :one
SELECT jsonb_build_object(
 'total',(SELECT count(*) FROM enterprise_insights e WHERE e.tenant_id=sqlc.arg(tenant_id) AND NOT archived),
 'types',COALESCE((SELECT jsonb_agg(x) FROM (SELECT document->>'kind' AS kind,count(*) AS count FROM enterprise_insights e WHERE e.tenant_id=sqlc.arg(tenant_id) AND NOT archived GROUP BY document->>'kind') x),'[]'::jsonb),
 'investigations_30d',(SELECT count(DISTINCT investigation_id) FROM enterprise_insight_applications a WHERE a.tenant_id=sqlc.arg(tenant_id) AND applied_at>=now()-interval '30 days'),
 'daily',COALESCE((SELECT jsonb_agg(x ORDER BY day) FROM (SELECT to_char(applied_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,count(DISTINCT investigation_id) AS count FROM enterprise_insight_applications a WHERE a.tenant_id=sqlc.arg(tenant_id) AND applied_at>=now()-interval '30 days' GROUP BY day) x),'[]'::jsonb));

-- name: ContextCards :one
WITH grouped AS (
 SELECT lower(btrim(primary_entity)) AS artifact_key,min(primary_entity) AS artifact,count(*) AS cases,
 count(*) FILTER (WHERE determination='benign') AS benign,count(*) FILTER (WHERE determination='malicious') AS malicious,count(*) FILTER (WHERE determination='suspicious') AS suspicious,
 min(created_at) AS first_seen,max(created_at) AS last_seen,(array_agg(id ORDER BY created_at DESC,id))[1:5] AS case_ids
 FROM investigations i WHERE i.tenant_id=sqlc.arg(tenant_id) AND primary_entity<>'' AND length(primary_entity)<=300 AND created_at>=now()-interval '30 days'
 AND (NOT sqlc.arg(reviewed)::boolean OR (status IN ('closed','resolved') AND determination IN ('benign','malicious','suspicious','mitigated')))
 AND (sqlc.arg(search)::text='' OR strpos(lower(primary_entity),lower(sqlc.arg(search)))>0)
 GROUP BY lower(btrim(primary_entity))
), filtered AS (SELECT * FROM grouped g WHERE artifact_key<>'' AND (NOT sqlc.arg(reviewed)::boolean OR (cases>=2 AND NOT EXISTS(SELECT 1 FROM enterprise_insights e WHERE e.tenant_id=sqlc.arg(tenant_id) AND NOT e.archived AND e.artifact_key=g.artifact_key)))),
page AS (SELECT * FROM filtered ORDER BY cases DESC,artifact_key LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset))
SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(page ORDER BY cases DESC,artifact_key) FROM page),'[]'::jsonb),'total',(SELECT count(*) FROM filtered));

-- name: GetInsight :one
SELECT * FROM enterprise_insights WHERE tenant_id=$1 AND id=$2 FOR UPDATE;

-- name: InsertInsight :exec
INSERT INTO enterprise_insights(tenant_id,id,document,artifact_key,valid_from,valid_until) VALUES($1,$2,$3,$4,$5,$6);

-- name: UpdateInsight :exec
UPDATE enterprise_insights SET document=$3,artifact_key=$4,valid_from=$5,valid_until=$6,archived=$7,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2;

-- name: MatchingInsights :many
SELECT * FROM enterprise_insights WHERE tenant_id=sqlc.arg(tenant_id) AND artifact_key=ANY(sqlc.arg(entities)::text[]) AND NOT archived AND aisoc_learning_current(tenant_id,document) AND (valid_from IS NULL OR valid_from<=now()) AND (valid_until IS NULL OR valid_until>now()) ORDER BY id FOR SHARE;

-- name: InsertApplication :execrows
INSERT INTO enterprise_insight_applications(tenant_id,insight_id,investigation_id,insight_version,snapshot) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING;

-- name: InsightAudit :exec
INSERT INTO audit_events(tenant_id,id,resource,resource_id,action,details,created_at,updated_at) VALUES($1,$2,'enterprise_insights',$3,$4,$5,now(),now());

-- name: InsightStep :exec
INSERT INTO investigation_steps(tenant_id,id,investigation_id,document,created_at) VALUES($1,$2,$3,$4,now());

-- name: Journal :one
WITH filtered AS (SELECT id,resource_id,action,details,created_at FROM audit_events WHERE tenant_id=sqlc.arg(tenant_id) AND resource='enterprise_insights' AND (sqlc.arg(search)::text='' OR strpos(lower(details::text),lower(sqlc.arg(search)))>0)),
page AS (SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset))
SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(page ORDER BY created_at DESC,id) FROM page),'[]'::jsonb),'total',(SELECT count(*) FROM filtered));

-- name: Uses :one
SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(x ORDER BY applied_at DESC) FROM (SELECT a.investigation_id,a.insight_version,a.snapshot,a.applied_at,i.title FROM enterprise_insight_applications a JOIN investigations i ON i.tenant_id=a.tenant_id AND i.id=a.investigation_id WHERE a.tenant_id=sqlc.arg(tenant_id) AND a.insight_id=sqlc.arg(insight_id) ORDER BY a.applied_at DESC LIMIT 100) x),'[]'::jsonb));

-- name: EnsureTenant :exec
INSERT INTO tenants(id) VALUES($1) ON CONFLICT DO NOTHING;
-- name: LockTenant :exec
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(lock_key)::text,0));
-- name: ReviewedCount :one
SELECT count(*) FROM investigations WHERE tenant_id=$1 AND lower(btrim(primary_entity))=$2 AND created_at>=now()-interval '30 days' AND status IN ('closed','resolved') AND determination IN ('benign','suspicious','malicious','mitigated');
-- name: ExistingArtifact :one
SELECT count(*) FROM enterprise_insights WHERE tenant_id=$1 AND artifact_key=$2 AND NOT archived;
