package hunts

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"aisoc/backend/internal/modules/hunts/huntsql"
	"aisoc/backend/internal/modules/insights"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/jobs"
	"aisoc/backend/internal/platform/jobs/jobsql"
	"context"
	"encoding/json"
	"time"
)

// HuntWorker runs only bounded local queries. It never invokes a provider or model.
type HuntWorker struct{ jobs.Store }

func NewHuntWorker(s Store, tenantLimit int32) HuntWorker {
	return HuntWorker{jobs.Store{Pool: s.Pool, Plugins: []string{HuntPlugin}, TenantLimit: tenantLimit}}
}
func (w HuntWorker) Execute(ctx context.Context, r *pb.ExecuteRequest) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	q := huntsql.New(w.Pool)
	n, err := q.HuntExecutionPhase(ctx, huntsql.HuntExecutionPhaseParams{TenantID: r.TenantId, JobID: uuid(r.JobId), AttemptID: uuid(r.AttemptId), Phase: "searching_evidence"})
	if err != nil {
		return nil, err
	}
	if n != 1 {
		return nil, jobs.ErrStale
	}
	in, err := q.HuntJobInput(ctx, huntsql.HuntJobInputParams{TenantID: r.TenantId, JobID: uuid(r.JobId)})
	if err != nil {
		return nil, err
	}
	rows, err := q.HuntEvidence(ctx, huntsql.HuntEvidenceParams{TenantID: r.TenantId, Column2: in.Query})
	if err != nil {
		return nil, err
	}
	run := Run{ID: in.RunID, Query: in.Query, Expected: in.ExpectedUpdatedAt, Actor: in.Actor, CreatedAt: investigations.Timestamp(time.Now().UTC()), Verdict: "inconclusive", Scope: SearchScope, Findings: []Finding{}, Truncated: len(rows) > 100}
	if len(rows) > 100 {
		rows = rows[:100]
	}
	for _, row := range rows {
		run.Findings = append(run.Findings, Finding{row.RecordID, row.CaseID, row.Kind, row.Label, row.Excerpt, row.Source, row.Entity})
	}
	if len(run.Findings) > 0 {
		run.Verdict = "review_required"
	}
	n, err = q.HuntExecutionPhase(ctx, huntsql.HuntExecutionPhaseParams{TenantID: r.TenantId, JobID: uuid(r.JobId), AttemptID: uuid(r.AttemptId), Phase: "recording_snapshot"})
	if err != nil {
		return nil, err
	}
	if n != 1 {
		return nil, jobs.ErrStale
	}
	return json.Marshal(run)
}
func (w HuntWorker) Complete(ctx context.Context, r *pb.ExecuteRequest, output []byte) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	tx, err := w.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := huntsql.New(tx)
	in, err := q.HuntJobInput(ctx, huntsql.HuntJobInputParams{TenantID: r.TenantId, JobID: uuid(r.JobId)})
	if err != nil {
		return err
	}
	if _, err = locked(ctx, q, r.TenantId, in.HuntID); err != nil {
		return err
	}
	job, err := q.LockHuntJob(ctx, huntsql.LockHuntJobParams{TenantID: r.TenantId, ID: uuid(r.JobId)})
	if err != nil {
		return err
	}
	if job.State != "running" || job.AttemptID != r.AttemptId || !job.LeaseUntil.Valid || !job.LeaseUntil.Time.After(time.Now()) {
		return jobs.ErrStale
	}
	var run Run
	if err = json.Unmarshal(output, &run); err != nil {
		return err
	}
	if run.ID != in.RunID || run.Query != in.Query || run.Actor != in.Actor || run.Expected != in.ExpectedUpdatedAt {
		return jobs.ErrStale
	}
	entities := []string{run.Query}
	for _, f := range run.Findings {
		entities = append(entities, f.Entity)
	}
	run.Memory, run.MemoryTruncated, err = insights.HuntSnapshots(ctx, tx, r.TenantId, in.HuntID, in.RunID, in.Actor, run.CreatedAt, entities)
	if err != nil {
		return err
	}
	run.MemoryPolicy = "exact-entity-current-approved-v1"
	raw, err := json.Marshal(run)
	if err != nil {
		return err
	}
	if err = q.InsertHuntRun(ctx, huntsql.InsertHuntRunParams{TenantID: r.TenantId, HuntID: in.HuntID, ID: in.RunID, Document: raw}); err != nil {
		return err
	}
	if err = investigations.ResourceAudit(ctx, tx, r.TenantId, "hunts", in.HuntID, "local_search", map[string]any{"request_id": in.RunID, "actor": in.Actor, "matches": len(run.Findings), "truncated": run.Truncated, "job_id": r.JobId, "attempt": job.Attempts}); err != nil {
		return err
	}
	n, err := jobsql.New(tx).Complete(ctx, jobsql.CompleteParams{TenantID: r.TenantId, ID: r.JobId, AttemptID: r.AttemptId, Output: []byte(`{"receipt":"hunt_search_runs"}`)})
	if err != nil {
		return err
	}
	if n != 1 {
		return jobs.ErrStale
	}
	return tx.Commit(ctx)
}
