package detection

import "context"

type IntelligenceOptions struct {
	Days             int
	Source, Severity string
}

// One statement provides one MVCC snapshot and cutoff for every projection.
// Source enrichment is tenant-bound even when an operator supplies a raw source
// string resembling another tenant's API-source ID.
func (s Store) Intelligence(ctx context.Context, tenant string, o IntelligenceOptions) (map[string]any, error) {
	groups := func(expression string) string {
		return `(SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY count DESC,name COLLATE "C"),'[]'::jsonb) FROM (SELECT ` + expression + ` AS name,count(*) AS count FROM filtered GROUP BY ` + expression + `) g)`
	}
	query := `WITH filtered AS MATERIALIZED (
 SELECT a.id,a.source,a.rule_id,a.investigation_id,a.created_at,a.ordinal,
 a.document->>'title' AS title,a.document->>'severity' AS severity,
 a.document->>'disposition' AS disposition,a.document->>'routing' AS routing,
 r.document->>'name' AS rule_name,s.provider AS source_provider,i.determination
 FROM alerts a JOIN detection_rules r ON r.tenant_id=a.tenant_id AND r.id=a.rule_id
 LEFT JOIN investigations i ON i.tenant_id=a.tenant_id AND i.id=a.investigation_id
 LEFT JOIN api_sources s ON s.tenant_id=a.tenant_id AND a.source='api-source:'||s.id
 WHERE a.tenant_id=$1 AND a.created_at>=statement_timestamp()-($2::integer*interval '24 hours')
 AND ($3='' OR a.source=$3 OR s.provider=$3) AND ($4='' OR a.document->>'severity'=$4)
 ) SELECT jsonb_build_object(
 'days',$2::integer,
 'totals',(SELECT jsonb_build_object('total_alerts',count(*),'investigated',count(DISTINCT investigation_id),'suppressed',count(*) FILTER(WHERE disposition='suppressed'),'not_sampled',count(*) FILTER(WHERE disposition='not_sampled'),'pending_review',count(DISTINCT investigation_id) FILTER(WHERE determination='unknown')) FROM filtered),
 'by_source',` + groups(`COALESCE(source_provider,source)`) + `,
 'by_severity',` + groups(`severity`) + `,
 'by_routing',` + groups(`routing`) + `,
 'by_disposition',` + groups(`disposition`) + `,
 'outcomes',(SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY count DESC,name COLLATE "C"),'[]'::jsonb) FROM (SELECT determination AS name,count(DISTINCT investigation_id) AS count FROM filtered WHERE investigation_id IS NOT NULL GROUP BY determination) g),
 'daily',(SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY date),'[]'::jsonb) FROM (SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date,count(*) FILTER(WHERE severity='critical') AS critical,count(*) FILTER(WHERE severity='high') AS high,count(*) FILTER(WHERE severity='medium') AS medium,count(*) FILTER(WHERE severity='low') AS low,count(*) AS total FROM filtered GROUP BY 1) g),
 'recent',(SELECT COALESCE(jsonb_agg(to_jsonb(g)-'ordinal' ORDER BY created_at DESC,ordinal DESC),'[]'::jsonb) FROM (SELECT id,title,source,severity,disposition,routing,rule_id,investigation_id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,rule_name,source_provider,determination,ordinal FROM filtered ORDER BY filtered.created_at DESC,ordinal DESC LIMIT 50) g),
 'sources',(SELECT COALESCE(jsonb_agg(name ORDER BY name COLLATE "C"),'[]'::jsonb) FROM (SELECT source AS name FROM alerts WHERE tenant_id=$1 AND source NOT ILIKE 'api-source:%' UNION SELECT provider AS name FROM api_sources WHERE tenant_id=$1) choices)
 )`
	var result map[string]any
	err := s.Pool.QueryRow(ctx, query, tenant, o.Days, o.Source, o.Severity).Scan(&result)
	return result, err
}
