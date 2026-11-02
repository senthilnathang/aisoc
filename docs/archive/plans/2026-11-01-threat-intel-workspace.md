# Threat Intel workspace implementation plan

> Use native execution and a fresh final code review.

**Goal:** Reproduce the verified public report-table reference and complete real local report/IOC/hunt workflows.
**Reference:** 7ai.com/platform/threat-hunting, hunt-threat-intel-browser-2.png. No separate public report-detail screenshot was verified; detail is an AISOC continuation of that layout.
**Architecture:** Extend Go/PostgreSQL report storage with analyst metadata and atomic report-to-hunt links; use sqlc for new projection/link queries. Preserve legacy APIs but stop presenting simulated counters as findings.

- [x] Add metadata/linked-hunt migration, bounded registry projection, version guards and atomic idempotent local hunt creation.
- [x] Build shared report table and detail with metadata editing, IOC authoring, pagination, real counts and linked-hunt navigation; remove fallback data.
- [x] Verify tenant isolation, concurrency, rollback and UI desktop/mobile flows.
- [x] Update README, architecture, developer/API/data/test/roadmap documentation and commit.

Constraints: local-only; no feed polling, URL retrieval or model execution; no unsupported malicious/benign verdicts. Unknown actor/region/industry stay unknown. IOC counts come from rows, not manually supplied counters. Hunt creation does not imply execution. Reference content is untrusted text.

## Execution record

Implemented natively in the existing checkout. Verified only the public TI report-table screenshot; report detail is explicitly documented as an AISOC extension. Shared the registry with Hunt rather than maintaining competing tables. Preserved legacy counter-only launch APIs without using their unsupported execution claims in the UI.

PostgreSQL race/HTTP regression suite, sqlc drift, Go vet, frontend lint/build and nine frontend test files passed. New TI browser fixtures and prior Hunt fixtures passed at desktop/mobile widths. Review found deletion-sensitive request replay and delayed mutation navigation; fixed with retained link tombstones/410 semantics and mounted-screen guards, with database and browser regression coverage. No live queries, response actions or model calls enabled.
