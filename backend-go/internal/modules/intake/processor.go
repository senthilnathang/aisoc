package intake

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/skills"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"time"
)

type runJob struct {
	ID, Tenant, Case, Alert string
	Phase                   int
	Result                  map[string]any
}

// ProcessNext claims one phase with a transaction-scoped row lock. No external
// I/O occurs under this lock. A crash rolls the phase back and releases the lock;
// committed phases are retained. Multiple workers skip already locked jobs.
func (s Store) ProcessNext(ctx context.Context) (bool, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var job runJob
	found, err := claimFindingPhase(ctx, tx, &job)
	if err != nil {
		return false, err
	}
	if !found {
		err = tx.QueryRow(ctx, `SELECT id,tenant_id,investigation_id,alert_id,phase,result FROM investigation_jobs j WHERE status IN ('queued','running') AND NOT EXISTS(SELECT 1 FROM stream_findings f WHERE f.tenant_id=j.tenant_id AND f.investigation_id=j.investigation_id) ORDER BY updated_at,ordinal FOR UPDATE SKIP LOCKED LIMIT 1`).Scan(&job.ID, &job.Tenant, &job.Case, &job.Alert, &job.Phase, &job.Result)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err = investigations.Lock(ctx, tx, job.Tenant, job.Case); err != nil {
		return false, err
	}
	phase, err := tx.Begin(ctx)
	if err != nil {
		return false, err
	}
	err = s.processPhase(ctx, phase, job)
	if err == nil {
		if err = phase.Commit(ctx); err != nil {
			return false, err
		}
		return true, tx.Commit(ctx)
	}
	if rollbackErr := phase.Rollback(ctx); rollbackErr != nil {
		return false, rollbackErr
	}
	if ctx.Err() != nil {
		return false, ctx.Err()
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	if _, err = tx.Exec(ctx, `UPDATE investigation_jobs SET status='failed',error=$3,updated_at=$4 WHERE tenant_id=$1 AND id=$2`, job.Tenant, job.ID, "Local processing failed. Review the recorded evidence and retry the investigation.", now); err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `UPDATE investigations SET status='open',updated_at=$3 WHERE tenant_id=$1 AND id=$2`, job.Tenant, job.Case, now); err != nil {
		return false, err
	}
	if err = investigations.Audit(ctx, tx, job.Tenant, job.Case, "investigation_failed", map[string]any{"run_id": job.ID, "phase": job.Phase}); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}
func (s Store) processPhase(ctx context.Context, tx pgx.Tx, job runJob) error {
	var raw []byte
	if err := tx.QueryRow(ctx, `SELECT document->'payload' FROM alerts WHERE tenant_id=$1 AND id=$2`, job.Tenant, job.Alert).Scan(&raw); err != nil {
		return err
	}
	var payload AlertInput
	if err := json.Unmarshal(raw, &payload); err != nil {
		return err
	}
	now := time.Now().UTC().Truncate(time.Millisecond)
	timestamp := investigations.Timestamp(now)
	var title, conclusion string
	var request, response map[string]any
	result := job.Result
	if result == nil {
		result = map[string]any{}
	}
	switch job.Phase {
	case 0:
		title = "Record supplied evidence"
		items := append([]Evidence{}, payload.Evidence...)
		if payload.PrimaryEntity != "" {
			items = append([]Evidence{{Type: "entity", Value: payload.PrimaryEntity, Label: "Primary entity"}}, items...)
		}
		order := []string{}
		unique := map[string]Evidence{}
		for _, item := range items {
			key, _ := jsonBytes([]string{item.Type, item.Value})
			if _, ok := unique[string(key)]; !ok {
				order = append(order, string(key))
			}
			unique[string(key)] = item
		}
		for _, key := range order {
			item := unique[key]
			hash := sha256.Sum256([]byte(key))
			id := "ART-" + job.Alert + "-" + hex.EncodeToString(hash[:])[:20]
			record := map[string]any{"id": id, "tenant_id": job.Tenant, "investigation_id": job.Case, "type": item.Type, "value": item.Value, "label": item.Label, "metadata": map[string]any{"provenance": "Submitted alert; not independently verified", "alert_id": job.Alert, "source": payload.Source}, "created_at": timestamp, "updated_at": timestamp}
			doc, err := json.Marshal(record)
			if err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, `INSERT INTO case_records(tenant_id,id,investigation_id,kind,document,created_at,updated_at) VALUES($1,$2,$3,'artifacts',$4,$5,$5) ON CONFLICT(tenant_id,id) DO NOTHING`, job.Tenant, id, job.Case, doc, now); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE investigations SET status='investigating',updated_at=$3 WHERE tenant_id=$1 AND id=$2`, job.Tenant, job.Case, now); err != nil {
			return err
		}
		request = map[string]any{"source": payload.Source, "external_id": payload.ExternalID, "evidence": items}
		response = map[string]any{"artifacts_recorded": len(unique), "external_tools_executed": false}
		conclusion = fmt.Sprintf("Recorded %d distinct supplied artifacts. No external data was fetched.", len(unique))
	case 1:
		title = "Compare with local threat indicators"
		matches := []map[string]any{}
		seen := map[string]bool{}
		for _, item := range payload.Evidence {
			rows, err := tx.Query(ctx, `SELECT id,value,indicator_type FROM threat_indicators WHERE tenant_id=$1 AND indicator_type=$2 AND value=$3 AND status='active' ORDER BY ordinal LIMIT 100`, job.Tenant, item.Type, item.Value)
			if err != nil {
				return err
			}
			for rows.Next() {
				var id, value, kind string
				if err = rows.Scan(&id, &value, &kind); err != nil {
					rows.Close()
					return err
				}
				if !seen[id] {
					seen[id] = true
					matches = append(matches, map[string]any{"id": id, "value": value, "indicator_type": kind})
				}
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return err
			}
		}
		result = map[string]any{"matches": matches}
		request = map[string]any{"evidence": payload.Evidence, "method": "Exact type/value match against active tenant-local indicators"}
		response = map[string]any{"matches": matches, "external_tools_executed": false}
		conclusion = fmt.Sprintf("%d matching local indicators. A match is a review signal, not proof of compromise; no match does not establish safety.", len(matches))
	case 2:
		title = "Record review outcome"
		matches, _ := result["matches"].([]any)
		if _, err := skills.Apply(ctx, tx, job.Tenant, "investigation", job.Case, skillContext(payload, matches)); err != nil {
			return err
		}
		count := len(matches)
		determination := "unknown"
		if count > 0 || payload.Severity == "high" || payload.Severity == "critical" {
			determination = "suspicious"
		}
		explanation := "Insufficient evidence for a determination."
		if determination == "suspicious" {
			explanation = "Analyst review required."
		}
		conclusion = fmt.Sprintf("Local review: %d matching indicators; source severity %s. %s No external tools executed.", count, payload.Severity, explanation)
		request = map[string]any{"source_severity": payload.Severity, "local_indicator_matches": count}
		response = map[string]any{"determination": determination, "status": "open", "analyst_review_required": true, "external_tools_executed": false}
		if _, err := tx.Exec(ctx, `UPDATE investigations SET determination=$3,status='open',summary=$4,updated_at=$5 WHERE tenant_id=$1 AND id=$2`, job.Tenant, job.Case, determination, conclusion, now); err != nil {
			return err
		}
	default:
		return fmt.Errorf("invalid phase")
	}
	request["run_id"] = job.ID
	step := map[string]any{"id": fmt.Sprintf("%s:%d", job.ID, job.Phase), "tenant_id": job.Tenant, "investigation_id": job.Case, "title": title, "conclusion": conclusion, "tool": "Local deterministic worker", "request": request, "response": response, "created_at": timestamp, "updated_at": timestamp}
	stepJSON, err := json.Marshal(step)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO investigation_steps(tenant_id,id,investigation_id,document,created_at) VALUES($1,$2,$3,$4,$5)`, job.Tenant, step["id"], job.Case, stepJSON, now); err != nil {
		return err
	}
	status, action := "running", "investigation_progress"
	if job.Phase == 2 {
		status = "completed"
		action = "investigation_completed"
	}
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE investigation_jobs SET status=$3,phase=$4,result=$5,updated_at=$6 WHERE tenant_id=$1 AND id=$2`, job.Tenant, job.ID, status, job.Phase+1, resultJSON, now); err != nil {
		return err
	}
	return investigations.Audit(ctx, tx, job.Tenant, job.Case, action, map[string]any{"run_id": job.ID, "phase": job.Phase + 1, "title": title})
}
