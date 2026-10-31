-- name: RegistryWindow :one
WITH matched AS MATERIALIZED (
 SELECT r.id,r.document,r.version,r.updated_at,
 COALESCE(NULLIF(r.document->>'name',''),r.id) AS name,
 CASE WHEN jsonb_typeof(r.document->'mitre_techniques')='array' THEN r.document->'mitre_techniques' ELSE '[]'::jsonb END AS techniques
 FROM detection_rules r WHERE r.tenant_id=sqlc.arg(tenant_id)::text
 AND (sqlc.arg(rule_id)::text='' OR r.id=sqlc.arg(rule_id)::text)
 AND (sqlc.arg(search)::text='' OR strpos(lower(COALESCE(r.document->>'name','')||' '||r.id||' '||COALESCE(r.document->>'description','')),lower(sqlc.arg(search)::text))>0)
 AND (sqlc.arg(severity)::text='' OR r.document->>'severity'=sqlc.arg(severity)::text)
 AND (sqlc.arg(enabled)::text='' OR COALESCE(r.document->>'enabled','false')=sqlc.arg(enabled)::text)
 AND (sqlc.arg(source)::text='' OR EXISTS(SELECT 1 FROM api_sources s WHERE s.tenant_id=r.tenant_id AND s.rule_id=r.id AND s.provider=sqlc.arg(source)::text) OR EXISTS(SELECT 1 FROM alerts a WHERE a.tenant_id=r.tenant_id AND a.rule_id=r.id AND a.source=sqlc.arg(source)::text))
), window_alerts AS MATERIALIZED (
 SELECT a.rule_id,a.created_at,a.source,a.document,i.id AS investigation_id,i.determination
 FROM alerts a JOIN matched m ON m.id=a.rule_id
 LEFT JOIN investigations i ON i.tenant_id=a.tenant_id AND i.id=a.investigation_id
 WHERE a.tenant_id=sqlc.arg(tenant_id)::text
 AND a.created_at>=statement_timestamp()-(sqlc.arg(days)::int*interval '24 hours') AND a.created_at<=statement_timestamp()
), metrics AS (
 SELECT rule_id,count(*) AS detections,count(DISTINCT investigation_id) AS investigations,
 max(created_at) AS last_activity_at,count(*) FILTER(WHERE document->>'disposition'='suppressed') AS suppressed,
 jsonb_agg(DISTINCT source) AS sources
 FROM window_alerts GROUP BY rule_id
), ranked AS (
 SELECT m.*,COALESCE(a.detections,0) AS detections,COALESCE(a.investigations,0) AS investigations,
 a.last_activity_at,COALESCE(a.suppressed,0) AS suppressed,COALESCE(a.sources,'[]'::jsonb) AS sources
 FROM matched m LEFT JOIN metrics a ON a.rule_id=m.id
), sorted AS (
 SELECT *,row_number() OVER (ORDER BY
 CASE WHEN sqlc.arg(sort)::text='name' AND sqlc.arg(direction)::text='asc' THEN lower(name) END COLLATE "C" ASC,
 CASE WHEN sqlc.arg(sort)::text='name' AND sqlc.arg(direction)::text<>'asc' THEN lower(name) END COLLATE "C" DESC,
 CASE WHEN sqlc.arg(sort)::text='detections' AND sqlc.arg(direction)::text='asc' THEN detections END ASC,
 CASE WHEN sqlc.arg(sort)::text='detections' AND sqlc.arg(direction)::text<>'asc' THEN detections END DESC,
 CASE WHEN sqlc.arg(sort)::text='severity' AND sqlc.arg(direction)::text='asc' THEN CASE document->>'severity' WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END END ASC,
 CASE WHEN sqlc.arg(sort)::text='severity' AND sqlc.arg(direction)::text<>'asc' THEN CASE document->>'severity' WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END END DESC,
 CASE WHEN sqlc.arg(sort)::text IN ('','updated_at') AND sqlc.arg(direction)::text='asc' THEN updated_at END ASC,
 CASE WHEN sqlc.arg(sort)::text IN ('','updated_at') AND sqlc.arg(direction)::text<>'asc' THEN updated_at END DESC,
 id COLLATE "C" ASC) AS position FROM ranked
), paged AS MATERIALIZED (
 SELECT * FROM sorted ORDER BY position LIMIT sqlc.arg(page_limit)::int OFFSET sqlc.arg(page_offset)::bigint
)
SELECT jsonb_build_object(
 'items',(SELECT COALESCE(jsonb_agg(p.document || jsonb_build_object(
 'id',p.id,'tenant_id',sqlc.arg(tenant_id)::text,'name',p.name,'mitre_techniques',p.techniques,'version',p.version,
 'detections',p.detections,'investigations',p.investigations,'last_activity_at',p.last_activity_at,'suppressed',p.suppressed,'sources',p.sources,
 'false_positive_rate',NULL,'period',sqlc.arg(days)::int||'_days','daily_average',round(p.detections::numeric/sqlc.arg(days)::int,1),
 'outcomes',(SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY determination),'[]'::jsonb) FROM (SELECT w.determination,count(DISTINCT w.investigation_id) AS count FROM window_alerts w WHERE w.rule_id=p.id AND w.investigation_id IS NOT NULL GROUP BY w.determination) o),
 'bindings',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'provider',s.provider) ORDER BY s.name,s.id),'[]'::jsonb) FROM api_sources s WHERE s.tenant_id=sqlc.arg(tenant_id)::text AND s.rule_id=p.id)
 ) ORDER BY p.position),'[]'::jsonb) FROM paged p),
 'total',(SELECT count(*) FROM matched),'limit',sqlc.arg(page_limit)::int,'offset',sqlc.arg(page_offset)::bigint,
 'days',sqlc.arg(days)::int,'as_of',statement_timestamp(),'window_start',statement_timestamp()-(sqlc.arg(days)::int*interval '24 hours'),
 'summary',jsonb_build_object('registry_rules',(SELECT count(*) FROM matched),'triggered_alerts',(SELECT count(*) FROM window_alerts),
 'mapped_rules',(SELECT count(*) FROM matched WHERE jsonb_array_length(techniques)>0),'mitre_coverage',NULL),
 'sources',(SELECT COALESCE(jsonb_agg(name ORDER BY name),'[]'::jsonb) FROM (SELECT s.provider AS name FROM api_sources s WHERE s.tenant_id=sqlc.arg(tenant_id)::text UNION SELECT a.source AS name FROM alerts a WHERE a.tenant_id=sqlc.arg(tenant_id)::text) choices)
);
