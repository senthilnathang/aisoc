package auth

// ApprovalOperator contains no credential or credential hash. It is used only by
// the local assignment coordinator; HTTP responses expose eligible IDs and roles.
type ApprovalBinding struct {
	Connector string
	Source    string
}
type ApprovalOperator struct {
	ID       string
	Roles    []string
	Bindings []ApprovalBinding
}

func (m *Manager) ApprovalOperators(tenant string) []ApprovalOperator {
	out := []ApprovalOperator{}
	for _, op := range m.config.Operators {
		if op.TenantID == tenant {
			out = append(out, ApprovalOperator{ID: op.ID, Roles: append([]string{}, op.Roles...)})
		}
	}
	if m.config.Mode == "local" {
		out = append(out, ApprovalOperator{ID: "local-development", Roles: []string{"proposer"}})
	}
	for i := range out {
		for _, scope := range m.config.StreamOperations {
			if scope.TenantID == tenant && scope.OperatorID == out[i].ID && scope.AllowSandboxResponse {
				out[i].Bindings = append(out[i].Bindings, ApprovalBinding{Connector: scope.ConnectorID, Source: scope.Source})
			}
		}
	}
	return out
}
