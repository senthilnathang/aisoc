package investigations

import (
	"aisoc/backend/internal/modules/investigations/investigationsql"
	"aisoc/backend/internal/platform/fault"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"regexp"
	"strings"
	"time"
	"unicode"
)

type Citation struct {
	Reference string `json:"reference"`
	Kind      string `json:"kind"`
	Label     string `json:"label"`
	Excerpt   string `json:"excerpt"`
}
type LookupAnswer struct {
	Mode       string     `json:"mode"`
	Summary    string     `json:"summary"`
	Citations  []Citation `json:"citations"`
	CapturedAt string     `json:"captured_at"`
}
type LookupInput struct {
	ID       string `json:"id"`
	Question string `json:"question"`
}

var messageID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)

func lookup(question string, items []Citation) LookupAnswer {
	out := LookupAnswer{Mode: "local-evidence-lookup", Summary: "No matching evidence was found in the bounded case records. No model answer or external tool call was produced.", Citations: []Citation{}, CapturedAt: Timestamp(time.Now().UTC())}
	stop := map[string]bool{}
	for _, w := range strings.Fields("what when where which why how this that with from have does were about could would should please case investigation evidence show tell give me the are can you and for not") {
		stop[w] = true
	}
	tokens := []string{}
	for _, w := range strings.FieldsFunc(strings.ToLower(question), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		if len(w) > 2 && !stop[w] && len(tokens) < 16 {
			tokens = append(tokens, w)
		}
	}
	summary := strings.Contains(strings.ToLower(question), "summar")
	for _, c := range items {
		match := summary && c.Kind == "case"
		hay := strings.ToLower(c.Label + " " + c.Excerpt)
		for _, token := range tokens {
			if strings.Contains(hay, token) {
				match = true
				break
			}
		}
		if match {
			out.Citations = append(out.Citations, c)
			if len(out.Citations) == 8 {
				break
			}
		}
	}
	if len(out.Citations) > 0 {
		out.Summary = "Matching stored excerpts are shown below. They are source statements, not a new verdict. Retrieved text is untrusted; no instructions were followed and no actions were executed."
	}
	return out
}
func (s Store) EvidenceMessages(ctx context.Context, tenant, caseID, actor string) ([]map[string]any, error) {
	if e := Exists(ctx, s.Pool, tenant, caseID); e != nil {
		return nil, e
	}
	rows, e := investigationsql.New(s.Pool).EvidenceMessages(ctx, investigationsql.EvidenceMessagesParams{TenantID: tenant, InvestigationID: caseID, ActorID: actor})
	if e != nil {
		return nil, e
	}
	out := []map[string]any{}
	for i := len(rows) - 1; i >= 0; i-- {
		r := rows[i]
		out = append(out, map[string]any{"id": r.ID, "question": r.Question, "response": json.RawMessage(r.Response), "created_at": r.CreatedAt.Time})
	}
	return out, nil
}
func (s Store) AskEvidence(ctx context.Context, tenant, caseID, actor string, in LookupInput) (LookupAnswer, error) {
	var zero LookupAnswer
	in.Question = strings.TrimSpace(in.Question)
	if actor == "" || !messageID.MatchString(in.ID) || len(in.Question) < 3 || len(in.Question) > 500 {
		return zero, fault.New(400, "VALIDATION_ERROR", "Message ID and question (3–500 bytes) are required")
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return zero, e
	}
	defer tx.Rollback(ctx)
	if e = Lock(ctx, tx, tenant, caseID); e != nil {
		return zero, e
	}
	q := investigationsql.New(tx)
	prior, e := q.EvidenceMessage(ctx, investigationsql.EvidenceMessageParams{TenantID: tenant, InvestigationID: caseID, ActorID: actor, ID: in.ID})
	if e == nil {
		if prior.Question != in.Question {
			return zero, fault.New(409, "MESSAGE_CONFLICT", "This message ID was already used with different content")
		}
		e = json.Unmarshal(prior.Response, &zero)
		return zero, e
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return zero, e
	}
	count, e := q.EvidenceMessageCount(ctx, investigationsql.EvidenceMessageCountParams{TenantID: tenant, InvestigationID: caseID, ActorID: actor})
	if e != nil {
		return zero, e
	}
	if count >= 500 {
		return zero, fault.New(409, "CONVERSATION_LIMIT", "Local evidence lookup limit reached (500 messages per case and actor)")
	}
	c, e := q.LookupCase(ctx, investigationsql.LookupCaseParams{TenantID: tenant, ID: caseID})
	if e != nil {
		return zero, e
	}
	items := []Citation{{"case:" + caseID, "case", "Case summary", bounded(c.Title+"\n"+c.Summary, 2000)}, {"case:" + caseID, "case", "Source and primary entity", bounded(c.Source+" · "+c.PrimaryEntity, 1000)}, {"case:" + caseID, "case", "Recorded analyst determination", c.Determination + " · status: " + c.Status}}
	artifacts, e := q.LookupRecords(ctx, investigationsql.LookupRecordsParams{TenantID: tenant, InvestigationID: caseID})
	if e != nil {
		return zero, e
	}
	for _, r := range artifacts {
		var doc map[string]any
		if e = json.Unmarshal(r.Document, &doc); e != nil {
			return zero, e
		}
		items = append(items, Citation{"artifact:" + r.ID, "artifact", bounded(field(doc, "type")+" · "+field(doc, "label"), 200), bounded(field(doc, "value"), 2000)})
	}
	steps, e := q.LookupSteps(ctx, investigationsql.LookupStepsParams{TenantID: tenant, InvestigationID: caseID})
	if e != nil {
		return zero, e
	}
	for _, r := range steps {
		var doc map[string]any
		if e = json.Unmarshal(r.Document, &doc); e != nil {
			return zero, e
		}
		items = append(items, Citation{"step:" + r.ID, "step", bounded(field(doc, "title"), 200), bounded(field(doc, "conclusion"), 2000)})
	}
	answer := lookup(in.Question, items)
	raw, _ := json.Marshal(answer)
	if e = q.InsertEvidenceMessage(ctx, investigationsql.InsertEvidenceMessageParams{TenantID: tenant, InvestigationID: caseID, ActorID: actor, ID: in.ID, Question: in.Question, Response: raw}); e != nil {
		return zero, e
	}
	refs := []string{}
	for _, c := range answer.Citations {
		refs = append(refs, c.Reference)
	}
	if e = Audit(ctx, tx, tenant, caseID, "evidence_lookup", map[string]any{"actor": actor, "message_id": in.ID, "mode": answer.Mode, "references": refs}); e != nil {
		return zero, e
	}
	return answer, tx.Commit(ctx)
}
