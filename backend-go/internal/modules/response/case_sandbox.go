package response

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	pb "aisoc/backend/internal/gen/worker/v1"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/l1"
	"aisoc/backend/internal/modules/response/responsesql"
	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/eventstate"
	"aisoc/backend/internal/platform/jobs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type CaseSandboxRequest struct {
	Operation    string   `json:"operation"`
	ID           string   `json:"id"`
	ScopeID      string   `json:"scope_id"`
	SessionID    string   `json:"session_id"`
	PrincipalRef string   `json:"principal_ref"`
	Ticket       string   `json:"ticket"`
	Reason       string   `json:"reason"`
	EvidenceRefs []string `json:"evidence_refs"`
	Comment      string   `json:"comment"`
	Confirm      bool     `json:"confirm"`
	Stopped      bool     `json:"stopped"`
}
type caseSandboxDocument struct {
	CaseSandboxRequest
	CaseID          string             `json:"case_id"`
	RequestedBy     string             `json:"requested_by"`
	JobID           string             `json:"job_id"`
	ExpectedVersion int64              `json:"expected_version"`
	Evidence        []*pb.EvidenceItem `json:"evidence"`
	SOARConnector   string             `json:"soar_connector"`
	SOARExternalID  string             `json:"soar_external_id"`
	SOARVersion     string             `json:"soar_version"`
}

var caseSandboxID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)

func validateCaseProposal(in CaseSandboxRequest, review l1.Review) error {
	if !caseSandboxID.MatchString(in.ID) || !caseSandboxID.MatchString(in.SessionID) || !caseSandboxID.MatchString(in.PrincipalRef) || !caseSandboxID.MatchString(in.Ticket) || len(strings.TrimSpace(in.Reason)) < 10 || len(in.Reason) > 2000 || len(in.EvidenceRefs) < 1 || len(in.EvidenceRefs) > 20 {
		return eventstate.ErrInvalid
	}
	if review.Mode != "mock-v1" || review.State != "completed" || review.ResultStatus != "verified" || review.SyncState != "synced" {
		return eventstate.ErrRecoveryDenied
	}
	seen := map[string]bool{}
	for _, ref := range in.EvidenceRefs {
		found := false
		for _, e := range review.Evidence {
			if e.Reference == ref {
				found = true
			}
		}
		if !found || seen[ref] {
			return eventstate.ErrInvalid
		}
		seen[ref] = true
	}
	return nil
}

func (s Store) CaseSandboxList(ctx context.Context, tenant, caseID string) ([]json.RawMessage, error) {
	if caseID != "" {
		if _, err := (investigations.Store{Pool: s.Pool}).Get(ctx, tenant, caseID); err != nil {
			return nil, err
		}
	}
	rows, err := responsesql.New(s.Pool).CaseSandboxActions(ctx, responsesql.CaseSandboxActionsParams{TenantID: tenant, CaseID: caseID})
	if err != nil {
		return nil, err
	}
	items := make([]json.RawMessage, 0, len(rows))
	for _, row := range rows {
		items = append(items, json.RawMessage(row))
	}
	return items, nil
}

// CaseSandbox uses only a server-selected sandbox grant. An imported case or LLM
// result cannot create that grant. All effects commit with the case audit.
func (s Store) CaseSandbox(ctx context.Context, actor auth.Principal, caseID string, b telemetry.Binding, grants []SandboxGrant, in CaseSandboxRequest) (map[string]any, error) {
	allowed := false
	for _, g := range grants {
		if g.Actor == actor && g.Binding == b && b.TenantID == actor.Tenant && actor.ID != "" {
			allowed = true
		}
	}
	if !allowed {
		return nil, eventstate.ErrRecoveryDenied
	}
	if in.Operation != "propose" && in.Operation != "approve" && in.Operation != "dry_run" && in.Operation != "execute" && in.Operation != "policy" {
		return nil, eventstate.ErrInvalid
	}
	if (in.Operation == "approve" || in.Operation == "execute" || in.Operation == "policy") && !in.Confirm {
		return nil, eventstate.ErrInvalid
	}
	if in.Operation == "approve" && (len(strings.TrimSpace(in.Comment)) < 10 || len(in.Comment) > 2000) {
		return nil, eventstate.ErrInvalid
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err = investigations.Lock(ctx, tx, actor.Tenant, caseID); err != nil {
		return nil, err
	}
	q := responsesql.New(tx)
	if in.Operation == "policy" {
		result, e := s.sandboxSessionTx(ctx, tx, actor, b, grants, SandboxSessionRequest{Operation: "policy", Ticket: in.Ticket, Stopped: in.Stopped}, caseID)
		if e != nil {
			return nil, e
		}
		if e = investigations.Audit(ctx, tx, actor.Tenant, caseID, "sandbox_response_policy", map[string]any{"actor": actor.ID, "scope_id": in.ScopeID, "stopped": in.Stopped, "ticket": in.Ticket}); e != nil {
			return nil, e
		}
		return result, tx.Commit(ctx)
	}
	if !caseSandboxID.MatchString(in.ID) {
		return nil, eventstate.ErrInvalid
	}
	link, e := q.CaseSandboxLink(ctx, responsesql.CaseSandboxLinkParams{TenantID: actor.Tenant, ConnectorID: b.ConnectorID, Source: b.Source, ActionID: in.ID})
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return nil, e
	}
	var doc caseSandboxDocument
	if e == nil {
		if link.InvestigationID != caseID {
			return nil, eventstate.ErrNotFound
		}
		if err = json.Unmarshal(link.Document, &doc); err != nil {
			return nil, err
		}
		if in.Operation == "propose" {
			// Stable request identity allows recovery after an uncertain network response.
			a, _ := json.Marshal(in.EvidenceRefs)
			c, _ := json.Marshal(doc.EvidenceRefs)
			if in.SessionID != doc.SessionID || in.PrincipalRef != doc.PrincipalRef || in.Ticket != doc.Ticket || in.Reason != doc.Reason || string(a) != string(c) || in.ScopeID != doc.ScopeID {
				return nil, eventstate.ErrConflict
			}
			return map[string]any{"id": in.ID, "replayed": true, "mode": "sandbox", "external_calls": 0}, tx.Commit(ctx)
		}
	} else if in.Operation != "propose" {
		return nil, eventstate.ErrNotFound
	}
	if in.Operation == "propose" {
		review, e := l1.CaseReview(ctx, s.Pool, actor.Tenant, caseID)
		if e != nil {
			return nil, e
		}
		if e = validateCaseProposal(in, review); e != nil {
			return nil, e
		}
		var job pgtype.UUID
		if e = job.Scan(review.JobID); e != nil {
			return nil, eventstate.ErrInvalid
		}
		target, e := q.CaseSandboxTarget(ctx, responsesql.CaseSandboxTargetParams{TenantID: actor.Tenant, JobID: job, InvestigationID: caseID})
		if e != nil {
			return nil, e
		}
		session, e := s.sandboxSessionTx(ctx, tx, actor, b, grants, SandboxSessionRequest{Operation: "create_session", SessionID: in.SessionID, PrincipalRef: in.PrincipalRef, Ticket: in.Ticket}, caseID)
		if e != nil {
			return nil, e
		}
		if session["revoked"] == true {
			return nil, eventstate.ErrConflict
		}
		doc = caseSandboxDocument{CaseSandboxRequest: in, CaseID: caseID, RequestedBy: actor.ID, JobID: review.JobID, ExpectedVersion: session["version"].(int64), Evidence: []*pb.EvidenceItem{}, SOARConnector: target.ConnectorID, SOARExternalID: target.ExternalID, SOARVersion: target.Version}
		for _, ref := range in.EvidenceRefs {
			for _, ev := range review.Evidence {
				if ev.Reference == ref {
					doc.Evidence = append(doc.Evidence, &pb.EvidenceItem{Reference: ev.Reference, ContentHash: ev.ContentHash, EventTime: ev.EventTime, EventType: ev.EventType})
				}
			}
		}
		// Include hashes and provenance, not the entire source payload, in the snapshot.
	}
	if in.Operation != "propose" && len(link.Receipt) == 0 {
		version, e := q.CaseSandboxSourceVersion(ctx, responsesql.CaseSandboxSourceVersionParams{TenantID: actor.Tenant, ConnectorID: doc.SOARConnector, ExternalID: doc.SOARExternalID})
		if e != nil {
			return nil, e
		}
		if version != doc.SOARVersion {
			return nil, eventstate.ErrConflict
		}
	}
	result, err := s.sandboxSessionTx(ctx, tx, actor, b, grants, SandboxSessionRequest{Operation: in.Operation, ID: in.ID, SessionID: doc.SessionID, PrincipalRef: doc.PrincipalRef, ExpectedVersion: doc.ExpectedVersion, Ticket: doc.Ticket}, caseID)
	if err != nil {
		return nil, err
	}
	if in.Operation == "propose" {
		raw, _ := json.Marshal(doc)
		err = q.InsertCaseSandboxLink(ctx, responsesql.InsertCaseSandboxLinkParams{TenantID: actor.Tenant, InvestigationID: caseID, ConnectorID: b.ConnectorID, Source: b.Source, ActionID: in.ID, Document: raw})
	} else if in.Operation == "approve" && result["replayed"] != true {
		err = q.CaseSandboxApprovalComment(ctx, responsesql.CaseSandboxApprovalCommentParams{TenantID: actor.Tenant, ConnectorID: b.ConnectorID, Source: b.Source, ActionID: in.ID, ApprovalComment: strings.TrimSpace(in.Comment)})
	} else if in.Operation == "execute" && result["replayed"] != true {
		noteID := jobs.ID()
		receipt := map[string]any{"id": in.ID, "case_id": caseID, "mode": "sandbox", "external_calls": 0, "session_id": doc.SessionID, "principal_ref": doc.PrincipalRef, "state": "executed", "note_id": noteID, "soar_connector": doc.SOARConnector, "soar_external_id": doc.SOARExternalID, "executed_by": actor.ID, "executed_at": time.Now().UTC(), "compensation": "Revocation cannot be undone. Create a new mock session to simulate reauthentication."}
		body := fmt.Sprintf("SANDBOX ONLY: simulated session revocation. Case %s; action %s; principal %s; session %s; review %s. Evidence: %s. No external provider called. No case closure or analyst-field overwrite.", caseID, in.ID, doc.PrincipalRef, doc.SessionID, doc.Ticket, strings.Join(doc.EvidenceRefs, ", "))
		err = q.InsertCaseSandboxNote(ctx, responsesql.InsertCaseSandboxNoteParams{TenantID: actor.Tenant, ConnectorID: doc.SOARConnector, ExternalID: doc.SOARExternalID, ID: noteID, InvestigationID: caseID, Body: body})
		if err == nil {
			err = q.BumpCaseSandboxSourceVersion(ctx, responsesql.BumpCaseSandboxSourceVersionParams{TenantID: actor.Tenant, ConnectorID: doc.SOARConnector, ExternalID: doc.SOARExternalID, Version: jobs.ID()})
		}
		raw, _ := json.Marshal(receipt)
		if err == nil {
			err = q.CaseSandboxReceipt(ctx, responsesql.CaseSandboxReceiptParams{TenantID: actor.Tenant, ConnectorID: b.ConnectorID, Source: b.Source, ActionID: in.ID, Receipt: raw})
		}
		result["receipt"] = receipt
	}
	if err != nil {
		return nil, err
	}
	if result["replayed"] == true && len(link.Receipt) > 0 {
		result["receipt"] = json.RawMessage(link.Receipt)
	}
	if result["replayed"] != true {
		if err = investigations.Audit(ctx, tx, actor.Tenant, caseID, "sandbox_response_"+in.Operation, map[string]any{"actor": actor.ID, "action_id": in.ID, "scope_id": in.ScopeID, "result": result}); err != nil {
			return nil, err
		}
	}
	result["id"] = in.ID
	return result, tx.Commit(ctx)
}
