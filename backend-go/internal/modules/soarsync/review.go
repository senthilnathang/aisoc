package soarsync

import (
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/modules/soarsync/soarsql"
	"aisoc/backend/internal/modules/telemetry"
	"context"
	"github.com/jackc/pgx/v5/pgtype"
	"strings"
	"unicode/utf8"
)

// ApproveMockNote authorizes only the immutable draft already staged from Go QA.
// It does not change a verdict, close a case, authorize containment or call SOAR.
func (s Store) ApproveMockNote(ctx context.Context, b telemetry.Binding, job, actor, comment string) error {
	comment = strings.TrimSpace(comment)
	var id pgtype.UUID
	if id.Scan(job) != nil || !id.Valid || !token.MatchString(actor) || utf8.RuneCountInString(comment) < 10 || utf8.RuneCountInString(comment) > 2000 || strings.ContainsRune(comment, 0) {
		return ErrInvalid
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := soarsql.New(tx)
	record, err := q.LockReview(ctx, soarsql.LockReviewParams{TenantID: b.TenantID, JobID: id, ConnectorID: b.ConnectorID, Source: b.Source})
	if err != nil {
		return err
	}
	if !record.ReviewRequired {
		return ErrInvalid
	}
	if record.ReviewedBy != "" {
		if record.ReviewedBy != actor || record.ReviewComment != comment {
			return ErrConflict
		}
		return tx.Commit(ctx)
	}
	if err = q.ApproveReview(ctx, soarsql.ApproveReviewParams{TenantID: b.TenantID, JobID: id, ReviewedBy: pgtype.Text{String: actor, Valid: true}, ReviewComment: pgtype.Text{String: comment, Valid: true}}); err != nil {
		return err
	}
	if err = investigations.Audit(ctx, tx, b.TenantID, record.InvestigationID, "mock_soar_note_approved", map[string]any{"job_id": job, "actor": actor, "comment": comment, "scope": "mock-note-only"}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
