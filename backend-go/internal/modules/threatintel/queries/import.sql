-- name: LockIntelImport :exec
SELECT pg_advisory_xact_lock(hashtextextended($1::text,0));
-- name: EnsureImportTenant :exec
INSERT INTO tenants(id) VALUES($1) ON CONFLICT DO NOTHING;
-- name: IntelImportReceipt :one
SELECT report_id,content_hash,document,EXISTS(SELECT 1 FROM threat_intel_reports r WHERE r.tenant_id=i.tenant_id AND r.id=i.report_id) AS available FROM threat_json_imports i WHERE i.tenant_id=$1 AND i.source=$2 AND i.external_id=$3;
-- name: InsertIntelImportReceipt :exec
INSERT INTO threat_json_imports(tenant_id,source,external_id,report_id,content_hash,actor,document) VALUES($1,$2,$3,$4,$5,$6,$7);
-- name: InsertImportedReport :exec
INSERT INTO threat_intel_reports(tenant_id,id,title,summary,source,report_type,severity,ioc_count,tags,published_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'ioc_feed',$6,$7,$8,$9,now(),now());
-- name: InsertImportedIndicator :exec
INSERT INTO threat_indicators(tenant_id,id,report_id,indicator_type,value,severity,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,now(),now());
-- name: ReportImportProvenance :many
SELECT document FROM threat_json_imports WHERE tenant_id=$1 AND report_id=$2 ORDER BY created_at LIMIT 1;
