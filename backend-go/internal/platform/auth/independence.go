package auth

import "aisoc/backend/internal/platform/fault"

// Keep every contributor to a pending revision, so a later edit cannot launder
// an earlier author's participation. Metadata is never accepted from clients.
func RecordProposer(doc map[string]any, actor string) {
	authors, _ := doc["proposal_authors"].([]any)
	for _, a := range authors {
		if a == actor {
			return
		}
	}
	doc["proposal_authors"] = append(authors, actor)
}
func Independent(doc map[string]any, actor string) error {
	known := false
	if a, ok := doc["created_by"].(string); ok && a != "" {
		known = true
		if a == actor {
			return selfApproval()
		}
	}
	if authors, ok := doc["proposal_authors"].([]any); ok {
		for _, a := range authors {
			if s, ok := a.(string); ok && s != "" {
				known = true
				if s == actor {
					return selfApproval()
				}
			}
		}
	}
	if !known || actor == "" {
		return fault.New(409, "PROPOSER_REQUIRED", "Save a new proposal with known authorship before approval.")
	}
	return nil
}
func selfApproval() error {
	return fault.New(403, "SELF_APPROVAL_DENIED", "An independent operator must approve this proposal; its authors cannot approve it.")
}
