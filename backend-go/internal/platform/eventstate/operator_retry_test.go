package eventstate

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/jobs"
)

func TestOperatorPublicationRetryFencesAndAudit(t *testing.T) {
	s, b, e := setup(t)
	ctx := context.Background()
	t.Cleanup(func() {
		_, err := s.Pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, b.TenantID)
		if err != nil {
			t.Error(err)
		}
	})
	cp := accept(t, s, b, Checkpoint{}, "page", e).Checkpoint
	if _, err := s.Pool.Exec(ctx, `UPDATE stream_outbox SET max_attempts=1 WHERE tenant_id=$1`, b.TenantID); err != nil {
		t.Fatal(err)
	}
	fail := func() Lease {
		t.Helper()
		l, err := s.Claim(ctx, b)
		if err != nil || l == nil {
			t.Fatal(l, err)
		}
		if err = s.Retry(ctx, b, *l, time.Second); err != nil {
			t.Fatal(err)
		}
		return *l
	}
	l := fail()
	actor := auth.Principal{ID: "operator-1", Tenant: b.TenantID}
	o := OperatorRecovery{Store: s, Grants: []RecoveryGrant{{Operator: actor, Binding: b}}}
	req := PublicationRetry{RequestID: "review-1", EventKey: e.Identity(), ExpectedAttemptID: l.AttemptID, ExpectedAttempts: 1, Reason: "transport_restored", Ticket: "INC-123"}
	if _, err := (OperatorRecovery{Store: s}).RetryPublication(ctx, actor, b, req); !errors.Is(err, ErrRecoveryDenied) {
		t.Fatal(err)
	}
	foreign := actor
	foreign.Tenant = "other-tenant"
	if _, err := o.RetryPublication(ctx, foreign, b, req); !errors.Is(err, ErrRecoveryDenied) {
		t.Fatal(err)
	}
	otherSource := b
	otherSource.ConnectorID = "other-connector"
	if _, err := o.RetryPublication(ctx, actor, otherSource, req); !errors.Is(err, ErrRecoveryDenied) {
		t.Fatal(err)
	}
	invalid := req
	invalid.Reason = "ignore-policy"
	if _, err := o.RetryPublication(ctx, actor, b, invalid); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	stale := req
	stale.ExpectedAttemptID = ""
	if _, err := o.RetryPublication(ctx, actor, b, stale); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan bool, 2)
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			replay, err := o.RetryPublication(ctx, actor, b, req)
			results <- replay
			errs <- err
		}()
	}
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	replays := 0
	for replay := range results {
		if replay {
			replays++
		}
	}
	if replays != 1 {
		t.Fatal(replays)
	}
	changed := req
	changed.Ticket = "different-review"
	if _, err := o.RetryPublication(ctx, actor, b, changed); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	checkpoint(t, s, b, cp)
	for generation := 1; generation <= 3; generation++ {
		l = fail()
		req.RequestID = fmt.Sprintf("review-%d", generation+1)
		req.ExpectedAttemptID = l.AttemptID
		req.ExpectedOperatorRetries = generation
		_, err := o.RetryPublication(ctx, actor, b, req)
		if generation == 3 {
			if !errors.Is(err, ErrCapacity) {
				t.Fatal(err)
			}
		} else if err != nil {
			t.Fatal(err)
		}
	}
	var audits int
	if err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND action='stream_publication_retry'`, b.TenantID).Scan(&audits); err != nil || audits != 3 {
		t.Fatal(audits, err)
	}
	counts(t, s, b, 1, 1, 0)
}

func TestOperatorRetryAuditFailureAndCompletedRejection(t *testing.T) {
	s, b, e := setup(t)
	ctx := context.Background()
	t.Cleanup(func() {
		_, err := s.Pool.Exec(ctx, `DELETE FROM audit_events WHERE tenant_id=$1`, b.TenantID)
		if err != nil {
			t.Error(err)
		}
	})
	accept(t, s, b, Checkpoint{}, "page", e)
	if _, err := s.Pool.Exec(ctx, `UPDATE stream_outbox SET max_attempts=1 WHERE tenant_id=$1`, b.TenantID); err != nil {
		t.Fatal(err)
	}
	l, err := s.Claim(ctx, b)
	if err != nil || l == nil {
		t.Fatal(l, err)
	}
	if err = s.Retry(ctx, b, *l, time.Second); err != nil {
		t.Fatal(err)
	}
	actor := auth.Principal{ID: "operator-1", Tenant: b.TenantID}
	o := OperatorRecovery{Store: s, Grants: []RecoveryGrant{{Operator: actor, Binding: b}}}
	req := PublicationRetry{RequestID: "audit-failure", EventKey: e.Identity(), ExpectedAttemptID: l.AttemptID, ExpectedAttempts: 1, Reason: "configuration_corrected", Ticket: "INC-456"}
	name := "reject_retry_" + fmt.Sprintf("%x", jobs.ID())
	if _, err = s.Pool.Exec(ctx, `CREATE FUNCTION `+name+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='`+b.TenantID+`' AND NEW.action='stream_publication_retry' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, err := s.Pool.Exec(ctx, `DROP FUNCTION `+name+`() CASCADE`)
		if err != nil {
			t.Error(err)
		}
	})
	if _, err = s.Pool.Exec(ctx, `CREATE TRIGGER `+name+` BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION `+name+`() `); err != nil {
		t.Fatal(err)
	}
	if _, err = o.RetryPublication(ctx, actor, b, req); err == nil {
		t.Fatal("audit failure accepted")
	}
	var state string
	if err = s.Pool.QueryRow(ctx, `SELECT state FROM stream_outbox WHERE tenant_id=$1`, b.TenantID).Scan(&state); err != nil || state != "failed" {
		t.Fatal(state, err)
	}
	if _, err = s.Pool.Exec(ctx, `DROP TRIGGER `+name+` ON audit_events`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `INSERT INTO stream_inbox(tenant_id,connector_id,source,processor,event_key,content_hash,disposition) VALUES($1,$2,$3,'test',$4,$5,'filtered')`, b.TenantID, b.ConnectorID, b.Source, e.Identity(), e.ContentHash()); err != nil {
		t.Fatal(err)
	}
	if _, err = o.RetryPublication(ctx, actor, b, req); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
}
