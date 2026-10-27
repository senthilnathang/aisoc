export type Severity = "low" | "medium" | "high" | "critical";
export type InvestigationStatus = "open" | "investigating" | "contained" | "resolved" | "closed";
export type Determination = "unknown" | "benign" | "suspicious" | "malicious" | "mitigated";
export type ThreatReportType = "threat_report" | "advisory" | "ioc_feed" | "hunt_pack";
export type ThreatReportStatus = "new" | "reviewing" | "actionable" | "archived";
export type ThreatHuntStatus = "not_started" | "hunting" | "completed" | "no_findings";
export type IndicatorType = "ip" | "domain" | "hash_sha256" | "hash_md5" | "url" | "email" | "cve";
export type IndicatorStatus = "active" | "mitigated" | "expired" | "false_positive";

export interface ListOptions {
  search?: string;
  status?: string;
  severity?: string;
  limit?: number;
  offset?: number;
  investigationId?: string;
  reportId?: string;
}

export interface ResourceRecord {
  id: string;
  tenant_id: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}
