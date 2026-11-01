-- Read-time eligibility: source changes never rewrite historical application snapshots.
CREATE FUNCTION aisoc_learning_current(scope text, doc jsonb) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN doc->>'learning_archived'='true' THEN false
 WHEN NOT (doc ? 'learning_origin') THEN true
 ELSE EXISTS(SELECT 1 FROM investigations i
 WHERE i.tenant_id=scope AND i.id=doc#>>'{learning_origin,source_case,id}'
 AND i.status IN ('resolved','closed') AND i.determination IN ('benign','suspicious','malicious','mitigated')
 AND to_char(i.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') =
 COALESCE(doc#>>'{learning_review,source_version}',doc#>>'{learning_origin,source_case,updated_at}')) END;
$$;
