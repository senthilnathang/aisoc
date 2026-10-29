package soarsync

import (
	"aisoc/backend/internal/modules/qradarmock"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"unicode/utf8"
)

// ObserveMockCase imports a synthetic authoritative revision, including analyst
// fields. No provider calls; revisions must explicitly follow the stored version.
func (s Store) ObserveMockCase(ctx context.Context, next qradarmock.CaseRevision, owner, note string) error {
	if !valid(next.Binding.TenantID, Target{next.Binding.ConnectorID, next.ExternalID, next.Version}) || len(owner) > 256 || len(note) > 4096 || !utf8.ValidString(owner) || !utf8.ValidString(note) {
		return ErrInvalid
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	key, _ := json.Marshal([]string{"mock-soar", next.Binding.TenantID, next.Binding.ConnectorID, next.ExternalID})
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, string(key)); err != nil {
		return err
	}
	current := next
	var oldOwner, oldNote string
	err = tx.QueryRow(ctx, `SELECT version,previous_version,status,owner,analyst_note FROM mock_soar_cases WHERE tenant_id=$1 AND connector_id=$2 AND external_id=$3 FOR UPDATE`, next.Binding.TenantID, next.Binding.ConnectorID, next.ExternalID).Scan(&current.Version, &current.PreviousVersion, &current.Status, &oldOwner, &oldNote)
	if errors.Is(err, pgx.ErrNoRows) {
		if _, _, err = qradarmock.ApplyCase(nil, next); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO mock_soar_cases(tenant_id,connector_id,external_id,version,previous_version,status,owner,analyst_note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, next.Binding.TenantID, next.Binding.ConnectorID, next.ExternalID, next.Version, next.PreviousVersion, next.Status, owner, note)
	} else if err == nil {
		var changed bool
		_, changed, err = qradarmock.ApplyCase(&current, next)
		if err != nil {
			return err
		}
		if !changed {
			if owner != oldOwner || note != oldNote {
				return ErrConflict
			}
			return tx.Commit(ctx)
		}
		_, err = tx.Exec(ctx, `UPDATE mock_soar_cases SET version=$4,previous_version=$5,status=$6,owner=$7,analyst_note=$8 WHERE tenant_id=$1 AND connector_id=$2 AND external_id=$3`, next.Binding.TenantID, next.Binding.ConnectorID, next.ExternalID, next.Version, next.PreviousVersion, next.Status, owner, note)
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
