package intake

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/eventstate"
	"github.com/jackc/pgx/v5"
)

// FindingAdmission is trusted control-plane configuration, never request body data.
// Limits apply to stream-admitted jobs across all connectors in this tenant.
type FindingAdmission struct {
	Binding                telemetry.Binding
	RuleID                 string
	MaxActive, MaxRetained int
}
type FindingReceipt struct {
	AlertID, InvestigationID, JobID string
	Duplicate                       bool
}

// AdmitFinding validates evidence against retained PostgreSQL observations and
// recomputes the allowlisted deterministic rule. All domain effects and the finding
// receipt commit together. This entry point has no HTTP route or provider calls.
func (s Store) AdmitFinding(ctx context.Context, cfg FindingAdmission, f telemetry.Finding) (FindingReceipt, error) {
	var receipt FindingReceipt
	if cfg.MaxActive < 1 || cfg.MaxActive > 1000 || cfg.MaxRetained < cfg.MaxActive || cfg.MaxRetained > 100000 || cfg.RuleID == "" || len(f.EventKeys) != 4 || cfg.Binding.Source != "qradar-siem" {
		return receipt, eventstate.ErrInvalid
	}
	if f.TenantID != cfg.Binding.TenantID || f.ConnectorID != cfg.Binding.ConnectorID || f.Source != cfg.Binding.Source {
		return receipt, telemetry.ErrBinding
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return receipt, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `INSERT INTO stream_admission_tenants(tenant_id) VALUES($1) ON CONFLICT DO NOTHING`, cfg.Binding.TenantID); err != nil {
		return receipt, err
	}
	var tenant string
	if err = tx.QueryRow(ctx, `SELECT tenant_id FROM stream_admission_tenants WHERE tenant_id=$1 FOR UPDATE`, cfg.Binding.TenantID).Scan(&tenant); err != nil {
		return receipt, err
	}
	events := make([]telemetry.Event, 0, 4)
	// Serialize against acceptance of new source revisions during validation.
	var source string
	if err = tx.QueryRow(ctx, `SELECT source FROM stream_source_checkpoints WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 FOR SHARE`, tenant, cfg.Binding.ConnectorID, cfg.Binding.Source).Scan(&source); err != nil {
		return receipt, err
	}
	for _, key := range f.EventKeys {
		var raw []byte
		var hash string
		err = tx.QueryRow(ctx, `SELECT envelope,content_hash FROM stream_events WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=$4 FOR SHARE`, tenant, cfg.Binding.ConnectorID, cfg.Binding.Source, key).Scan(&raw, &hash)
		if errors.Is(err, pgx.ErrNoRows) {
			return receipt, eventstate.ErrNotFound
		}
		if err != nil {
			return receipt, err
		}
		e, err := telemetry.Decode(raw, cfg.Binding)
		if err != nil {
			return receipt, err
		}
		if e.Identity() != key || e.ContentHash() != hash {
			return receipt, eventstate.ErrConflict
		}
		var ambiguous bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM stream_events WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key<>$4 AND convert_from(envelope,'UTF8')::jsonb->>'source_event_id'=$5)`, tenant, cfg.Binding.ConnectorID, cfg.Binding.Source, key, e.SourceEventID).Scan(&ambiguous); err != nil {
			return receipt, err
		}
		if ambiguous {
			return receipt, telemetry.ErrRevisionAmbiguous
		}
		events = append(events, e)
	}
	if err = f.ValidateEvidence(cfg.Binding, events); err != nil {
		return receipt, err
	}
	watermark, _ := time.Parse(time.RFC3339Nano, f.ObservedUntil)
	candidates, err := telemetry.SuspiciousLogins(cfg.Binding, events, watermark)
	if err != nil {
		return receipt, err
	}
	if len(candidates) != 1 || candidates[0].FindingID != f.FindingID {
		return receipt, eventstate.ErrInvalid
	}
	// Persist regenerated canonical content; caller cannot change rule semantics or time range.
	canonical := candidates[0]
	f.EventKeys = append([]string(nil), f.EventKeys...)
	f.EvidenceRefs = append([]string(nil), f.EvidenceRefs...)
	sort.Strings(f.EventKeys)
	sort.Strings(f.EvidenceRefs)
	sort.Strings(canonical.EventKeys)
	sort.Strings(canonical.EvidenceRefs)
	raw, _ := json.Marshal(canonical)
	supplied, _ := json.Marshal(f)
	if string(raw) != string(supplied) {
		return receipt, eventstate.ErrConflict
	}
	var priorRule string
	err = tx.QueryRow(ctx, `SELECT alert_id,investigation_id,job_id,rule_id FROM stream_findings WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND finding_id=$4`, tenant, cfg.Binding.ConnectorID, cfg.Binding.Source, f.FindingID).Scan(&receipt.AlertID, &receipt.InvestigationID, &receipt.JobID, &priorRule)
	if err == nil {
		if priorRule != cfg.RuleID {
			return FindingReceipt{}, eventstate.ErrConflict
		}
		receipt.Duplicate = true
		return receipt, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return receipt, err
	}
	var retained, active int
	err = tx.QueryRow(ctx, `SELECT count(DISTINCT f.finding_id),count(*) FILTER(WHERE j.status IN ('queued','running')) FROM stream_findings f JOIN investigation_jobs j ON j.tenant_id=f.tenant_id AND j.investigation_id=f.investigation_id WHERE f.tenant_id=$1`, tenant).Scan(&retained, &active)
	if err != nil {
		return receipt, err
	}
	if retained >= cfg.MaxRetained || active >= cfg.MaxActive {
		return receipt, eventstate.ErrCapacity
	}
	var rule map[string]any
	if err = tx.QueryRow(ctx, `SELECT document FROM detection_rules WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, tenant, cfg.RuleID).Scan(&rule); err != nil {
		return receipt, err
	}
	if rule["enabled"] != true || rule["routing"] != "Escalate" {
		return receipt, eventstate.ErrInvalid
	}
	input := AlertInput{Source: "stream-finding:" + cfg.Binding.ConnectorID, ExternalID: f.FindingID, RuleID: cfg.RuleID, Title: "Suspicious login requires review", Severity: "high", Summary: "Three failed logins followed by success. Deterministic review candidate; compromise is not established.", PrimaryEntity: events[0].Projection.PrincipalRef, Category: "identity", AlertType: "suspicious_login"}
	for _, ref := range canonical.EvidenceRefs {
		input.Evidence = append(input.Evidence, Evidence{Type: "evidence_ref", Value: ref, Label: "Source telemetry reference"})
	}
	result, err := s.ingest(ctx, tx, tenant, input, nil)
	if err != nil {
		return receipt, err
	}
	// An existing alert without a receipt is an unexpected namespace collision.
	if result["duplicate"] == true {
		return receipt, eventstate.ErrConflict
	}
	alert := result["alert"].(map[string]any)
	receipt.AlertID = alert["id"].(string)
	receipt.InvestigationID = alert["investigation_id"].(string)
	if err = tx.QueryRow(ctx, `SELECT id FROM investigation_jobs WHERE tenant_id=$1 AND alert_id=$2`, tenant, receipt.AlertID).Scan(&receipt.JobID); err != nil {
		return receipt, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO stream_findings(tenant_id,connector_id,source,finding_id,document,rule_id,alert_id,investigation_id,job_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, tenant, cfg.Binding.ConnectorID, cfg.Binding.Source, f.FindingID, raw, cfg.RuleID, receipt.AlertID, receipt.InvestigationID, receipt.JobID)
	if err != nil {
		return FindingReceipt{}, err
	}
	return receipt, tx.Commit(ctx)
}

// claimFindingPhase serializes phases per admitted tenant and rotates tenants by
// last completed claim. Transaction locks release on crash; no second job queue.
func claimFindingPhase(ctx context.Context, tx pgx.Tx, job *runJob) (bool, error) {
	var tenant string
	err := tx.QueryRow(ctx, `SELECT a.tenant_id FROM stream_admission_tenants a WHERE EXISTS(SELECT 1 FROM stream_findings f JOIN investigation_jobs j ON j.tenant_id=f.tenant_id AND j.investigation_id=f.investigation_id WHERE f.tenant_id=a.tenant_id AND j.status IN ('queued','running'))
 AND a.last_dispatched <= COALESCE((SELECT min(j.updated_at) FROM investigation_jobs j WHERE j.status IN ('queued','running') AND NOT EXISTS(SELECT 1 FROM stream_findings f WHERE f.tenant_id=j.tenant_id AND f.investigation_id=j.investigation_id)),'infinity'::timestamptz)
 ORDER BY a.last_dispatched,a.tenant_id FOR UPDATE OF a SKIP LOCKED LIMIT 1`).Scan(&tenant)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	err = tx.QueryRow(ctx, `SELECT j.id,j.tenant_id,j.investigation_id,j.alert_id,j.phase,j.result FROM investigation_jobs j JOIN stream_findings f ON f.tenant_id=j.tenant_id AND f.investigation_id=j.investigation_id WHERE j.tenant_id=$1 AND j.status IN ('queued','running') ORDER BY j.updated_at,j.ordinal FOR UPDATE OF j SKIP LOCKED LIMIT 1`, tenant).Scan(&job.ID, &job.Tenant, &job.Case, &job.Alert, &job.Phase, &job.Result)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `UPDATE stream_admission_tenants SET last_dispatched=clock_timestamp() WHERE tenant_id=$1`, tenant)
	return err == nil, err
}
