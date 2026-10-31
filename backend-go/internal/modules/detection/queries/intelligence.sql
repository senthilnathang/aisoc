-- name: DetectionIntelligence :one
WITH filtered AS MATERIALIZED (
 SELECT a.id,a.source,a.rule_id,i.id AS investigation_id,a.created_at,a.ordinal,
 a.document->>'title' AS title,a.document->>'severity' AS severity,
 a.document->>'disposition' AS disposition,a.document->>'routing' AS routing,
 COALESCE(NULLIF(r.document->>'category',''),'Unclassified') AS category,
 COALESCE(NULLIF(r.document->>'name',''),r.id) AS rule_name,s.provider AS source_provider,i.determination
 FROM alerts a JOIN detection_rules r ON r.tenant_id=a.tenant_id AND r.id=a.rule_id
 LEFT JOIN investigations i ON i.tenant_id=a.tenant_id AND i.id=a.investigation_id
 LEFT JOIN api_sources s ON s.tenant_id=a.tenant_id AND a.source='api-source:'||s.id
 WHERE a.tenant_id=sqlc.arg(tenant_id)::text AND a.created_at>=statement_timestamp()-(sqlc.arg(days)::integer*interval '24 hours')
 AND a.created_at<=statement_timestamp()
 AND (sqlc.arg(source)::text='' OR a.source=sqlc.arg(source)::text OR s.provider=sqlc.arg(source)::text) AND (sqlc.arg(severity)::text='' OR a.document->>'severity'=sqlc.arg(severity)::text)
 AND (sqlc.arg(search)::text='' OR strpos(lower(COALESCE(a.document->>'title','')||' '||COALESCE(r.document->>'name',r.id)||' '||COALESCE(s.provider,a.source)),lower(sqlc.arg(search)::text))>0)
 AND (sqlc.arg(rule_id)::text='' OR a.rule_id=sqlc.arg(rule_id)::text)
 ), tiles AS MATERIALIZED (
 SELECT COALESCE(source_provider,source) AS source,rule_id,rule_name,count(*) AS count,
 count(*) FILTER(WHERE investigation_id IS NOT NULL) AS linked,
 count(*) FILTER(WHERE routing='Escalate') AS escalated
 FROM filtered GROUP BY 1,2,3
 ) SELECT jsonb_build_object(
 'days',sqlc.arg(days)::integer,
 'as_of',statement_timestamp(),
 'window_start',statement_timestamp()-(sqlc.arg(days)::integer*interval '24 hours'),
 'groups',(SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY count DESC,source,rule_id),'[]'::jsonb) FROM (SELECT * FROM tiles ORDER BY count DESC,source,rule_id LIMIT 200) g),
 'group_count',(SELECT count(*) FROM tiles),
 'by_category',(SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY count DESC,name),'[]'::jsonb) FROM (SELECT category AS name,count(*) AS count FROM filtered GROUP BY category) g),
 'totals',(SELECT jsonb_build_object('linked_alerts',count(*) FILTER(WHERE investigation_id IS NOT NULL),'escalated_alerts',count(*) FILTER(WHERE routing='Escalate'),'total_alerts',count(*),'investigated',count(DISTINCT investigation_id),'suppressed',count(*) FILTER(WHERE disposition='suppressed'),'not_sampled',count(*) FILTER(WHERE disposition='not_sampled'),'pending_review',count(DISTINCT investigation_id) FILTER(WHERE determination='unknown')) FROM filtered),
 'by_source',(SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY count DESC,name COLLATE "C"),'[]'::jsonb) FROM (SELECT COALESCE(source_provider,source) AS name,count(*) AS count FROM filtered GROUP BY COALESCE(source_provider,source)) g),
 'by_severity',(SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY count DESC,name COLLATE "C"),'[]'::jsonb) FROM (SELECT severity AS name,count(*) AS count FROM filtered GROUP BY severity) g),
 'by_routing',(SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY count DESC,name COLLATE "C"),'[]'::jsonb) FROM (SELECT routing AS name,count(*) AS count FROM filtered GROUP BY routing) g),
 'by_disposition',(SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY count DESC,name COLLATE "C"),'[]'::jsonb) FROM (SELECT disposition AS name,count(*) AS count FROM filtered GROUP BY disposition) g),
 'outcomes',(SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY count DESC,name COLLATE "C"),'[]'::jsonb) FROM (SELECT determination AS name,count(DISTINCT investigation_id) AS count FROM filtered WHERE investigation_id IS NOT NULL GROUP BY determination) g),
 'daily',(SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY date),'[]'::jsonb) FROM (SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date,count(*) FILTER(WHERE severity='critical') AS critical,count(*) FILTER(WHERE severity='high') AS high,count(*) FILTER(WHERE severity='medium') AS medium,count(*) FILTER(WHERE severity='low') AS low,count(*) AS total FROM filtered GROUP BY 1) g),
 'investigations',(SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY last_alert_at DESC,id),'[]'::jsonb) FROM (SELECT investigation_id AS id,max(title) AS alert_title,determination,count(*) AS alerts,max(created_at) AS last_alert_at FROM filtered WHERE investigation_id IS NOT NULL GROUP BY investigation_id,determination ORDER BY max(created_at) DESC,investigation_id LIMIT 50) g),
 'recent',(SELECT COALESCE(jsonb_agg(to_jsonb(g)-'ordinal' ORDER BY created_at DESC,ordinal DESC),'[]'::jsonb) FROM (SELECT id,title,source,severity,disposition,routing,rule_id,investigation_id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,rule_name,source_provider,determination,ordinal FROM filtered ORDER BY filtered.created_at DESC,ordinal DESC LIMIT 50) g),
 'sources',(SELECT COALESCE(jsonb_agg(name ORDER BY name COLLATE "C"),'[]'::jsonb) FROM (SELECT ac.source AS name FROM alerts ac WHERE ac.tenant_id=sqlc.arg(tenant_id)::text AND ac.source NOT ILIKE 'api-source:%' UNION SELECT sc.provider AS name FROM api_sources sc WHERE sc.tenant_id=sqlc.arg(tenant_id)::text) choices)
 );
