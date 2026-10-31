# Detection Routing implementation plan

Approved direction: implement screen 5 of SEVENAI_DETECT_REVIEW.md inside existing Go-first/local framework. Use React/Chakra, typed Go/sqlc persistence and existing intake. No new infrastructure or privileged containment.

- [x] Add tenant configuration (ordered universal policies + entity lists), optimistic revision and atomic audit. Policies match exact source, severity, rule ID and optional entity-list membership; exceptions skip policies. Explicit AND between populated fields, first enabled match wins. Preserve per-rule fallback and protected Escalate routes. Bounded configuration, no regex/eval.
- [x] Add simulation of latest <=500 stored alerts, per-policy matched/impacted-rule counts, event explanations and replay receipt. Enabling/changing active configuration requires a recent receipt tied to proposed config/current revision; recheck frozen evidence. Persisted routing decisions contain configuration revision/policy/reason. No retrospective rerouting or quarantine.
- [x] Integrate evaluator with shared alert intake transaction; failure rolls back ingestion, replay keeps original decision. Stream findings retain required Escalate routing.
- [x] Build screenshot-inspired table with hierarchy arrows, statuses, exceptions, outcomes, last editor, search/status filters and draft/edit/archive controls. Add Per-Rule Routing using existing versioned rule writes, Audit Logs, Entity Lists and preview dialogs. Add canonical /detect/routing and screenshot alias, navigation/breadcrumbs.
- [x] Test evaluator precedence/exceptions/sampling/protected escalation, PostgreSQL isolation/CAS/receipt/audit/ingestion and frontend browser CRUD/preview/activation/conflict/responsiveness. Update architecture/readme/developer/testing/roadmap docs, review and commit.

Receipt scope is bounded historical alert replay, not a guarantee of future routing quality. Preview counts are only measured sample counts, never vendor screenshot values. Saving uses a tenant revision; concurrent editors must reload. Config changes are local intake policy, not external provider synchronization.
