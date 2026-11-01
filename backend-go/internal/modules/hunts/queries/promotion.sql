-- name: HuntPromotion :one
SELECT document,EXISTS(SELECT 1 FROM investigations i WHERE i.tenant_id=p.tenant_id AND i.id=p.investigation_id) AS available FROM hunt_promotions p WHERE p.tenant_id=$1 AND hunt_id=$2 AND run_id=$3 AND finding_kind=$4 AND record_id=$5;
-- name: HuntPromotions :many
SELECT (document || jsonb_build_object('available',EXISTS(SELECT 1 FROM investigations i WHERE i.tenant_id=p.tenant_id AND i.id=p.investigation_id)))::jsonb AS document FROM hunt_promotions p WHERE p.tenant_id=$1 AND hunt_id=$2 ORDER BY created_at DESC LIMIT 100;
-- name: InsertHuntPromotion :exec
INSERT INTO hunt_promotions(tenant_id,hunt_id,run_id,finding_kind,record_id,investigation_id,document) VALUES($1,$2,$3,$4,$5,$6,$7);
-- name: InsertPromotedArtifact :exec
INSERT INTO case_records(tenant_id,id,investigation_id,kind,document,created_at,updated_at) VALUES($1,$2,$3,'artifacts',$4,now(),now());
-- name: HuntPromotionCount :one
SELECT count(*) FROM hunt_promotions WHERE tenant_id=$1 AND hunt_id=$2;
-- name: HuntSourceIntel :many
SELECT report_id,indicator_id,indicator_value,actor,created_at FROM threat_report_hunts WHERE tenant_id=$1 AND hunt_id=$2 ORDER BY created_at LIMIT 1;
-- name: CaseHuntOrigin :many
SELECT document FROM hunt_promotions WHERE tenant_id=$1 AND investigation_id=$2 ORDER BY created_at LIMIT 1;
