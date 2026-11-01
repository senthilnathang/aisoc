package localintegrations

import (
	"aisoc/backend/internal/modules/localintegrations/localsql"
	"aisoc/backend/internal/platform/eventstate"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"io"
	"regexp"
	"strings"
	"time"
)

const MaxBatchCases = 10
const MaxBatchBytes = 512 << 10

var batchID = regexp.MustCompile(`^batch-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var caseKey = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`)

type BatchCase struct {
	Key      string          `json:"key"`
	Name     string          `json:"name"`
	Document json.RawMessage `json:"document"`
}
type BatchInput struct {
	SchemaVersion string      `json:"schema_version"`
	ID            string      `json:"id"`
	ScopeID       string      `json:"scope_id"`
	Name          string      `json:"name"`
	Cases         []BatchCase `json:"cases"`
}
type CasePreview struct {
	Key       string         `json:"key"`
	ProfileID string         `json:"profile_id"`
	Valid     bool           `json:"valid"`
	ErrorCode string         `json:"error_code,omitempty"`
	Evidence  *PreviewResult `json:"evidence,omitempty"`
}

func quota() error {
	return fault.New(409, "LOCAL_RETENTION_QUOTA", "Retained local-record quota reached. Archive does not delete records or free quota; ask the administrator to review configured limits.")
}
func batchInvalid() error {
	return fault.New(400, "INVALID_IMPORT_BATCH", "Use schema_version 1, a batch UUID, unique case keys, 1–10 cases and a manifest no larger than 512 KiB with no NUL characters.")
}
func profileFor(tenant, batch, key string) string {
	raw, _ := json.Marshal([]string{tenant, batch, key})
	h := sha256.Sum256(raw)
	return fmt.Sprintf("build-%x-%x-%x-%x-%x", h[0:4], h[4:6], h[6:8], h[8:10], h[10:16])
}
func decodeCase(raw json.RawMessage) (Document, error) {
	var d Document
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if e := dec.Decode(&d); e != nil {
		return d, Invalid()
	}
	if e := dec.Decode(new(any)); e != io.EOF {
		return d, Invalid()
	}
	return d, nil
}
func previewCase(tenant, batch string, c BatchCase) (CasePreview, Document) {
	p := CasePreview{Key: c.Key, ProfileID: profileFor(tenant, batch, c.Key)}
	d, e := decodeCase(c.Document)
	if e == nil && (len(strings.TrimSpace(c.Name)) < 1 || len(c.Name) > 120 || strings.ContainsRune(c.Name, 0)) {
		e = Invalid()
	}
	if e == nil {
		v, err := Preview(d, Binding(tenant, p.ProfileID), time.Now())
		e = err
		if e == nil {
			d.Events = v.Events
			p.Valid = true
			p.Evidence = &v
		}
	}
	if e != nil {
		p.ErrorCode = "INVALID_LOCAL_EVIDENCE"
	}
	return p, d
}

// PostgreSQL jsonb cannot represent NUL. Reject it before retaining a manifest,
// including invalid cases, so one unsupported character cannot cause a storage error.
func hasNUL(v any) bool {
	switch x := v.(type) {
	case string:
		return strings.ContainsRune(x, 0)
	case []any:
		for _, v := range x {
			if hasNUL(v) {
				return true
			}
		}
	case map[string]any:
		for k, v := range x {
			if strings.ContainsRune(k, 0) || hasNUL(v) {
				return true
			}
		}
	}
	return false
}
func PreviewBatch(tenant string, in BatchInput) ([]CasePreview, error) {
	raw, e := json.Marshal(in)
	if e != nil || len(raw) > MaxBatchBytes || in.SchemaVersion != "1" || !batchID.MatchString(in.ID) || len(in.Cases) < 1 || len(in.Cases) > MaxBatchCases || len(strings.TrimSpace(in.Name)) < 1 || len(in.Name) > 120 || strings.ContainsRune(in.Name, 0) {
		return nil, batchInvalid()
	}
	var envelope any
	if json.Unmarshal(raw, &envelope) != nil || hasNUL(envelope) {
		return nil, batchInvalid()
	}
	seen := map[string]bool{}
	out := []CasePreview{}
	for _, c := range in.Cases {
		if !caseKey.MatchString(c.Key) || seen[c.Key] || len(c.Document) > 65536 {
			return nil, batchInvalid()
		}
		seen[c.Key] = true
		p, _ := previewCase(tenant, in.ID, c)
		out = append(out, p)
	}
	return out, nil
}
func (s Store) CreateBatch(ctx context.Context, tenant, actor string, in BatchInput) (map[string]any, error) {
	previews, e := PreviewBatch(tenant, in)
	if e != nil {
		return nil, e
	}
	raw, _ := json.Marshal(in)
	h := sha256.Sum256(raw)
	hash := hex.EncodeToString(h[:])
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	q := localsql.New(tx)
	if e = q.EnsureTenant(ctx, tenant); e != nil {
		return nil, e
	}
	if _, e = q.LockTenant(ctx, tenant); e != nil {
		return nil, e
	}
	old, e := q.GetImportBatch(ctx, localsql.GetImportBatchParams{TenantID: tenant, ID: in.ID})
	replay := false
	if e == nil {
		if old.RequestHash != hash || old.ScopeID != in.ScopeID {
			return nil, Conflict()
		}
		replay = true
	} else if !errors.Is(e, pgx.ErrNoRows) {
		return nil, e
	} else {
		count, e := q.CountImportBatches(ctx, tenant)
		if e != nil {
			return nil, e
		}
		if count >= int64(s.BatchLimit()) {
			return nil, quota()
		}
		if e = q.InsertImportBatch(ctx, localsql.InsertImportBatchParams{TenantID: tenant, ID: in.ID, ScopeID: in.ScopeID, Name: in.Name, RequestHash: hash, Actor: actor}); e != nil {
			return nil, e
		}
		for i, c := range in.Cases {
			p := previews[i]
			state := "invalid"
			_, d := previewCase(tenant, in.ID, c)
			doc, _ := json.Marshal(d) // Persist typed fields only, never unknown fields from invalid JSON.
			if p.Valid {
				state = "pending"
			}
			if e = q.InsertImportItem(ctx, localsql.InsertImportItemParams{TenantID: tenant, BatchID: in.ID, CaseKey: c.Key, ProfileID: p.ProfileID, Name: c.Name, Document: doc, State: state, ErrorCode: p.ErrorCode}); e != nil {
				return nil, e
			}
		}
		details, _ := json.Marshal(map[string]any{"actor": actor, "cases": len(in.Cases), "scope": in.ScopeID})
		if e = q.AuditProfile(ctx, localsql.AuditProfileParams{TenantID: tenant, ID: jobs.ID(), ResourceID: in.ID, Action: "local_batch_created", Details: details}); e != nil {
			return nil, e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	out, e := s.Batch(ctx, tenant, in.ID)
	if e == nil {
		out["replayed"] = replay
	}
	return out, e
}
func (s Store) Batch(ctx context.Context, tenant, id string) (map[string]any, error) {
	q := localsql.New(s.Pool)
	b, e := q.GetImportBatch(ctx, localsql.GetImportBatchParams{TenantID: tenant, ID: id})
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, fault.New(404, "IMPORT_BATCH_NOT_FOUND", "Local batch not found.")
	}
	if e != nil {
		return nil, e
	}
	items, e := q.ImportItems(ctx, localsql.ImportItemsParams{TenantID: tenant, BatchID: id})
	if e != nil {
		return nil, e
	}
	out := []map[string]any{}
	counts := map[string]int{"total": len(items), "pending": 0, "invalid": 0, "running": 0, "failed": 0, "accepted": 0, "synced": 0}
	for _, item := range items {
		var doc any
		if e = json.Unmarshal(item.Document, &doc); e != nil {
			return nil, e
		}
		raw, e := q.ImportItemProgress(ctx, localsql.ImportItemProgressParams{TenantID: tenant, ConnectorID: item.ProfileID})
		if e != nil {
			return nil, e
		}
		var progress map[string]any
		if e = json.Unmarshal(raw, &progress); e != nil {
			return nil, e
		}
		counts[item.State]++
		for _, v := range progress["cases"].([]any) {
			if v.(map[string]any)["state"] == "synced" {
				counts["synced"]++
				break
			}
		}
		out = append(out, map[string]any{"key": item.CaseKey, "profile_id": item.ProfileID, "name": item.Name, "document": doc, "version": item.Version, "state": item.State, "error_code": item.ErrorCode, "attempts": item.Attempts, "lease_until": item.LeaseUntil, "inserted": item.AcceptedInserted, "progress": progress})
	}
	return map[string]any{"id": b.ID, "name": b.Name, "scope_id": b.ScopeID, "actor": b.Actor, "created_at": b.CreatedAt, "items": out, "counts": counts, "mode": "local/mock", "profile_limit": s.ProfileLimit(), "batch_limit": s.BatchLimit()}, nil
}
func (s Store) RepairBatchCase(ctx context.Context, tenant, actor, batch, key string, expected int32, c BatchCase) (map[string]any, error) {
	if len(c.Document) > 65536 || expected < 1 {
		return nil, batchInvalid()
	}
	c.Key = key
	p, d := previewCase(tenant, batch, c)
	if !p.Valid {
		return nil, Invalid()
	}
	raw, _ := json.Marshal(d)
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	q := localsql.New(tx)
	row, e := q.LockImportItem(ctx, localsql.LockImportItemParams{TenantID: tenant, BatchID: batch, CaseKey: key})
	if e != nil {
		return nil, Conflict()
	}
	oldDoc, _ := decodeCase(row.Document)
	oldRaw, _ := json.Marshal(oldDoc)
	if row.State == "pending" && row.Version == expected+1 && row.Name == c.Name && bytes.Equal(oldRaw, raw) {
		if e = tx.Commit(ctx); e != nil {
			return nil, e
		}
		return s.Batch(ctx, tenant, batch)
	}
	if row.Version != expected || (row.State != "invalid" && row.State != "failed" && row.State != "pending") {
		return nil, Conflict()
	}
	if _, e = q.GetProfile(ctx, localsql.GetProfileParams{TenantID: tenant, ID: row.ProfileID}); !errors.Is(e, pgx.ErrNoRows) {
		if e != nil {
			return nil, e
		}
		return nil, Conflict()
	}
	if _, e = q.RepairImportItem(ctx, localsql.RepairImportItemParams{TenantID: tenant, BatchID: batch, CaseKey: key, Name: c.Name, Document: raw, State: "pending", ErrorCode: ""}); e != nil {
		return nil, e
	}
	details, _ := json.Marshal(map[string]any{"actor": actor, "case_key": key, "version": expected + 1})
	if e = q.AuditProfile(ctx, localsql.AuditProfileParams{TenantID: tenant, ID: jobs.ID(), ResourceID: batch, Action: "local_batch_case_repaired", Details: details}); e != nil {
		return nil, e
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	return s.Batch(ctx, tenant, batch)
}
func safeImportError(e error) string {
	var f *fault.Error
	if errors.As(e, &f) {
		return f.Code
	}
	if errors.Is(e, eventstate.ErrCapacity) {
		return "LOCAL_RETENTION_QUOTA"
	}
	return "IMPORT_INTERRUPTED"
}

// ProcessBatch only advances intake. Existing workers own investigation and mock-note approval.
// A claim expires after 60s; per-case I/O is bounded to 2s, with an 8s work
// budget and 12s request ceiling (below the API write timeout). A crash after Accept
// is recovered by replaying the same sealed profile and event identities.
func (s Store) ProcessBatch(ctx context.Context, tenant, actor, id string, expected ...map[string]int32) (map[string]any, error) {
	ctx, cancelRequest := context.WithTimeout(ctx, 12*time.Second)
	defer cancelRequest()
	workUntil := time.Now().Add(8 * time.Second)
	q := localsql.New(s.Pool)
	b, e := q.GetImportBatch(ctx, localsql.GetImportBatchParams{TenantID: tenant, ID: id})
	if e != nil {
		return nil, e
	}
	items, e := q.ImportItems(ctx, localsql.ImportItemsParams{TenantID: tenant, BatchID: id})
	if e != nil {
		return nil, e
	}
	if len(expected) > 0 {
		if len(expected[0]) != len(items) {
			return nil, Conflict()
		}
		for _, item := range items {
			if expected[0][item.CaseKey] != item.Version {
				return nil, Conflict()
			}
		}
	}
	for _, initial := range items {
		if time.Now().After(workUntil) {
			break
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		token := jobs.ID()
		item, e := q.ClaimImportItem(ctx, localsql.ClaimImportItemParams{TenantID: tenant, BatchID: id, CaseKey: initial.CaseKey, ClaimToken: token, Version: initial.Version})
		if errors.Is(e, pgx.ErrNoRows) {
			continue
		}
		if e != nil {
			return nil, e
		}
		attemptUntil := time.Now().Add(2 * time.Second)
		if workUntil.Before(attemptUntil) {
			attemptUntil = workUntil
		}
		attempt, cancel := context.WithDeadline(ctx, attemptUntil)
		inserted, err := s.importBatchItem(attempt, tenant, actor, b.ScopeID, item)
		cancel()
		state, code := "accepted", ""
		if err != nil {
			state = "failed"
			code = safeImportError(err)
		}
		tx, e := s.Pool.Begin(ctx)
		if e != nil {
			return nil, e
		}
		tq := localsql.New(tx)
		_, e = tq.FinishImportItem(ctx, localsql.FinishImportItemParams{TenantID: tenant, BatchID: id, CaseKey: item.CaseKey, ClaimToken: token, State: state, ErrorCode: code, AcceptedInserted: int32(inserted)})
		if e == nil {
			details, _ := json.Marshal(map[string]any{"actor": actor, "case_key": item.CaseKey, "state": state, "error_code": code, "inserted": inserted})
			e = tq.AuditProfile(ctx, localsql.AuditProfileParams{TenantID: tenant, ID: jobs.ID(), ResourceID: id, Action: "local_batch_case_processed", Details: details})
		}
		if e != nil {
			tx.Rollback(ctx)
			if errors.Is(e, pgx.ErrNoRows) {
				continue
			}
			return nil, e
		}
		if e = tx.Commit(ctx); e != nil {
			return nil, e
		}
	}
	return s.Batch(ctx, tenant, id)
}
func (s Store) importBatchItem(ctx context.Context, tenant, actor, scope string, item localsql.LocalImportBatchItem) (int, error) {
	d, e := decodeCase(item.Document)
	if e != nil {
		return 0, e
	}
	p, e := s.Get(ctx, tenant, item.ProfileID)
	var f *fault.Error
	if errors.As(e, &f) && f.Status == 404 {
		p, e = s.Save(ctx, tenant, actor, item.ProfileID, scope, item.Name, 0, d)
	}
	if e != nil {
		return 0, e
	}
	original, _ := json.Marshal(d)
	current, _ := json.Marshal(p.Document)
	if p.ScopeID != scope || p.Name != item.Name || p.Version != 1 || !bytes.Equal(original, current) {
		return 0, Conflict()
	}
	p, e = s.Seal(ctx, tenant, actor, p.ID, scope, p.Version)
	if e != nil {
		return 0, e
	}
	binding := Binding(tenant, p.ID)
	preview, e := Preview(p.Document, binding, time.Now())
	if e != nil {
		return 0, e
	}
	intake := eventstate.Store{Pool: s.Pool, MaxEvents: 1000, MaxPayloadBytes: 16 << 20}
	cp, e := intake.Checkpoint(ctx, binding)
	if e != nil {
		return 0, e
	}
	accepted, e := intake.Accept(ctx, binding, cp, "build-profile-v1", preview.Events)
	return accepted.Inserted, e
}
