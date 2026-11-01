-- name: Catalog :one
WITH assets AS (
 SELECT s.id,'skill'::text AS kind,coalesce(s.document->>'name',s.id) AS name,
 coalesce(s.document->>'description','') AS description,coalesce(s.document->>'state','unknown') AS state,s.updated_at::text AS updated_at,
 jsonb_build_object('version',s.document->'version','enabled',s.document->'enabled','modules',s.document->'modules','origin',s.document->'origin') AS details
 FROM skills s WHERE s.tenant_id=sqlc.arg(tenant_id)
 UNION ALL
 SELECT p.id,p.document->>'kind',coalesce(p.document->>'title',p.id),coalesce(p.document->>'description',''),coalesce(p.document->>'state','unknown'),p.document->>'updated_at',
 jsonb_build_object('version',p.document->'version','domain',p.document->'domain','trigger',p.document->'trigger','policy_version',w.version,'policy_enabled',w.document->'enabled')
 FROM response_plans p LEFT JOIN response_workflow_policies w ON w.tenant_id=p.tenant_id AND w.plan_id=p.id WHERE p.tenant_id=sqlc.arg(tenant_id) AND p.document->>'kind' IN ('workflow','runbook')
 UNION ALL
 SELECT a.id,'api_source',a.name,'Scoped alert intake source',CASE WHEN a.revoked_at IS NOT NULL THEN 'revoked' WHEN a.expires_at<=now() THEN 'expired' WHEN a.key_hash IS NULL THEN 'no_key' ELSE 'key_valid' END,a.updated_at::text,
 jsonb_build_object('provider',a.provider,'rule_id',a.rule_id,'rule_name',r.document->>'name','rule_enabled',r.document->'enabled','expires_at',a.expires_at,'mapping_configured',a.mapping->'fields' IS NOT NULL AND a.mapping->'fields'<>'{}'::jsonb)
 FROM api_sources a JOIN detection_rules r ON r.tenant_id=a.tenant_id AND r.id=a.rule_id WHERE a.tenant_id=sqlc.arg(tenant_id)
 UNION ALL
 SELECT c.id,'connector',coalesce(c.document->>'name',c.id),'Saved connector configuration',coalesce(c.document->>'status','unknown'),c.updated_at::text,
 jsonb_build_object('provider',c.document->>'type','last_tested_at',c.document->'last_tested_at')
 FROM connectors c WHERE c.tenant_id=sqlc.arg(tenant_id)
), filtered AS (
 SELECT * FROM assets WHERE (sqlc.arg(kind)::text='all' OR kind=sqlc.arg(kind)) AND (sqlc.arg(search)::text='' OR strpos(lower(name||' '||description),lower(sqlc.arg(search)))>0)
), page AS (SELECT * FROM filtered ORDER BY lower(name),kind,id LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset))
SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(page ORDER BY lower(name),kind,id) FROM page),'[]'::jsonb),'total',(SELECT count(*) FROM filtered),
 'counts',COALESCE((SELECT jsonb_object_agg(kind,n) FROM (SELECT kind,count(*) AS n FROM assets GROUP BY kind) counts),'{}'::jsonb));
