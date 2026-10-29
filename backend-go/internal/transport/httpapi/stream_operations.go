package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"aisoc/backend/internal/modules/response"
	"aisoc/backend/internal/modules/soarsync"
	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/config"
	"aisoc/backend/internal/platform/eventstate"
	"aisoc/backend/internal/platform/fault"
	"github.com/jackc/pgx/v5/pgxpool"
)

func streamError(err error) error {
	switch {
	case errors.Is(err, eventstate.ErrRecoveryDenied):
		return fault.New(403, "STREAM_FORBIDDEN", "No grant for this stream operation")
	case errors.Is(err, eventstate.ErrInvalid), errors.Is(err, telemetry.ErrInvalid), errors.Is(err, soarsync.ErrInvalid):
		return fault.New(400, "INVALID_STREAM_REQUEST", "Invalid stream operation")
	case errors.Is(err, eventstate.ErrNotFound):
		return fault.New(404, "STREAM_NOT_FOUND", "Retained work was not found")
	case errors.Is(err, eventstate.ErrConflict), errors.Is(err, eventstate.ErrCheckpoint), errors.Is(err, soarsync.ErrConflict):
		return fault.New(409, "STREAM_CONFLICT", "State changed; refresh and review before retrying")
	case errors.Is(err, eventstate.ErrCapacity):
		return fault.New(409, "STREAM_CAPACITY", "Configured retained-state or retry limit reached")
	default:
		return err
	}
}

func streamBody(r *http.Request, target any) error {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return fault.New(415, "INVALID_STREAM_REQUEST", "JSON is required")
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20+1))
	var oversized *http.MaxBytesError
	if errors.As(err, &oversized) || len(raw) > 1<<20 {
		return fault.New(413, "PAYLOAD_TOO_LARGE", "Stream request exceeds 1 MiB")
	}
	if err != nil {
		return err
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(target); err != nil {
		return eventstate.ErrInvalid
	}
	if err = d.Decode(new(any)); err != io.EOF {
		return eventstate.ErrInvalid
	}
	return nil
}

func registerStreamOperations(mux *http.ServeMux, pool *pgxpool.Pool, scopes []config.StreamScope) {
	store := eventstate.Store{Pool: pool, MaxEvents: 100000, MaxPayloadBytes: 64 << 20}
	get := func(r *http.Request) (config.StreamScope, telemetry.Binding, error) {
		actor := auth.From(r.Context())
		for _, s := range scopes {
			if s.ID == r.PathValue("scope") && s.OperatorID == actor.ID && s.TenantID == actor.Tenant {
				return s, telemetry.Binding{TenantID: s.TenantID, ConnectorID: s.ConnectorID, Source: s.Source}, nil
			}
		}
		return config.StreamScope{}, telemetry.Binding{}, eventstate.ErrRecoveryDenied
	}
	mux.HandleFunc("POST /api/v1/stream-operations/{scope}/sandbox-session", streamRespond(func(r *http.Request) (any, int, error) {
		s, b, err := get(r)
		if err != nil {
			return nil, 0, streamError(err)
		}
		if !s.AllowSandboxResponse {
			return nil, 0, streamError(eventstate.ErrRecoveryDenied)
		}
		var input response.SandboxSessionRequest
		if err = streamBody(r, &input); err != nil {
			return nil, 0, streamError(err)
		}
		actor := auth.From(r.Context())
		result, err := (response.Store{Pool: pool}).SandboxSession(r.Context(), actor, b, []response.SandboxGrant{{Actor: actor, Binding: b}}, input)
		return result, 200, streamError(err)
	}))
	mux.HandleFunc("GET /api/v1/stream-operations/{scope}/events", streamRespond(func(r *http.Request) (any, int, error) {
		s, b, err := get(r)
		if err != nil {
			return nil, 0, streamError(err)
		}
		after := r.URL.Query().Get("after")
		if after != "" {
			if raw, err := hex.DecodeString(after); err != nil || len(raw) != 32 {
				return nil, 0, streamError(eventstate.ErrInvalid)
			}
		}
		rows, err := pool.Query(r.Context(), `SELECT e.event_key,e.envelope,COALESCE(i.disposition,'pending') FROM stream_events e LEFT JOIN stream_inbox i ON i.tenant_id=e.tenant_id AND i.connector_id=e.connector_id AND i.source=e.source AND i.event_key=e.event_key AND i.processor=$4 WHERE e.tenant_id=$1 AND e.connector_id=$2 AND e.source=$3 AND e.event_key>$5 ORDER BY e.event_key LIMIT 51`, b.TenantID, b.ConnectorID, b.Source, s.Processor, after)
		if err != nil {
			return nil, 0, err
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var key, disposition string
			var envelope json.RawMessage
			if err = rows.Scan(&key, &envelope, &disposition); err != nil {
				return nil, 0, err
			}
			items = append(items, map[string]any{"event_key": key, "event": envelope, "disposition": disposition})
		}
		if err = rows.Err(); err != nil {
			return nil, 0, err
		}
		next := ""
		if len(items) > 50 {
			items = items[:50]
			next = items[49]["event_key"].(string)
		}
		rows.Close()
		for _, item := range items {
			raw, err := eventstate.ResolveEnvelope(r.Context(), pool, b, item["event_key"].(string), item["event"].(json.RawMessage))
			if err != nil {
				return nil, 0, err
			}
			item["event"] = json.RawMessage(raw)
		}
		return map[string]any{"items": items, "next_after": next}, 200, nil
	}))
	mux.HandleFunc("GET /api/v1/stream-operations", streamRespond(func(r *http.Request) (any, int, error) {
		actor := auth.From(r.Context())
		items := []config.StreamScope{}
		for _, s := range scopes {
			if s.OperatorID == actor.ID && s.TenantID == actor.Tenant {
				items = append(items, s)
			}
		}
		return map[string]any{"items": items, "mode": "sandbox"}, 200, nil
	}))
	mux.HandleFunc("GET /api/v1/stream-operations/{scope}", streamRespond(func(r *http.Request) (any, int, error) {
		s, b, err := get(r)
		if err != nil {
			return nil, 0, streamError(err)
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		snapshot, err := store.Snapshot(ctx, b, s.Processor)
		if err != nil {
			return nil, 0, err
		}
		pending, age := s.PendingWarning, s.AgeWarningSeconds
		if pending == 0 {
			pending = 5000
		}
		if age == 0 {
			age = 15
		}
		alerts := []string{}
		if snapshot.Pending >= pending {
			alerts = append(alerts, "pending_limit")
		}
		if snapshot.Pending > 0 && snapshot.OldestPendingSeconds >= float64(age) {
			alerts = append(alerts, "queue_age")
		}
		if snapshot.Dead > 0 || snapshot.PublicationFailed > 0 {
			alerts = append(alerts, "failed_work")
		}
		cp, err := store.Checkpoint(ctx, b)
		if err != nil {
			return nil, 0, err
		}
		rows, err := pool.Query(ctx, `SELECT 'publication',event_key,COALESCE(attempt_id::text,''),attempts,recovery_count,COALESCE(error_code,'') FROM stream_outbox WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND state='failed' AND event_key>$5 UNION ALL SELECT 'consumer',substring(w.work_key from 7),COALESCE(w.attempt_id::text,''),w.attempts,0,d.reason FROM stream_consumer_work w JOIN stream_dead_letters d USING(tenant_id,connector_id,source,processor,work_key) WHERE w.tenant_id=$1 AND w.connector_id=$2 AND w.source=$3 AND w.processor=$4 AND w.state='dead' AND w.work_key LIKE 'event:%' AND substring(w.work_key from 7)>$5 ORDER BY 2,1 LIMIT 51`, b.TenantID, b.ConnectorID, b.Source, s.Processor, r.URL.Query().Get("after"))
		if err != nil {
			return nil, 0, err
		}
		failures := []map[string]any{}
		for rows.Next() {
			var kind, key, attempt, reason string
			var attempts, recovery int
			if err = rows.Scan(&kind, &key, &attempt, &attempts, &recovery, &reason); err != nil {
				break
			}
			failures = append(failures, map[string]any{"kind": kind, "event_key": key, "expected_attempt_id": attempt, "expected_attempts": attempts, "expected_recovery_count": recovery, "reason": reason, "processor": s.Processor})
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
		if err != nil {
			return nil, 0, err
		}
		if len(failures) == 51 && failures[49]["event_key"] != failures[50]["event_key"] {
			failures = failures[:50]
		}
		for _, f := range failures {
			parts := []string{b.TenantID, b.ConnectorID, b.Source}
			resource := "stream_publication"
			action := "stream_publication_retry"
			if f["kind"] == "consumer" {
				parts = append(parts, s.Processor)
				resource = "stream_consumer"
				action = "stream_consumer_retry"
			}
			parts = append(parts, f["event_key"].(string))
			raw, _ := json.Marshal(parts)
			resourceID := fmt.Sprintf("%x", sha256.Sum256(raw))
			var retries int
			if err = pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE tenant_id=$1 AND resource=$2 AND resource_id=$3 AND action=$4`, b.TenantID, resource, resourceID, action).Scan(&retries); err != nil {
				return nil, 0, err
			}
			f["expected_operator_retries"] = retries
			f["retry_allowed"] = s.AllowRetry && retries < 3 && (f["kind"] == "publication" || f["reason"] == "HANDLER_FAILED" || f["reason"] == "ATTEMPTS_EXHAUSTED")
		}
		next := ""
		if len(failures) >= 50 {
			next = failures[len(failures)-1]["event_key"].(string)
		}
		worker, cases, err := streamStatus(ctx, pool, b, s.Processor)
		if err != nil {
			return nil, 0, err
		}
		if worker["status"] != "running" {
			alerts = append(alerts, "worker_"+worker["status"].(string))
		}
		if snapshot.Accepted-snapshot.Archived >= s.HotEventLimit() && s.AllowMockImport {
			alerts = append(alerts, "mock_source_capacity")
		}
		if snapshot.DeadLetters > 0 {
			alerts = append(alerts, "dead_letters")
		}
		return map[string]any{"worker": worker, "cases": cases, "scope": s, "snapshot": snapshot, "checkpoint": cp, "alerts": alerts, "thresholds": map[string]any{"pending": pending, "age_seconds": age}, "failures": failures, "next_after": next, "mode": "sandbox", "privileged_actions_enabled": false}, 200, nil
	}))
	for _, kind := range []string{"publication", "consumer"} {
		mux.HandleFunc("POST /api/v1/stream-operations/{scope}/retry-"+kind, streamRespond(func(r *http.Request) (any, int, error) {
			s, b, err := get(r)
			if err != nil {
				return nil, 0, streamError(err)
			}
			if !s.AllowRetry {
				return nil, 0, streamError(eventstate.ErrRecoveryDenied)
			}
			actor := auth.From(r.Context())
			recovery := eventstate.OperatorRecovery{Store: store, Grants: []eventstate.RecoveryGrant{{Operator: actor, Binding: b}}}
			var replay bool
			if kind == "publication" {
				var req eventstate.PublicationRetry
				if err = streamBody(r, &req); err == nil {
					replay, err = recovery.RetryPublication(r.Context(), actor, b, req)
				}
			} else {
				var req eventstate.ConsumerRetry
				if err = streamBody(r, &req); err == nil {
					if req.Processor != s.Processor {
						err = eventstate.ErrRecoveryDenied
					} else {
						replay, err = recovery.RetryConsumer(r.Context(), actor, b, req)
					}
				}
			}
			return map[string]any{"replayed": replay, "state": "queued", "mode": "sandbox"}, 200, streamError(err)
		}))
	}
	registerStreamMockImport(mux, pool, scopes)
	mux.HandleFunc("POST /api/v1/stream-operations/{scope}/rebase-soar", streamRespond(func(r *http.Request) (any, int, error) {
		s, b, err := get(r)
		if err != nil {
			return nil, 0, streamError(err)
		}
		if !s.AllowRetry {
			return nil, 0, streamError(eventstate.ErrRecoveryDenied)
		}
		var req struct {
			JobID   string `json:"job_id"`
			Version string `json:"expected_version"`
			Ticket  string `json:"ticket"`
		}
		if err = streamBody(r, &req); err != nil {
			return nil, 0, streamError(err)
		}
		if req.Ticket == "" {
			return nil, 0, streamError(eventstate.ErrInvalid)
		}
		var belongs bool
		if err = pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM l1_escalations e JOIN stream_findings f USING(tenant_id,investigation_id) WHERE f.tenant_id=$1 AND f.connector_id=$2 AND f.source=$3 AND e.job_id::text=$4)`, b.TenantID, b.ConnectorID, b.Source, req.JobID).Scan(&belongs); err != nil {
			return nil, 0, err
		}
		if !belongs {
			return nil, 0, streamError(eventstate.ErrNotFound)
		}
		err = (soarsync.Store{Pool: pool}).RebaseMock(r.Context(), b.TenantID, req.JobID, req.Version, auth.From(r.Context()).ID, req.Ticket)
		return map[string]any{"state": "draft", "mode": "mock-soar"}, 200, streamError(err)
	}))
}
