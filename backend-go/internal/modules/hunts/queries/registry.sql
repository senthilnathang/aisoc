-- name: HuntRegistry :one
WITH filtered AS MATERIALIZED (
 SELECT document, updated_at, ordinal FROM hunts
 WHERE tenant_id=sqlc.arg(tenant_id)
 AND (sqlc.arg(status)::text='' OR document->>'status'=sqlc.arg(status))
 AND (sqlc.arg(search)::text='' OR document->>'name' ILIKE sqlc.arg(pattern)::text ESCAPE '' OR document->>'query' ILIKE sqlc.arg(pattern)::text ESCAPE '')
), page AS (
 SELECT * FROM filtered ORDER BY updated_at DESC,ordinal DESC
 LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset)::bigint
)
SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(document ORDER BY updated_at DESC,ordinal DESC) FROM page),'[]'::jsonb),'total',(SELECT count(*) FROM filtered))::jsonb AS result;
