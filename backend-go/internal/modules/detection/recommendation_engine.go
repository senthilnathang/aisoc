package detection

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"strings"
)

const recommendationDialect = "aisoc-exclusion-v1"

type LocalExclusion struct {
	Dialect string `json:"dialect"`
	Field   string `json:"field"`
	Value   string `json:"value"`
}
type RecommendationSample struct {
	ID              string `json:"id"`
	InvestigationID string `json:"investigation_id"`
	Title           string `json:"title"`
	Source          string `json:"source"`
	PrimaryEntity   string `json:"primary_entity"`
	Severity        string `json:"severity"`
	CreatedAt       string `json:"created_at"`
	Label           string `json:"label"`
	LabelVersion    int    `json:"label_version"`
	Rationale       string `json:"rationale"`
	Reviewer        string `json:"reviewer"`
}

func parseExclusion(raw string) (LocalExclusion, error) {
	var q LocalExclusion
	d := json.NewDecoder(strings.NewReader(raw))
	d.DisallowUnknownFields()
	if len(raw) > 2000 || d.Decode(&q) != nil || d.Decode(new(any)) != io.EOF || q.Dialect != recommendationDialect || !contains([]string{"source", "primary_entity"}, q.Field) || strings.TrimSpace(q.Value) == "" || len(q.Value) > 256 {
		return q, errors.New("unsupported query: use the bounded aisoc-exclusion-v1 JSON predicate")
	}
	return q, nil
}
func excluded(q LocalExclusion, a RecommendationSample) bool {
	if q.Field == "source" {
		return a.Source == q.Value
	}
	return a.PrimaryEntity == q.Value
}
func sampleHash(sample []RecommendationSample) string {
	raw, _ := json.Marshal(sample)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

type ReplayResult struct {
	Passed                bool   `json:"passed"`
	SampleSize            int    `json:"sample_size"`
	TruePositives         int    `json:"true_positives"`
	TruePositivesRemoved  int    `json:"true_positives_removed"`
	FalsePositives        int    `json:"false_positives"`
	FalsePositivesRemoved int    `json:"false_positives_removed"`
	UnreviewedRemoved     int    `json:"unreviewed_removed"`
	SampleHash            string `json:"sample_hash"`
	Scope                 string `json:"scope"`
}

func replay(q LocalExclusion, sample []RecommendationSample) ReplayResult {
	r := ReplayResult{SampleSize: len(sample), SampleHash: sampleHash(sample), Scope: "Frozen triggered-alert sample; not provider query execution or full recall validation"}
	for _, a := range sample {
		removed := excluded(q, a)
		switch a.Label {
		case "true_positive":
			r.TruePositives++
			if removed {
				r.TruePositivesRemoved++
			}
		case "false_positive":
			r.FalsePositives++
			if removed {
				r.FalsePositivesRemoved++
			}
		default:
			if removed {
				r.UnreviewedRemoved++
			}
		}
	}
	r.Passed = r.SampleSize > 0 && r.TruePositives > 0 && r.FalsePositivesRemoved > 0 && r.TruePositivesRemoved == 0 && r.UnreviewedRemoved == 0
	return r
}
func suggest(sample []RecommendationSample) []LocalExclusion {
	candidates := map[string]LocalExclusion{}
	for _, a := range sample {
		if a.Label != "false_positive" {
			continue
		}
		for _, field := range []string{"primary_entity", "source"} {
			value := a.PrimaryEntity
			if field == "source" {
				value = a.Source
			}
			q := LocalExclusion{recommendationDialect, field, value}
			raw, _ := json.Marshal(q)
			if _, err := parseExclusion(string(raw)); err == nil && replay(q, sample).Passed {
				candidates[string(raw)] = q
			}
		}
	}
	keys := []string{}
	for key := range candidates {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		a, b := replay(candidates[keys[i]], sample), replay(candidates[keys[j]], sample)
		if a.FalsePositivesRemoved != b.FalsePositivesRemoved {
			return a.FalsePositivesRemoved > b.FalsePositivesRemoved
		}
		return bytes.Compare([]byte(keys[i]), []byte(keys[j])) < 0
	})
	out := []LocalExclusion{}
	for _, key := range keys {
		if len(out) == 3 {
			break
		}
		out = append(out, candidates[key])
	}
	return out
}
