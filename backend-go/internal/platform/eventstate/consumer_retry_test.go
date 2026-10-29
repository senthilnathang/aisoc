package eventstate

import (
	"context"
	"errors"
	"testing"

	"aisoc/backend/internal/platform/auth"
)

func TestConsumerRetryPreservesAuditAndRejectsPoison(t *testing.T) {
	s, b, e := setup(t)
	ctx := context.Background()
	accept(t, s, b, Checkpoint{}, "page", e)
	t.Cleanup(func() {
		for _, table := range []string{"stream_dead_letters", "stream_consumer_work", "stream_replay_gaps", "audit_events"} {
			if _, err := s.Pool.Exec(ctx, "DELETE FROM "+table+" WHERE tenant_id=$1", b.TenantID); err != nil {
				t.Error(err)
			}
		}
	})
	w, err := s.BeginWork(ctx, b, "test", "event:"+e.Identity(), "1000-1", 1, 10)
	if err != nil {
		t.Fatal(err)
	}
	dead, err := s.FailWork(ctx, b, "test", w, "1000-1", "HANDLER_FAILED", false)
	if err != nil || !dead {
		t.Fatal(dead, err)
	}
	actor := auth.Principal{ID: "reviewer", Tenant: b.TenantID}
	o := OperatorRecovery{Store: s, Grants: []RecoveryGrant{{Operator: actor, Binding: b}}}
	req := ConsumerRetry{Processor: "test", PublicationRetry: PublicationRetry{RequestID: "review-1", EventKey: e.Identity(), ExpectedAttemptID: w.AttemptID, ExpectedAttempts: 1, Reason: "configuration_corrected", Ticket: "INC-1"}}
	if _, err = (OperatorRecovery{Store: s}).RetryConsumer(ctx, actor, b, req); !errors.Is(err, ErrRecoveryDenied) {
		t.Fatal(err)
	}
	stale := req
	stale.ExpectedAttemptID = "stale"
	if _, err = o.RetryConsumer(ctx, actor, b, stale); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	if replay, err := o.RetryConsumer(ctx, actor, b, req); err != nil || replay {
		t.Fatal(replay, err)
	}
	if replay, err := o.RetryConsumer(ctx, actor, b, req); err != nil || !replay {
		t.Fatal(replay, err)
	}
	var audits, deadletters int
	var state string
	if err = s.Pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND action='stream_consumer_retry' AND details->'previous_dead_letter'->>'reason'='HANDLER_FAILED'),(SELECT count(*) FROM stream_dead_letters WHERE tenant_id=$1),(SELECT state FROM stream_outbox WHERE tenant_id=$1)`, b.TenantID).Scan(&audits, &deadletters, &state); err != nil || audits != 1 || deadletters != 0 || state != "queued" {
		t.Fatal(audits, deadletters, state, err)
	}
	w, err = s.BeginWork(ctx, b, "test", "event:"+e.Identity(), "1000-2", 1, 10)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.FailWork(ctx, b, "test", w, "1000-2", "CONTENT_CONFLICT", true); err != nil {
		t.Fatal(err)
	}
	req.RequestID = "review-2"
	req.ExpectedAttemptID = w.AttemptID
	req.ExpectedOperatorRetries = 1
	if _, err = o.RetryConsumer(ctx, actor, b, req); !errors.Is(err, ErrConflict) {
		t.Fatal("poison reset", err)
	}
}

func TestDerivedBudgetRollbackAndDelete(t *testing.T) {
	s, b, e := setup(t)
	ctx := context.Background()
	accept(t, s, b, Checkpoint{}, "page", e)
	t.Cleanup(func() {
		if _, err := s.Pool.Exec(ctx, `DELETE FROM stream_replay_gaps WHERE tenant_id=$1`, b.TenantID); err != nil {
			t.Error(err)
		}
	})
	if err := s.RecordGap(ctx, b, "test", "1000-1", 10); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordGap(ctx, b, "test", "1000-1", 10); err != nil {
		t.Fatal(err)
	}
	count := func(want int) {
		t.Helper()
		var n int
		err := s.Pool.QueryRow(ctx, `SELECT retained_records FROM stream_metadata_budgets WHERE tenant_id=$1 AND processor='test'`, b.TenantID).Scan(&n)
		if err != nil || n != want {
			t.Fatal(n, want, err)
		}
	}
	count(1)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO stream_replay_gaps(tenant_id,connector_id,source,processor,message_id) VALUES($1,$2,$3,'test','1000-2'),($1,$2,$3,'test','1000-3')`, b.TenantID, b.ConnectorID, b.Source); err != nil {
		t.Fatal(err)
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	count(1)
	if _, err = s.Pool.Exec(ctx, `UPDATE stream_replay_gaps SET processor='other' WHERE tenant_id=$1`, b.TenantID); err == nil {
		t.Fatal("scope changed")
	}
	count(1)
	if _, err = s.Pool.Exec(ctx, `DELETE FROM stream_replay_gaps WHERE tenant_id=$1`, b.TenantID); err != nil {
		t.Fatal(err)
	}
	count(0)
}
