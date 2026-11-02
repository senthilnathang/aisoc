# Investigation workspace implementation plan

Approved scope: replicate the five publicly visible investigation screenshots within existing local Go/React architecture. All show the same case route, not five separate products. Preserve live local case evidence/review/runbooks/history and safe simulation boundaries.

- [x] Inventory/screens review: Summary entity overview, Report tool timeline + quicklinks, Remediation action cards, Artifacts graph/table + inspector, case copilot drawer. Document image/tab inconsistencies and differences from current implementation.
- [x] Go workspace projection from existing consistent case snapshot: typed evidence nodes/record-membership edges, report steps and bounded provenance. No inferred causal edges or fabricated reputations.
- [x] Add tenant/case/actor-bound evidence-lookup conversations via sqlc and additive migration; bounded literal retrieval with citation snapshots, idempotent sends and atomic audit. No configured general conversational model: clearly label local evidence lookup, abstain when no matching evidence, never run tools or execute retrieved instructions.
- [x] Build screenshot-inspired Summary/Report/Remediation/Artifacts/case drawer; preserve existing analyst review, local worker progress, feedback/artifact attachments, replay, runbooks and raw I/O. Persist selected tab in URL with screenshot route alias. Responsive graph/table and empty/error/loading states.
- [x] Test projection/lookup isolation, citation provenance, no-match/injection behavior, idempotency/audit rollback and UI flows/compiled build. Independent review, docs and commit.

Storage: reuse existing investigations, alerts, case_records, investigation_steps, remediations and audit; add only case evidence-lookup messages. Local evidence lookup is not LLM inference or external enrichment. Stored malicious content is displayed as text and cannot authorize operations. No vendor sample phishing verdicts or completion claims are imported as live facts.
