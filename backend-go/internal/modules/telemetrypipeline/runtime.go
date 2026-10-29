// Package telemetrypipeline joins durable state to the optional Redis transport.
// It owns no source connector or privileged action and is not started by core API.
package telemetrypipeline

import (
	"context"
	"errors"
	"regexp"
	"time"

	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/eventstate"
	"aisoc/backend/internal/platform/streams"
	"github.com/jackc/pgx/v5"
)

type Effect func(context.Context, pgx.Tx, telemetry.Event) error

var workerName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

type Runtime struct {
	Store                          eventstate.Store
	Publisher, Consumer            *streams.Client
	Binding                        telemetry.Binding
	Processor, ConsumerName        string
	MaxEntries, MaxRecoveryRecords int64
	MaxAttempts                    int
	ReadBatchSize                  int
}

func (r Runtime) validate() error {
	if r.ReadBatchSize < 0 || r.ReadBatchSize > 100 {
		return eventstate.ErrInvalid
	}
	if _, err := streams.Key(r.Binding); err != nil {
		return err
	}
	if r.Store.Pool == nil || r.Publisher == nil || r.Consumer == nil || !workerName.MatchString(r.Processor) || !workerName.MatchString(r.ConsumerName) || r.MaxEntries < 1 || r.MaxEntries > 100000 || r.MaxRecoveryRecords < 1 || r.MaxRecoveryRecords > 100000 || r.MaxAttempts < 1 || r.MaxAttempts > 10 {
		return eventstate.ErrInvalid
	}
	return nil
}

func (r Runtime) PublishOne(ctx context.Context) (bool, error) {
	if err := r.validate(); err != nil {
		return false, err
	}
	l, err := r.Store.Claim(ctx, r.Binding)
	if err != nil || l == nil {
		return false, err
	}
	return r.publishLease(ctx, *l)
}

// PublishBatch retains per-event fencing. Unattempted leases are released without
// spending attempts on failure; cancellation/crashes use normal lease recovery.
func (r Runtime) PublishBatch(ctx context.Context, limit int) (int, error) {
	if err := r.validate(); err != nil {
		return 0, err
	}
	leases, err := r.Store.ClaimBatch(ctx, r.Binding, limit)
	if err != nil {
		return 0, err
	}
	receipts := []eventstate.PublicationReceipt{}
	for i, l := range leases {
		e, err := telemetry.Decode(l.Envelope, r.Binding)
		if err == nil && (e.Identity() != l.EventKey || e.ContentHash() != l.ContentHash) {
			err = eventstate.ErrConflict
		}
		var messageID string
		if err == nil {
			messageID, err = r.Publisher.PublishBounded(ctx, r.Binding, e, r.MaxEntries)
		}
		if err != nil {
			published := 0
			if len(receipts) > 0 {
				if commitErr := r.Store.MarkPublishedBatch(ctx, r.Binding, receipts); commitErr != nil {
					err = errors.Join(err, commitErr)
				} else {
					published = len(receipts)
				}
			}
			if errors.Is(err, streams.ErrBackpressure) {
				err = errors.Join(err, r.Store.DeferPublication(ctx, r.Binding, l))
			} else {
				err = errors.Join(err, r.Store.Retry(ctx, r.Binding, l, eventstate.RetryDelay(l.Attempts)))
			}
			for _, unused := range leases[i+1:] {
				err = errors.Join(err, r.Store.DeferPublication(ctx, r.Binding, unused))
			}
			return published, err
		}
		receipts = append(receipts, eventstate.PublicationReceipt{Lease: l, MessageID: messageID})
	}
	if len(receipts) == 0 {
		return 0, nil
	}
	if err = r.Store.MarkPublishedBatch(ctx, r.Binding, receipts); err != nil {
		return 0, err
	}
	return len(receipts), nil
}

func (r Runtime) publishLease(ctx context.Context, l eventstate.Lease) (bool, error) {
	e, err := telemetry.Decode(l.Envelope, r.Binding)
	if err == nil && (e.Identity() != l.EventKey || e.ContentHash() != l.ContentHash) {
		err = eventstate.ErrConflict
	}
	var id string
	if err == nil {
		id, err = r.Publisher.PublishBounded(ctx, r.Binding, e, r.MaxEntries)
	}
	if errors.Is(err, streams.ErrBackpressure) {
		return false, errors.Join(err, r.Store.DeferPublication(ctx, r.Binding, l))
	}
	if err != nil {
		return false, errors.Join(err, r.Store.Retry(ctx, r.Binding, l, eventstate.RetryDelay(l.Attempts)))
	}
	if err = r.Store.MarkPublished(ctx, r.Binding, l, id); err != nil {
		return false, err
	}
	return true, nil
}

// Process never trusts Redis as the authority for accepted content. Poison and
// conflicting deliveries are quarantined by delivery ID, so a forged event cannot
// consume the retry budget or dead-letter the accepted legitimate event.
func (r Runtime) Process(ctx context.Context, d streams.Delivery, disposition string, effect Effect) error {
	if err := r.validate(); err != nil {
		return err
	}
	if effect == nil || (disposition != "filtered" && disposition != "finding" && disposition != "rejected") {
		return eventstate.ErrInvalid
	}
	key := "event:" + d.Key
	reason := ""
	if d.Err != nil {
		reason = "INVALID_DELIVERY"
	} else {
		err := r.Store.CheckAccepted(ctx, r.Binding, d.Key, d.ContentHash)
		switch {
		case errors.Is(err, eventstate.ErrNotFound):
			reason = "UNKNOWN_EVENT"
		case errors.Is(err, eventstate.ErrConflict), errors.Is(err, eventstate.ErrInvalid):
			reason = "CONTENT_CONFLICT"
		case err != nil:
			return err
		}
	}
	if reason != "" {
		key = "delivery:" + d.ID
	}
	w, err := r.Store.BeginWork(ctx, r.Binding, r.Processor, key, d.ID, r.MaxAttempts, r.MaxRecoveryRecords)
	if err != nil {
		return err
	}
	if w.State == "busy" {
		return nil
	}
	if w.State == "done" || w.State == "dead" {
		_, err = r.Consumer.Ack(ctx, r.Binding, r.Processor, d.ID)
		return err
	}
	if reason != "" {
		dead, err := r.Store.FailWork(ctx, r.Binding, r.Processor, w, d.ID, reason, true)
		if err != nil {
			return err
		}
		if dead {
			_, err = r.Consumer.Ack(ctx, r.Binding, r.Processor, d.ID)
		}
		return err
	}
	// Effects are DB-only and bounded below the durable 30-second work lease.
	workCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	applied, err := r.Store.Apply(workCtx, r.Binding, r.Processor, d.Key, d.ContentHash, disposition, func(ctx context.Context, tx pgx.Tx, e telemetry.Event) error {
		if err := eventstate.FenceWork(ctx, tx, r.Binding, r.Processor, w); err != nil {
			return err
		}
		if err := effect(ctx, tx, e); err != nil {
			return err
		}
		return eventstate.CompleteWork(ctx, tx, r.Binding, r.Processor, w)
	})
	cancel()
	if err == nil {
		if !applied {
			if err = r.Store.FinishReplay(ctx, r.Binding, r.Processor, w); err != nil {
				return err
			}
		}
		_, err = r.Consumer.Ack(ctx, r.Binding, r.Processor, d.ID)
		return err
	}
	if errors.Is(err, eventstate.ErrLease) || ctx.Err() != nil {
		return err
	}
	permanent := errors.Is(err, eventstate.ErrConflict) || errors.Is(err, eventstate.ErrNotFound)
	failureReason := "HANDLER_FAILED"
	if permanent {
		failureReason = "CONTENT_CONFLICT"
	}
	dead, saveErr := r.Store.FailWork(ctx, r.Binding, r.Processor, w, d.ID, failureReason, permanent)
	if saveErr != nil {
		return errors.Join(err, saveErr)
	}
	if dead {
		_, ackErr := r.Consumer.Ack(ctx, r.Binding, r.Processor, d.ID)
		return errors.Join(err, ackErr)
	}
	return err
}

func (r Runtime) Poll(ctx context.Context, disposition string, effect Effect) error {
	if err := r.validate(); err != nil {
		return err
	}
	if err := r.Consumer.EnsureGroup(ctx, r.Binding, r.Processor); err != nil {
		return err
	}
	count := r.ReadBatchSize
	if count == 0 {
		count = 10
	}
	deliveries, err := r.Consumer.Read(ctx, r.Binding, r.Processor, r.ConsumerName, count, 100*time.Millisecond)
	if err != nil {
		return err
	}
	return r.ProcessBatch(ctx, deliveries, disposition, effect)
}

// ProcessBatch shares the polling commit/ACK boundary with benchmarks and adapters.
func (r Runtime) ProcessBatch(ctx context.Context, deliveries []streams.Delivery, disposition string, effect Effect) error {
	if err := r.validate(); err != nil {
		return err
	}
	if len(deliveries) > 100 {
		return eventstate.ErrInvalid
	}
	if len(deliveries) > 1 && effect != nil {
		input := make([]eventstate.BatchEvent, 0, len(deliveries))
		ids := make([]string, 0, len(deliveries))
		for _, d := range deliveries {
			if d.Err != nil {
				break
			}
			input = append(input, eventstate.BatchEvent{Key: d.Key, Hash: d.ContentHash})
			ids = append(ids, d.ID)
		}
		if len(input) == len(deliveries) {
			batchCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			applied, _ := r.Store.ApplyFreshBatch(batchCtx, r.Binding, r.Processor, input, disposition, r.MaxAttempts, r.MaxRecoveryRecords, effect)
			cancel()
			if applied {
				_, err := r.Consumer.Ack(ctx, r.Binding, r.Processor, ids...)
				return err
			}
			// A rolled-back batch is isolated through the established per-event
			// retry/DLQ path. No external side effects are allowed in either path.
		}
	}
	var errs []error
	for _, d := range deliveries {
		if err := r.Process(ctx, d, disposition, effect); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// Recover returns the reclaim cursor to the caller. Its idle threshold exceeds
// handler/work leases. Call on a bounded schedule; a busy retry never spends an attempt.
func (r Runtime) Recover(ctx context.Context, start, disposition string, effect Effect) (string, error) {
	if err := r.validate(); err != nil {
		return start, err
	}
	if err := r.Consumer.EnsureGroup(ctx, r.Binding, r.Processor); err != nil {
		return start, err
	}
	page, err := r.Consumer.Reclaim(ctx, r.Binding, r.Processor, r.ConsumerName, start, 10, 35*time.Second)
	if err != nil {
		return start, err
	}
	var errs []error
	for _, id := range page.DeletedIDs {
		if err := r.Store.RecordGap(ctx, r.Binding, r.Processor, id, r.MaxRecoveryRecords); err != nil {
			errs = append(errs, err)
		}
	}
	for _, d := range page.Deliveries {
		if err := r.Process(ctx, d, disposition, effect); err != nil {
			errs = append(errs, err)
		}
	}
	return page.Next, errors.Join(errs...)
}

// Reconcile does not rely on Redis retaining its pending list: scan durable
// unfinished publications after total stream/group loss. Redis errors are never absence.
func (r Runtime) Reconcile(ctx context.Context, after string) (string, error) {
	if err := r.validate(); err != nil {
		return after, err
	}
	if err := r.Consumer.EnsureGroup(ctx, r.Binding, r.Processor); err != nil {
		return after, err
	}
	publications, err := r.Store.Publications(ctx, r.Binding, r.Processor, after)
	if err != nil {
		return after, err
	}
	for _, p := range publications {
		d, err := r.Consumer.Entry(ctx, r.Binding, p.MessageID)
		if err != nil {
			return after, err
		}
		if d == nil || d.Err != nil || d.Key != p.Key || d.ContentHash != p.ContentHash {
			if err = r.Store.ReplayMissing(ctx, r.Binding, r.Processor, p, r.MaxRecoveryRecords); err != nil {
				return after, err
			}
		}
		after = p.Key
	}
	if len(publications) < 100 {
		return "", nil
	}
	return after, nil
}
