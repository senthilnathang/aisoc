# Rule Recommendations implementation plan

Approved scope: screenshot's rule-panel Recommendations view with source severity, explicit false-positive evidence, proposed query/explanation, Validate Query, Test Query, Apply and Dismiss. Preserve local-only operation; no invented model output or provider sync.

- [x] Persist tenant-scoped analyst alert labels and immutable local exclusion proposals (base rule version/query, bounded alert/label snapshot, window/provenance, receipts/status). Add sqlc contracts, atomic audit and optimistic writes.
- [x] Derive FP share only from explicit labels in the chosen window. Generate deterministic equality exclusions only from labelled false positives without excluding labelled true positives. Support a restricted local JSON predicate dialect; never execute SQL/KQL/AQL or external calls.
- [x] Validate syntax; replay a frozen bounded sample, check label/data freshness, require TP preservation + FP reduction and fresh receipt. Apply updates local rule query/version/snapshot atomically, only while rule disabled and original version unchanged; leave disabled. Dismiss auditable/idempotent. Expose unsupported provider sync honestly.
- [x] Implement screenshot-based panel, evidence labelling, receipts and guarded actions; preserve deep links. Test real database flow, concurrency/failure/isolation, UI/production build and docs.

Local query is a JSON exclusion predicate evaluated only by this sandbox replay harness. Baseline is the stored triggered-alert sample, not a re-execution of a provider query. Labelled-sample FP share is not the statistical FP/(FP+TN) rate; UI names the denominator. No recall guarantee outside the bounded sample. Only authoritative analyst labels drive suggestions, never benign verdict inference.
