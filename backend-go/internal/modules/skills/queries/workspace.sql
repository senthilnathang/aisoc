-- name: LibrarySkills :many
SELECT document FROM skills WHERE tenant_id=sqlc.arg(tenant_id)
AND (sqlc.arg(state)::text='' OR document->>'state'=sqlc.arg(state))
AND (sqlc.arg(module)::text='' OR (document->'modules') ? sqlc.arg(module))
AND (sqlc.arg(origin)::text='' OR (sqlc.arg(origin)='augmented' AND document->>'origin'='environment_generated') OR (sqlc.arg(origin)='custom' AND document->>'origin'<>'environment_generated'))
AND (sqlc.arg(search)::text='' OR strpos(lower(concat_ws(' ',document->>'name',document->>'description',tags_search)),lower(sqlc.arg(search)))>0)
ORDER BY updated_at DESC, id LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: LibraryCounts :one
SELECT count(*) AS total, count(*) FILTER (WHERE document->>'state'='published') AS published, count(*) FILTER (WHERE document->>'state'='draft') AS drafts FROM skills WHERE tenant_id=sqlc.arg(tenant_id)
AND (sqlc.arg(state)::text='' OR document->>'state'=sqlc.arg(state))
AND (sqlc.arg(module)::text='' OR (document->'modules') ? sqlc.arg(module))
AND (sqlc.arg(origin)::text='' OR (sqlc.arg(origin)='augmented' AND document->>'origin'='environment_generated') OR (sqlc.arg(origin)='custom' AND document->>'origin'<>'environment_generated'))
AND (sqlc.arg(search)::text='' OR strpos(lower(concat_ws(' ',document->>'name',document->>'description',tags_search)),lower(sqlc.arg(search)))>0);
