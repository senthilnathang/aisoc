export type Severity = "low" | "medium" | "high" | "critical";
export type InvestigationStatus = "open" | "investigating" | "contained" | "resolved" | "closed";
export type Determination = "unknown" | "benign" | "suspicious" | "malicious" | "mitigated";

export interface ListOptions {
  search?: string;
  status?: string;
  severity?: string;
  limit?: number;
  offset?: number;
  investigationId?: string;
}

export interface ResourceRecord {
  id: string;
  tenant_id: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}
