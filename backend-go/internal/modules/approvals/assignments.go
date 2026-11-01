package approvals

import (
	"aisoc/backend/internal/modules/investigations/investigationsql"
	"aisoc/backend/internal/platform/auth"
	"aisoc/backend/internal/platform/fault"
	"aisoc/backend/internal/platform/jobs"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"regexp"
	"strings"
	"time"
)

type WorkKey struct {
	Kind      string `json:"kind"`
	ID        string `json:"id"`
	Connector string `json:"connector_id"`
	Source    string `json:"source"`
}
type AssignmentInput struct {
	WorkKey
	Operation       string `json:"operation"`
	Owner           string `json:"owner_id"`
	ExpectedVersion int32  `json:"expected_version"`
	WorkToken       string `json:"work_token"`
	RequestID       string `json:"request_id"`
	Reason          string `json:"reason"`
	Minutes         int    `json:"minutes"`
}

var requestPattern = regexp.MustCompile(`^[a-zA-Z0-9-]{8,80}$`)

func (k WorkKey) validate() error {
	if (k.Kind != "skill" && k.Kind != "memory" && k.Kind != "respond") || len(k.ID) < 1 || len(k.ID) > 160 || len(k.Connector) > 160 || len(k.Source) > 128 || strings.ContainsRune(k.ID+k.Connector+k.Source, 0) || (k.Kind != "respond" && (k.Connector != "" || k.Source != "")) || (k.Kind == "respond" && (k.Connector == "" || k.Source == "")) {
		return invalidAssignment()
	}
	return nil
}
func invalidAssignment() error {
	return fault.New(400, "INVALID_ASSIGNMENT", "Use a saved proposal, current ownership version, request ID, review reason and 15–240 minute ownership period.")
}
func assignmentConflict() error {
	return fault.New(409, "ASSIGNMENT_CHANGED", "The proposal or ownership changed. Refresh before claiming or reassigning.")
}
func unavailable() error {
	return fault.New(404, "APPROVAL_WORK_NOT_FOUND", "Pending approval work was not found.")
}
func forbidden() error {
	return fault.New(403, "ASSIGNMENT_FORBIDDEN", "This operator is not eligible for this ownership operation.")
}
func workToken(item map[string]any) string {
	raw, _ := json.Marshal([]any{item["kind"], item["id"], item["stage"], item["expires_at"], item["source_revision"], item["document"]})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func text(v any) string      { s, _ := v.(string); return s }
func expiry(v any) time.Time { t, _ := time.Parse(time.RFC3339Nano, text(v)); return t }
func keyOf(item map[string]any) WorkKey {
	d, _ := item["document"].(map[string]any)
	k := WorkKey{Kind: text(item["kind"]), ID: text(item["id"])}
	if k.Kind == "respond" {
		k.Connector = text(d["connector_id"])
		k.Source = text(d["source"])
	}
	return k
}
func required(item map[string]any, now time.Time) string {
	if item["kind"] == "respond" && item["stage"] == "execution" && expiry(item["expires_at"]).After(now) {
		return "executor"
	}
	if item["kind"] == "memory" {
		end := expiry(item["expires_at"])
		if !end.IsZero() && !end.After(now) {
			return "proposer"
		}
	}
	return "approver"
}
func hasRole(op auth.ApprovalOperator, role string) bool {
	for _, r := range op.Roles {
		if r == role {
			return true
		}
	}
	return false
}
func operator(ops []auth.ApprovalOperator, id string) auth.ApprovalOperator {
	for _, op := range ops {
		if op.ID == id {
			return op
		}
	}
	return auth.ApprovalOperator{}
}
func responseGrant(op auth.ApprovalOperator, item map[string]any) bool {
	if item["kind"] != "respond" {
		return true
	}
	k := keyOf(item)
	for _, b := range op.Bindings {
		if b.Connector == k.Connector && b.Source == k.Source {
			return true
		}
	}
	return false
}
func eligible(op auth.ApprovalOperator, item map[string]any, now time.Time) bool {
	role := required(item, now)
	if op.ID == "" || !hasRole(op, role) || !responseGrant(op, item) {
		return false
	}
	if role == "proposer" {
		return true
	}
	doc, _ := item["document"].(map[string]any)
	if auth.Independent(doc, op.ID) != nil {
		return false
	}
	return role != "executor" || doc["approved_by"] != op.ID
}
func contributor(item map[string]any, id string) bool {
	d, _ := item["document"].(map[string]any)
	if d["created_by"] == id {
		return true
	}
	as, _ := d["proposal_authors"].([]any)
	for _, a := range as {
		if a == id {
			return true
		}
	}
	return false
}
func mayManage(op auth.ApprovalOperator, item map[string]any, now time.Time) bool {
	return eligible(op, item, now) || (op.ID != "" && hasRole(op, "proposer") && contributor(item, op.ID) && responseGrant(op, item))
}
func ownerMayManage(op auth.ApprovalOperator, item map[string]any, owner string) bool {
	return owner != "" && op.ID == owner && responseGrant(op, item) && (hasRole(op, "proposer") || hasRole(op, "approver") || hasRole(op, "executor"))
}
func readWork(ctx context.Context, q *investigationsql.Queries, tenant string, k WorkKey) (map[string]any, error) {
	raw, e := q.AssignmentWork(ctx, investigationsql.AssignmentWorkParams{TenantID: tenant, Kind: k.Kind, ID: k.ID, ConnectorID: k.Connector, Source: k.Source})
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, unavailable()
	}
	if e != nil {
		return nil, e
	}
	var item map[string]any
	e = json.Unmarshal(raw, &item)
	return item, e
}
func readAssignment(ctx context.Context, q *investigationsql.Queries, tenant string, k WorkKey) (investigationsql.ApprovalAssignment, error) {
	a, e := q.Assignment(ctx, investigationsql.AssignmentParams{TenantID: tenant, Kind: k.Kind, ResourceID: k.ID, ConnectorID: k.Connector, Source: k.Source})
	if errors.Is(e, pgx.ErrNoRows) {
		return investigationsql.ApprovalAssignment{}, nil
	}
	return a, e
}
func assignmentView(a investigationsql.ApprovalAssignment, token string, now time.Time) map[string]any {
	state := "unassigned"
	if a.OwnerID != "" {
		state = "owned"
		if a.WorkToken != token {
			state = "revision_changed"
		} else if !a.ExpiresAt.Valid || !a.ExpiresAt.Time.After(now) {
			state = "expired"
		}
	}
	return map[string]any{"version": a.Version, "owner_id": a.OwnerID, "assigned_by": a.AssignedBy, "expires_at": a.ExpiresAt, "reason": a.Reason, "state": state, "updated_at": a.UpdatedAt}
}
func (s Store) AssignmentDetail(ctx context.Context, tenant, actor string, k WorkKey, ops []auth.ApprovalOperator) (map[string]any, error) {
	if e := k.validate(); e != nil {
		return nil, e
	}
	q := investigationsql.New(s.Pool)
	item, e := readWork(ctx, q, tenant, k)
	if e != nil {
		return nil, e
	}
	a, e := readAssignment(ctx, q, tenant, k)
	if e != nil {
		return nil, e
	}
	now := time.Now()
	token := workToken(item)
	targets := []map[string]string{}
	for _, op := range ops {
		if eligible(op, item, now) {
			targets = append(targets, map[string]string{"id": op.ID, "role": required(item, now)})
		}
	}
	current := operator(ops, actor)
	av := assignmentView(a, token, now)
	return map[string]any{"item": item, "work_token": token, "assignment": av, "eligible_operators": targets, "can_manage": mayManage(current, item, now) || ownerMayManage(current, item, a.OwnerID), "can_claim": eligible(current, item, now) && (av["state"] != "owned" || a.OwnerID == actor), "required_role": required(item, now)}, nil
}
func (s Store) Assign(ctx context.Context, tenant, actor string, in AssignmentInput, ops []auth.ApprovalOperator) (map[string]any, error) {
	if e := in.WorkKey.validate(); e != nil {
		return nil, e
	}
	if !requestPattern.MatchString(in.RequestID) || in.ExpectedVersion < 0 || len(strings.TrimSpace(in.Reason)) < 10 || len(in.Reason) > 1000 || strings.ContainsRune(in.Reason, 0) || len(in.WorkToken) != 64 || in.Minutes < 15 || in.Minutes > 240 {
		return nil, invalidAssignment()
	}
	if in.Operation != "claim" && in.Operation != "reassign" && in.Operation != "release" {
		return nil, invalidAssignment()
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	q := investigationsql.New(tx)
	switch in.Kind {
	case "skill":
		_, e = q.LockAssignmentSkill(ctx, investigationsql.LockAssignmentSkillParams{TenantID: tenant, ID: in.ID})
	case "memory":
		_, e = q.LockAssignmentMemory(ctx, investigationsql.LockAssignmentMemoryParams{TenantID: tenant, ID: in.ID})
	case "respond":
		_, e = q.LockAssignmentResponse(ctx, investigationsql.LockAssignmentResponseParams{TenantID: tenant, ID: in.ID, ConnectorID: in.Connector, Source: in.Source})
	}
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, unavailable()
	}
	if e != nil {
		return nil, e
	}
	item, e := readWork(ctx, q, tenant, in.WorkKey)
	if e != nil {
		return nil, e
	}
	token := workToken(item)
	if token != in.WorkToken {
		return nil, assignmentConflict()
	}
	now := time.Now()
	current := operator(ops, actor)
	old, e := readAssignment(ctx, q, tenant, in.WorkKey)
	if e != nil {
		return nil, e
	}
	if !mayManage(current, item, now) && !ownerMayManage(current, item, old.OwnerID) {
		return nil, forbidden()
	}
	raw, _ := json.Marshal(in)
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])
	if old.RequestID == in.RequestID && old.AssignedBy == actor {
		if old.RequestHash != hash {
			return nil, assignmentConflict()
		}
		if e = tx.Commit(ctx); e != nil {
			return nil, e
		}
		return map[string]any{"assignment": assignmentView(old, token, now), "replayed": true}, nil
	}
	if old.Version != in.ExpectedVersion {
		return nil, assignmentConflict()
	}
	target := in.Owner
	switch in.Operation {
	case "claim":
		if target != "" && target != actor {
			return nil, forbidden()
		}
		target = actor
		if assignmentView(old, token, now)["state"] == "owned" && old.OwnerID != actor {
			return nil, assignmentConflict()
		}
	case "release":
		if target != "" || old.OwnerID == "" {
			return nil, invalidAssignment()
		}
		target = ""
	case "reassign":
		if target == "" {
			return nil, invalidAssignment()
		}
	}
	if target != "" && !eligible(operator(ops, target), item, now) {
		return nil, forbidden()
	}
	expires := pgtype.Timestamptz{}
	if target != "" {
		until := now.Add(time.Duration(in.Minutes) * time.Minute)
		bound := expiry(item["expires_at"])
		if bound.After(now) && bound.Before(until) {
			until = bound
		}
		expires = pgtype.Timestamptz{Time: until, Valid: true}
	}
	saved, e := q.SaveAssignment(ctx, investigationsql.SaveAssignmentParams{TenantID: tenant, Kind: in.Kind, ResourceID: in.ID, ConnectorID: in.Connector, Source: in.Source, WorkToken: token, OwnerID: target, AssignedBy: actor, ExpiresAt: expires, Reason: strings.TrimSpace(in.Reason), RequestID: in.RequestID, RequestHash: hash})
	if e != nil {
		return nil, e
	}
	details, _ := json.Marshal(map[string]any{"actor": actor, "from": old.OwnerID, "to": target, "version": saved.Version, "work_token": token, "reason": in.Reason, "kind": in.Kind, "connector_id": in.Connector, "source": in.Source, "expires_at": expires})
	if e = q.AssignmentAudit(ctx, investigationsql.AssignmentAuditParams{TenantID: tenant, ID: jobs.ID(), ResourceID: in.ID, Action: "approval_" + in.Operation, Details: details}); e != nil {
		return nil, e
	}
	recipients := map[string]bool{}
	for _, id := range []string{old.OwnerID, target} {
		if id == "" || recipients[id] {
			continue
		}
		recipients[id] = true
		if e = q.NotifyAssignment(ctx, investigationsql.NotifyAssignmentParams{TenantID: tenant, ID: jobs.ID(), RecipientID: id, Kind: in.Kind, ResourceID: in.ID, ConnectorID: in.Connector, Source: in.Source, Title: text(item["title"]), EventType: in.Operation, ActorID: actor, OwnerID: target, AssignmentVersion: saved.Version, WorkToken: token}); e != nil {
			return nil, e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	return map[string]any{"assignment": assignmentView(saved, token, now), "replayed": false}, nil
}
func (s Store) Notifications(ctx context.Context, tenant, actor string, limit, offset int) (map[string]any, error) {
	if limit < 1 || limit > 50 || offset < 0 || offset > 1000000 {
		return nil, invalidAssignment()
	}
	raw, e := investigationsql.New(s.Pool).ApprovalNotifications(ctx, investigationsql.ApprovalNotificationsParams{TenantID: tenant, RecipientID: actor, PageLimit: int32(limit), PageOffset: int32(offset)})
	if e != nil {
		return nil, e
	}
	var out map[string]any
	e = json.Unmarshal(raw, &out)
	return out, e
}
func (s Store) ReadNotification(ctx context.Context, tenant, actor, id string) error {
	_, e := investigationsql.New(s.Pool).ReadApprovalNotification(ctx, investigationsql.ReadApprovalNotificationParams{TenantID: tenant, RecipientID: actor, ID: id})
	if errors.Is(e, pgx.ErrNoRows) {
		return unavailable()
	}
	return e
}
