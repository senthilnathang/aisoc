// Package soarsync models sandbox note-only SOAR reconciliation. No provider I/O.
package soarsync

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/l1"
	"aisoc/backend/internal/platform/jobs"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/proto"
	"regexp"
	"strings"
	"time"
)

var ErrConflict = errors.New("mock SOAR revision or escalation conflict")
var ErrInvalid = errors.New("invalid mock SOAR request")
var token = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)

type Store struct{ Pool *pgxpool.Pool }
type Target struct{ ConnectorID, ExternalID, Version string }
type Receipt struct{ State, NoteID string }

func valid(tenant string, t Target) bool {
	for _, v := range []string{tenant, t.ConnectorID, t.ExternalID, t.Version} {
		if !token.MatchString(v) {
			return false
		}
	}
	return true
}

// Stage records a human-review escalation and note draft atomically. Caller binds
// the source SOAR case explicitly; this does not infer case mappings from model text.
func (s Store) Stage(ctx context.Context, tenant, jobID string, target Target) (Receipt, error) {
	var receipt Receipt
	if !valid(tenant, target) {
		return receipt, ErrInvalid
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return receipt, err
	}
	defer tx.Rollback(ctx)
	var input, output []byte
	var attempt string
	var completed time.Time
	err = tx.QueryRow(ctx, `SELECT input,output,attempt_id::text,updated_at FROM jobs WHERE tenant_id=$1 AND id=$2 AND plugin_id=$3 AND plugin_version='1' AND state='completed' FOR SHARE`, tenant, jobID, l1.Plugin).Scan(&input, &output, &attempt, &completed)
	if err != nil {
		return receipt, err
	}
	var task pb.InvestigationTask
	var result pb.InvestigationResult
	if proto.Unmarshal(input, &task) != nil || proto.Unmarshal(output, &result) != nil || task.TenantId != tenant || task.TaskId != jobID || task.AttemptId != "" || task.DeadlineUnixMs != 0 {
		return receipt, ErrInvalid
	}
	// Revalidate committed output at its recorded completion time, not as fresh inference.
	task.AttemptId = attempt
	task.DeadlineUnixMs = completed.Add(time.Second).UnixMilli()
	if l1.VerifyResult(&task, &result, completed) != nil {
		return receipt, ErrInvalid
	}
	if err = investigations.Lock(ctx, tx, tenant, task.IncidentId); err != nil {
		return receipt, err
	}
	var admitted bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM stream_findings WHERE tenant_id=$1 AND investigation_id=$2)`, tenant, task.IncidentId).Scan(&admitted); err != nil {
		return receipt, err
	}
	if !admitted {
		return receipt, ErrInvalid
	}
	sum := sha256.Sum256(output)
	var prior []byte
	var connector, external, initial string
	var note *string
	err = tx.QueryRow(ctx, `SELECT state,note_id,output_hash,connector_id,external_id,initial_version FROM l1_escalations WHERE tenant_id=$1 AND job_id=$2`, tenant, jobID).Scan(&receipt.State, &note, &prior, &connector, &external, &initial)
	if err == nil {
		if !bytes.Equal(prior, sum[:]) || connector != target.ConnectorID || external != target.ExternalID || initial != target.Version {
			return Receipt{}, ErrConflict
		}
		if note != nil {
			receipt.NoteID = *note
		}
		return receipt, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return receipt, err
	}
	refs := []string{}
	for _, e := range task.Evidence {
		refs = append(refs, e.Reference)
	}
	body := fmt.Sprintf("MOCK L1 review: INCONCLUSIVE. Human L2 review required. Missing evidence: iam_mfa_context, endpoint_process_tree. Evidence references: %s. Job: %s. No response actions executed.", strings.Join(refs, ", "), jobID)
	if _, err = tx.Exec(ctx, `INSERT INTO l1_escalations(tenant_id,job_id,investigation_id,connector_id,external_id,initial_version,expected_version,output_hash,note_body) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8)`, tenant, jobID, task.IncidentId, target.ConnectorID, target.ExternalID, target.Version, sum[:], body); err != nil {
		return Receipt{}, err
	}
	now := time.Now().UTC()
	record := map[string]any{"id": "L1-" + jobID, "tenant_id": tenant, "investigation_id": task.IncidentId, "type": "l2_review_required", "comment": body, "job_id": jobID, "model_version": result.ModelVersion, "created_at": investigations.Timestamp(now), "updated_at": investigations.Timestamp(now)}
	raw, _ := json.Marshal(record)
	if _, err = tx.Exec(ctx, `INSERT INTO case_records(tenant_id,id,investigation_id,kind,document,created_at,updated_at) VALUES($1,$2,$3,'feedback',$4,$5,$5)`, tenant, "L1-"+jobID, task.IncidentId, raw, now); err != nil {
		return Receipt{}, err
	}
	if err = investigations.Audit(ctx, tx, tenant, task.IncidentId, "l1_review_required", map[string]any{"job_id": jobID, "mode": "mock", "soar_external_id": target.ExternalID}); err != nil {
		return Receipt{}, err
	}
	return Receipt{State: "draft"}, tx.Commit(ctx)
}

// SyncMock appends a single note to the sandbox replica. Both the provider effect
// and receipt share this sandbox transaction; real network uncertainty is not modeled.
func (s Store) SyncMock(ctx context.Context, tenant, jobID string) (Receipt, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Receipt{}, err
	}
	defer tx.Rollback(ctx)
	var state, connector, external, expected, body, incident string
	var note *string
	err = tx.QueryRow(ctx, `SELECT state,connector_id,external_id,expected_version,note_body,investigation_id,note_id FROM l1_escalations WHERE tenant_id=$1 AND job_id=$2 FOR UPDATE`, tenant, jobID).Scan(&state, &connector, &external, &expected, &body, &incident, &note)
	if err != nil {
		return Receipt{}, err
	}
	if state == "synced" {
		return Receipt{State: state, NoteID: *note}, tx.Commit(ctx)
	}
	if state == "conflict" {
		return Receipt{State: state}, ErrConflict
	}
	var version string
	if err = tx.QueryRow(ctx, `SELECT version FROM mock_soar_cases WHERE tenant_id=$1 AND connector_id=$2 AND external_id=$3 FOR UPDATE`, tenant, connector, external).Scan(&version); err != nil {
		return Receipt{}, err
	}
	if version != expected {
		if _, err = tx.Exec(ctx, `UPDATE l1_escalations SET state='conflict' WHERE tenant_id=$1 AND job_id=$2`, tenant, jobID); err != nil {
			return Receipt{}, err
		}
		if err = investigations.Audit(ctx, tx, tenant, incident, "mock_soar_conflict", map[string]any{"job_id": jobID}); err != nil {
			return Receipt{}, err
		}
		if err = tx.Commit(ctx); err != nil {
			return Receipt{}, err
		}
		return Receipt{State: "conflict"}, ErrConflict
	}
	id := "NOTE-" + jobID
	if _, err = tx.Exec(ctx, `INSERT INTO mock_soar_notes(tenant_id,connector_id,external_id,id,origin,job_id,body) VALUES($1,$2,$3,$4,'aisoc-mock-l1',$5,$6)`, tenant, connector, external, id, jobID, body); err != nil {
		return Receipt{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE mock_soar_cases SET previous_version=version,version=$4 WHERE tenant_id=$1 AND connector_id=$2 AND external_id=$3`, tenant, connector, external, jobs.ID()); err != nil {
		return Receipt{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE l1_escalations SET state='synced',note_id=$3 WHERE tenant_id=$1 AND job_id=$2`, tenant, jobID, id); err != nil {
		return Receipt{}, err
	}
	if err = investigations.Audit(ctx, tx, tenant, incident, "mock_soar_note_synced", map[string]any{"job_id": jobID, "note_id": id}); err != nil {
		return Receipt{}, err
	}
	return Receipt{State: "synced", NoteID: id}, tx.Commit(ctx)
}

// RebaseMock requires an explicit actor and current expected version after review.
// This is an internal sandbox operation, not authorization for live SOAR writes.
func (s Store) RebaseMock(ctx context.Context, tenant, jobID, version, actor string, reviewTicket ...string) error {
	if !token.MatchString(actor) || !token.MatchString(version) {
		return ErrInvalid
	}
	if len(reviewTicket) > 1 || (len(reviewTicket) == 1 && !token.MatchString(reviewTicket[0])) {
		return ErrInvalid
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var connector, external, incident, state string
	if err = tx.QueryRow(ctx, `SELECT connector_id,external_id,investigation_id,state FROM l1_escalations WHERE tenant_id=$1 AND job_id=$2 FOR UPDATE`, tenant, jobID).Scan(&connector, &external, &incident, &state); err != nil {
		return err
	}
	if state != "conflict" {
		return ErrConflict
	}
	var current string
	if err = tx.QueryRow(ctx, `SELECT version FROM mock_soar_cases WHERE tenant_id=$1 AND connector_id=$2 AND external_id=$3 FOR UPDATE`, tenant, connector, external).Scan(&current); err != nil {
		return err
	}
	if current != version {
		return ErrConflict
	}
	if _, err = tx.Exec(ctx, `UPDATE l1_escalations SET state='draft',expected_version=$3 WHERE tenant_id=$1 AND job_id=$2`, tenant, jobID, version); err != nil {
		return err
	}
	details := map[string]any{"job_id": jobID, "actor": actor, "expected_version": version}
	if len(reviewTicket) == 1 {
		details["review_ticket"] = reviewTicket[0]
	}
	if err = investigations.Audit(ctx, tx, tenant, incident, "mock_soar_rebased", details); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
