# Suspicious-login local end-to-end flow

Use existing Go intake/outbox/Redis/correlation, durable Python gRPC investigation, Go QA and mock SOAR reconciliation. No live provider/model/action activation or duplicate orchestrator.

- [x] Add an opt-in per-source analyst-review requirement, persisted on the existing escalation. Gate note synchronization in the same locked transaction; append-only approval with actor/comment and audit, tenant/source binding, idempotent retry. Additive migration 041; older scopes unchanged.
- [x] Expose the gate and approved receipt in the existing L1 case review UI; explicit note-only confirmation. No verdict/status/containment changes.
- [x] Add a versioned JSON suspicious-login scenario and bounded configurable CLI for grant setup, import, evidence/QA verification, replay and optional explicitly simulated approval. Reuse current service configuration and run.sh entry point.
- [x] Verify missing approval, wrong tenant/source, replay/concurrency, audit failure and source-version conflict; run actual Go/Redis/Python/mock-SOAR scenario and UI tests. Demonstrate the local scenario with clear mock labels.
- [x] Update architecture, API, developer/test/roadmap documentation and reconcile outdated milestone docs. Independent review and final checks.
