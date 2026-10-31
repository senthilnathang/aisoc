package detection

import (
	"aisoc/backend/internal/modules/detection/detectionsql"
	"aisoc/backend/internal/modules/investigations"
	"aisoc/backend/internal/platform/fault"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"math"
	"strings"
	"sync"
	"time"
)

//go:embed reference/enterprise-17.1.json
var referenceJSON []byte

//go:embed reference/LICENSE.txt
var referenceLicense string

const referenceVersion = "17.1"

type AttackTechnique struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Tactics      []string `json:"tactics"`
	URL          string   `json:"url"`
	Subtechnique bool     `json:"subtechnique"`
}
type AttackTactic struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type AttackReference struct {
	Version    string            `json:"version"`
	Source     string            `json:"source"`
	SHA256     string            `json:"sha256"`
	Tactics    []AttackTactic    `json:"tactics"`
	Techniques []AttackTechnique `json:"techniques"`
}

var referenceOnce sync.Once
var referenceData AttackReference
var referenceError error

func attackReference() (*AttackReference, error) {
	referenceOnce.Do(func() { referenceError = json.Unmarshal(referenceJSON, &referenceData) })
	return &referenceData, referenceError
}

type CoverageRule struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Enabled    bool     `json:"enabled"`
	Version    int      `json:"version"`
	Techniques []string `json:"techniques"`
}
type CoverageAssessment struct {
	TechniqueID      string    `json:"technique_id"`
	ReferenceVersion string    `json:"reference_version"`
	State            string    `json:"state"`
	EvidenceRef      string    `json:"evidence_ref"`
	Notes            string    `json:"notes"`
	RuleID           string    `json:"rule_id"`
	RuleVersion      int       `json:"rule_version"`
	Reviewer         string    `json:"reviewer"`
	ReviewedAt       time.Time `json:"reviewed_at"`
	ExpiresAt        time.Time `json:"expires_at"`
	Version          int       `json:"version"`
}
type CoverageTechnique struct {
	AttackTechnique
	Rules      []CoverageRule      `json:"rules"`
	Assessment *CoverageAssessment `json:"assessment"`
	Status     string              `json:"status"`
}
type CoverageTactic struct {
	AttackTactic
	Total           int            `json:"total"`
	Eligible        int            `json:"eligible"`
	Mapped          int            `json:"mapped"`
	Covered         int            `json:"covered"`
	Assessed        int            `json:"assessed"`
	States          map[string]int `json:"states"`
	CoveragePercent *float64       `json:"coverage_percent"`
	MappingPercent  float64        `json:"mapping_percent"`
}
type CoverageResult struct {
	Reference            map[string]string   `json:"reference"`
	AsOf                 time.Time           `json:"as_of"`
	Tactics              []CoverageTactic    `json:"tactics"`
	Techniques           []CoverageTechnique `json:"techniques"`
	UnrecognizedMappings []string            `json:"unrecognized_mappings"`
}
type coverageInputs struct {
	AsOf        time.Time            `json:"as_of"`
	Rules       []CoverageRule       `json:"rules"`
	Assessments []CoverageAssessment `json:"assessments"`
}

func contains(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
func percent(a, b int) float64 {
	if b == 0 {
		return 0
	}
	return math.Round(float64(a)*1000/float64(b)) / 10
}
func projectCoverage(ref *AttackReference, in coverageInputs) CoverageResult {
	out := CoverageResult{Reference: map[string]string{"version": ref.Version, "source": ref.Source, "sha256": ref.SHA256, "license": referenceLicense}, AsOf: in.AsOf, Tactics: []CoverageTactic{}, Techniques: []CoverageTechnique{}, UnrecognizedMappings: []string{}}
	known := map[string]bool{}
	for _, tech := range ref.Techniques {
		known[tech.ID] = true
	}
	byTechnique := map[string][]CoverageRule{}
	unknown := map[string]bool{}
	for _, rule := range in.Rules {
		seen := map[string]bool{}
		for _, id := range rule.Techniques {
			if seen[id] {
				continue
			}
			seen[id] = true
			if !known[id] {
				if !unknown[id] {
					out.UnrecognizedMappings = append(out.UnrecognizedMappings, id)
					unknown[id] = true
				}
				continue
			}
			byTechnique[id] = append(byTechnique[id], rule)
		}
	}
	assessments := map[string]*CoverageAssessment{}
	for i := range in.Assessments {
		a := &in.Assessments[i]
		assessments[a.TechniqueID] = a
	}
	tacticIndex := map[string]int{}
	for _, tactic := range ref.Tactics {
		tacticIndex[tactic.ID] = len(out.Tactics)
		out.Tactics = append(out.Tactics, CoverageTactic{AttackTactic: tactic, States: map[string]int{}})
	}
	for _, tech := range ref.Techniques {
		rules := byTechnique[tech.ID]
		if rules == nil {
			rules = []CoverageRule{}
		}
		a := assessments[tech.ID]
		state := "unassessed"
		if a != nil {
			state = a.State
			if !a.ExpiresAt.After(in.AsOf) {
				state = "expired"
			} else if state == "covered" {
				valid := false
				for _, r := range rules {
					if r.ID == a.RuleID && r.Enabled && r.Version == a.RuleVersion {
						valid = true
					}
				}
				if !valid || a.EvidenceRef == "" {
					state = "stale"
				}
			}
		}
		out.Techniques = append(out.Techniques, CoverageTechnique{AttackTechnique: tech, Rules: rules, Assessment: a, Status: state})
		for _, tid := range tech.Tactics {
			t := &out.Tactics[tacticIndex[tid]]
			t.Total++
			t.States[state]++
			if state != "not_applicable" {
				t.Eligible++
			}
			if state == "covered" {
				t.Covered++
			}
			if state != "unassessed" && state != "expired" && state != "stale" {
				t.Assessed++
			}
			for _, r := range rules {
				if r.Enabled {
					t.Mapped++
					break
				}
			}
		}
	}
	for i := range out.Tactics {
		t := &out.Tactics[i]
		t.MappingPercent = percent(t.Mapped, t.Total)
		if t.Assessed > 0 && t.Eligible > 0 {
			v := percent(t.Covered, t.Eligible)
			t.CoveragePercent = &v
		}
	}
	return out
}
func (s Store) Coverage(ctx context.Context, tenant string) (CoverageResult, error) {
	ref, err := attackReference()
	if err != nil {
		return CoverageResult{}, err
	}
	raw, err := detectionsql.New(s.Pool).CoverageInputs(ctx, detectionsql.CoverageInputsParams{TenantID: tenant, ReferenceVersion: referenceVersion})
	if err != nil {
		return CoverageResult{}, err
	}
	var in coverageInputs
	if err = json.Unmarshal(raw, &in); err != nil {
		return CoverageResult{}, err
	}
	return projectCoverage(ref, in), nil
}

type CoverageInput struct {
	State            string `json:"state"`
	EvidenceRef      string `json:"evidence_ref"`
	Notes            string `json:"notes"`
	RuleID           string `json:"rule_id"`
	RuleVersion      int    `json:"rule_version"`
	ExpectedVersion  int    `json:"expected_version"`
	ExpiresAt        string `json:"expires_at"`
	ReferenceVersion string `json:"reference_version"`
}

func (s Store) SaveCoverage(ctx context.Context, tenant, reviewer, id string, in CoverageInput) (int, error) {
	ref, err := attackReference()
	if err != nil {
		return 0, err
	}
	found := false
	for _, tech := range ref.Techniques {
		if tech.ID == id {
			found = true
			break
		}
	}
	if !found {
		return 0, fault.New(404, "NOT_FOUND", "Technique not found in pinned reference")
	}
	if in.ReferenceVersion != referenceVersion || !contains([]string{"unassessed", "gap", "covered", "accepted_risk", "alternative_control", "not_applicable"}, in.State) || in.ExpectedVersion < 0 || in.ExpectedVersion > 2147483646 || in.RuleVersion < 0 || in.RuleVersion > 2147483647 || reviewer == "" || len(in.EvidenceRef) > 1000 || len(in.Notes) > 4000 || len(in.RuleID) > 256 {
		return 0, fault.New(400, "VALIDATION_ERROR", "Invalid coverage assessment")
	}
	expires, err := time.Parse(time.RFC3339, in.ExpiresAt)
	if err != nil || !expires.After(time.Now()) || expires.After(time.Now().Add(366*24*time.Hour)) {
		return 0, fault.New(400, "VALIDATION_ERROR", "Review expiry must be within the next 366 days")
	}
	if in.State != "unassessed" && strings.TrimSpace(in.Notes) == "" {
		return 0, fault.New(400, "VALIDATION_ERROR", "Assessment rationale is required")
	}
	if contains([]string{"covered", "accepted_risk", "alternative_control", "not_applicable"}, in.State) && strings.TrimSpace(in.EvidenceRef) == "" {
		return 0, fault.New(400, "VALIDATION_ERROR", "Evidence or approval reference is required")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if in.State == "covered" {
		rule, version, err := get(ctx, tx, tenant, in.RuleID, true)
		if err != nil {
			return 0, err
		}
		mapped := false
		for _, tech := range rule["mitre_techniques"].([]any) {
			if tech == id {
				mapped = true
			}
		}
		if rule["enabled"] != true || !mapped || version != in.RuleVersion {
			return 0, fault.New(409, "VERSION_CONFLICT", "Verified coverage requires the current enabled mapped rule version")
		}
	} else {
		in.RuleID = ""
		in.RuleVersion = 0
	}
	// Existing local tenants may have no authored rule yet.
	if _, err = tx.Exec(ctx, `INSERT INTO tenants(id) VALUES($1) ON CONFLICT DO NOTHING`, tenant); err != nil {
		return 0, err
	}
	v, err := detectionsql.New(tx).SaveCoverageAssessment(ctx, detectionsql.SaveCoverageAssessmentParams{TenantID: tenant, TechniqueID: id, ReferenceVersion: referenceVersion, State: in.State, EvidenceRef: in.EvidenceRef, Notes: in.Notes, RuleID: in.RuleID, RuleVersion: int32(in.RuleVersion), Reviewer: reviewer, ExpiresAt: pgtype.Timestamptz{Time: expires, Valid: true}, ExpectedVersion: int32(in.ExpectedVersion)})
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, fault.New(409, "VERSION_CONFLICT", "Assessment changed. Reload before saving.")
	}
	if err != nil {
		return 0, err
	}
	details := map[string]any{"reviewer": reviewer, "state": in.State, "version": v, "reference_version": referenceVersion, "evidence_ref": in.EvidenceRef, "notes": in.Notes, "rule_id": in.RuleID, "rule_version": in.RuleVersion, "expires_at": expires}
	if err = investigations.ResourceAudit(ctx, tx, tenant, "detection_coverage", referenceVersion+":"+id, "assessed", details); err != nil {
		return 0, err
	}
	return int(v), tx.Commit(ctx)
}
