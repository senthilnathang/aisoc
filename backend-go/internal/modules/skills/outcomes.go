package skills

import (
	"context"
	"github.com/jackc/pgx/v5"
)

func (s Store) Outcomes(ctx context.Context, tenant string) (map[string]any, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT id,document->>'name',document->>'skill_type',document->>'state',(document->>'version')::int FROM skills WHERE tenant_id=$1 ORDER BY `+lowerName+` COLLATE "C",ordinal`, tenant)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for rows.Next() {
		var id, name, typ, state string
		var version int
		if err = rows.Scan(&id, &name, &typ, &state, &version); err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, map[string]any{"id": id, "name": name, "skill_type": typ, "state": state, "version": version})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for _, r := range items {
		var applications, cases, hunts, feedback, helpful, notHelpful int64
		err = tx.QueryRow(ctx, `SELECT count(*),count(DISTINCT target_id) FILTER(WHERE target_type='investigation'),count(DISTINCT target_id) FILTER(WHERE target_type='hunt') FROM skill_applications WHERE tenant_id=$1 AND skill_id=$2`, tenant, r["id"]).Scan(&applications, &cases, &hunts)
		if err != nil {
			return nil, err
		}
		err = tx.QueryRow(ctx, `SELECT count(*),count(*) FILTER(WHERE f.document->>'rating'='helpful'),count(*) FILTER(WHERE f.document->>'rating'='not_helpful') FROM skill_application_feedback f JOIN skill_applications a ON a.tenant_id=f.tenant_id AND a.id=f.application_id WHERE a.tenant_id=$1 AND a.skill_id=$2`, tenant, r["id"]).Scan(&feedback, &helpful, &notHelpful)
		if err != nil {
			return nil, err
		}
		rows, err = tx.Query(ctx, `SELECT i.determination,count(DISTINCT i.id) FROM skill_applications a JOIN investigations i ON i.tenant_id=a.tenant_id AND i.id=a.target_id WHERE a.tenant_id=$1 AND a.skill_id=$2 AND a.target_type='investigation' AND i.status IN ('closed','resolved') AND i.determination IN ('benign','suspicious','malicious','mitigated') GROUP BY i.determination ORDER BY i.determination COLLATE "C"`, tenant, r["id"])
		if err != nil {
			return nil, err
		}
		outcomes := []map[string]any{}
		labeled := int64(0)
		for rows.Next() {
			var label string
			var count int64
			if err = rows.Scan(&label, &count); err != nil {
				rows.Close()
				return nil, err
			}
			labeled += count
			outcomes = append(outcomes, map[string]any{"label": label, "count": count})
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
		r["applications"] = applications
		r["case_applications"] = cases
		r["hunt_applications"] = hunts
		r["analyst_feedback"] = feedback
		r["helpful"] = helpful
		r["not_helpful"] = notHelpful
		r["labeled_closed_cases"] = labeled
		r["outcomes"] = outcomes
	}
	return map[string]any{"items": items, "provenance": "Workspace application records, analyst ratings, and closed/resolved case determinations. Sample counts are shown; no causal improvement is inferred."}, tx.Commit(ctx)
}
