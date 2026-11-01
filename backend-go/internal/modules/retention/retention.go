// Package retention coordinates explicit archive snapshots, never domain erasure.
package retention

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	ql "aisoc/backend/internal/modules/investigations/investigationsql"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ Pool *pgxpool.Pool }

var Kinds = []string{"detection", "investigation", "response", "hunt", "intel", "skill", "memory", "integration", "import_batch", "notification"}

func valid(k string) bool {
	for _, v := range Kinds {
		if k == v {
			return true
		}
	}
	return false
}
func invalid() error {
	return fault.New(400, "INVALID_RETENTION", "Use a supported kind, current preview, confirmation and a 10–1000 character reason.")
}
func conflict() error {
	return fault.New(409, "RETENTION_CHANGED", "Policy or record changed, or this record is protected. Refresh the preview.")
}
func missing(e error) error {
	if errors.Is(e, pgx.ErrNoRows) {
		return fault.New(404, "RETENTION_NOT_FOUND", "Retention record not found.")
	}
	return e
}
func digest(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func policy(ctx context.Context, q *ql.Queries, t, k string) (ql.RetentionPolicy, error) {
	p, e := q.RetentionPolicy(ctx, ql.RetentionPolicyParams{TenantID: t, Kind: k})
	if errors.Is(e, pgx.ErrNoRows) {
		return ql.RetentionPolicy{Kind: k, AgeDays: 30}, nil
	}
	return p, e
}
func policyView(p ql.RetentionPolicy) map[string]any {
	return map[string]any{"kind": p.Kind, "enabled": p.Enabled, "age_days": p.AgeDays, "version": p.Version}
}
func reason(r ql.RetentionRecord, p ql.RetentionPolicy) string {
	if !r.Eligible {
		return "Active, unread or unresolved record"
	}
	if !p.Enabled {
		return "Archive policy disabled"
	}
	if !r.Touched.Valid || r.Touched.Time.After(time.Now().Add(-time.Duration(p.AgeDays)*24*time.Hour)) {
		return "Inside retention window"
	}
	if len(r.Document) > 2*1024*1024 {
		return "Snapshot exceeds 2 MiB local limit"
	}
	return ""
}
func (s Store) Preview(ctx context.Context, t, a, k string, offset int) (map[string]any, error) {
	if !valid(k) || offset < 0 || offset > 1000000 {
		return nil, invalid()
	}
	q := ql.New(s.Pool)
	p, e := policy(ctx, q, t, k)
	if e != nil {
		return nil, e
	}
	rows, e := q.RetentionRecords(ctx, ql.RetentionRecordsParams{TenantID: t, Kind: k, RecipientID: a, PageLimit: 26, PageOffset: int32(offset)})
	if e != nil {
		return nil, e
	}
	more := len(rows) > 25
	if more {
		rows = rows[:25]
	}
	items := []map[string]any{}
	for _, r := range rows {
		blocked := reason(r, p)
		items = append(items, map[string]any{"id": r.ID, "title": r.Title, "touched": r.Touched, "digest": digest(r.Document), "eligible": blocked == "", "protected_reason": blocked, "bytes": len(r.Document)})
	}
	snapshots, e := q.RetentionSnapshots(ctx, ql.RetentionSnapshotsParams{TenantID: t, Kind: k, RecipientID: a, PageOffset: int32(offset)})
	if e != nil {
		return nil, e
	}
	history := []map[string]any{}
	for _, r := range snapshots {
		history = append(history, map[string]any{"id": r.ID, "resource_id": r.ResourceID, "title": r.Title, "digest": r.Digest, "actor": r.Actor, "created_at": r.CreatedAt})
	}
	return map[string]any{"mode": "local/mock", "kinds": Kinds, "policy": policyView(p), "items": items, "more": more, "snapshots": history, "offset": offset, "snapshot_limit": 1000}, nil
}

type PolicyInput struct {
	Kind            string `json:"kind"`
	Enabled         bool   `json:"enabled"`
	AgeDays         int32  `json:"age_days"`
	ExpectedVersion int32  `json:"expected_version"`
	Reason          string `json:"reason"`
}

func goodReason(s string) bool {
	return len(strings.TrimSpace(s)) >= 10 && len(s) <= 1000 && !strings.ContainsRune(s, 0)
}
func audit(ctx context.Context, q *ql.Queries, t, a, id, op string, details any) error {
	b, _ := json.Marshal(map[string]any{"actor": a, "details": details})
	return q.RetentionAudit(ctx, ql.RetentionAuditParams{TenantID: t, ID: jobs.ID(), ResourceID: id, Action: "retention_" + op, Details: b})
}
func (s Store) Configure(ctx context.Context, t, a string, in PolicyInput) (map[string]any, error) {
	if !valid(in.Kind) || in.AgeDays < 1 || in.AgeDays > 3650 || !goodReason(in.Reason) || in.ExpectedVersion < 0 {
		return nil, invalid()
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	q := ql.New(tx)
	if e = q.RetentionCoordinationLock(ctx, t+":retention"); e != nil {
		return nil, e
	}
	p, e := policy(ctx, q, t, in.Kind)
	if e != nil {
		return nil, e
	}
	if p.Version != in.ExpectedVersion {
		return nil, conflict()
	}
	p, e = q.SaveRetentionPolicy(ctx, ql.SaveRetentionPolicyParams{TenantID: t, Kind: in.Kind, Enabled: in.Enabled, AgeDays: in.AgeDays, UpdatedBy: a})
	if e != nil {
		return nil, e
	}
	if e = audit(ctx, q, t, a, in.Kind, "policy", in); e != nil {
		return nil, e
	}
	return policyView(p), tx.Commit(ctx)
}

type ActionInput struct {
	Kind          string `json:"kind"`
	ID            string `json:"id"`
	Digest        string `json:"digest"`
	PolicyVersion int32  `json:"policy_version"`
	Operation     string `json:"operation"`
	Confirm       bool   `json:"confirm"`
	Reason        string `json:"reason"`
}

func snapshotView(r ql.RetentionSnapshot) map[string]any {
	return map[string]any{"id": r.ID, "kind": r.Kind, "resource_id": r.ResourceID, "title": r.Title, "digest": r.Digest, "document": json.RawMessage(r.Document), "actor": r.Actor, "reason": r.Reason, "created_at": r.CreatedAt}
}
func (s Store) Snapshot(ctx context.Context, t, a, id string) (map[string]any, error) {
	r, e := ql.New(s.Pool).RetentionSnapshot(ctx, ql.RetentionSnapshotParams{TenantID: t, ID: id, RecipientID: a})
	if e != nil {
		return nil, missing(e)
	}
	if digest(r.Document) != r.Digest {
		return nil, fault.New(409, "ARCHIVE_INTEGRITY", "Archive digest verification failed.")
	}
	return snapshotView(r), nil
}
func (s Store) Act(ctx context.Context, t, a string, in ActionInput) (map[string]any, error) {
	if !valid(in.Kind) || len(in.ID) < 1 || len(in.ID) > 600 || len(in.Digest) != 64 || !in.Confirm || !goodReason(in.Reason) || (in.Operation != "archive" && in.Operation != "cleanup" && in.Operation != "restore") {
		return nil, invalid()
	}
	if in.Operation != "archive" && in.Kind != "notification" {
		return nil, invalid()
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	q := ql.New(tx)
	if e = q.RetentionCoordinationLock(ctx, t+":retention"); e != nil {
		return nil, e
	}
	if in.Operation == "restore" {
		snap, e := q.RetentionSnapshot(ctx, ql.RetentionSnapshotParams{TenantID: t, ID: in.ID, RecipientID: a})
		if e != nil {
			return nil, missing(e)
		}
		if snap.Kind != "notification" || snap.Digest != in.Digest || digest(snap.Document) != snap.Digest {
			return nil, conflict()
		}
		n, e := q.RetentionNotificationRestore(ctx, ql.RetentionNotificationRestoreParams{Snapshot: snap.Document, TenantID: t, RecipientID: a})
		if e != nil {
			return nil, e
		}
		current, e := q.RetentionRecord(ctx, ql.RetentionRecordParams{TenantID: t, Kind: "notification", ID: snap.ResourceID, RecipientID: a})
		if e != nil {
			return nil, missing(e)
		}
		if digest(current.Document) != snap.Digest {
			return nil, conflict()
		}
		if n > 0 {
			if e = audit(ctx, q, t, a, snap.ID, "restore", in); e != nil {
				return nil, e
			}
		}
		return map[string]any{"restored": true, "replayed": n == 0}, tx.Commit(ctx)
	}
	p, e := policy(ctx, q, t, in.Kind)
	if e != nil {
		return nil, e
	}
	if p.Version != in.PolicyVersion {
		return nil, conflict()
	}
	if in.Kind == "notification" {
		if _, e = q.RetentionNotificationLock(ctx, ql.RetentionNotificationLockParams{TenantID: t, ID: in.ID, RecipientID: a}); e != nil {
			if errors.Is(e, pgx.ErrNoRows) && in.Operation == "cleanup" && p.Enabled {
				saved, lookup := q.RetentionSnapshotByDigest(ctx, ql.RetentionSnapshotByDigestParams{TenantID: t, Kind: in.Kind, ResourceID: in.ID, Digest: in.Digest})
				if lookup == nil && saved.RecipientID == a && digest(saved.Document) == in.Digest {
					return map[string]any{"removed": 0, "archive_id": saved.ID, "replayed": true}, tx.Commit(ctx)
				}
			}
			return nil, missing(e)
		}
	}
	r, e := q.RetentionRecord(ctx, ql.RetentionRecordParams{TenantID: t, Kind: in.Kind, ID: in.ID, RecipientID: a})
	if e != nil {
		return nil, missing(e)
	}
	if reason(r, p) != "" || digest(r.Document) != in.Digest {
		return nil, conflict()
	}
	old, lookup := q.RetentionSnapshotByDigest(ctx, ql.RetentionSnapshotByDigestParams{TenantID: t, Kind: in.Kind, ResourceID: in.ID, Digest: in.Digest})
	if lookup != nil && !errors.Is(lookup, pgx.ErrNoRows) {
		return nil, lookup
	}
	if in.Operation == "cleanup" {
		if lookup != nil || digest(old.Document) != in.Digest {
			return nil, conflict()
		}
		n, e := q.RetentionNotificationDelete(ctx, ql.RetentionNotificationDeleteParams{TenantID: t, ID: in.ID, RecipientID: a, Snapshot: old.Document})
		if e != nil {
			return nil, e
		}
		if n != 1 {
			return nil, conflict()
		}
		if e = audit(ctx, q, t, a, in.ID, "cleanup", in); e != nil {
			return nil, e
		}
		return map[string]any{"removed": n, "archive_id": old.ID}, tx.Commit(ctx)
	}
	if lookup == nil {
		if digest(old.Document) != in.Digest {
			return nil, fault.New(409, "ARCHIVE_INTEGRITY", "Archive digest verification failed.")
		}
		return map[string]any{"archive": snapshotView(old), "replayed": true}, tx.Commit(ctx)
	}
	count, e := q.RetentionSnapshotCount(ctx, t)
	if e != nil {
		return nil, e
	}
	if count >= 1000 {
		return nil, fault.New(409, "ARCHIVE_QUOTA", "Local archive limit reached. Preserve backups before planning further retention.")
	}
	saved, e := q.SaveRetentionSnapshot(ctx, ql.SaveRetentionSnapshotParams{TenantID: t, ID: jobs.ID(), Kind: in.Kind, ResourceID: in.ID, RecipientID: r.RecipientID, Title: r.Title, Digest: in.Digest, Document: r.Document, Actor: a, Reason: in.Reason})
	if e != nil {
		return nil, e
	}
	if e = audit(ctx, q, t, a, saved.ID, "archive", in); e != nil {
		return nil, e
	}
	return map[string]any{"archive": snapshotView(saved), "replayed": false}, tx.Commit(ctx)
}
