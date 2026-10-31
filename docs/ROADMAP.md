# Delivery roadmap

Updated 2026-10-30. The local backend migration is complete. Operational follow-up
and new product capabilities are separate from replacement parity.

## Completed local release

- [x] All 97 legacy routes implemented in Go for supported workflows.
- [x] PostgreSQL import reconciles all 26 legacy tables, history and credentials.
- [x] Durable investigation phases, retry, concurrency and crash recovery.
- [x] Skills authoring/materials, suggestions, matching, feedback and outcomes.
- [x] Detection versions, registry/intelligence, mapped intake and source keys.
- [x] Response plans, pinned runbooks, approvals and local simulations.
- [x] Optional bounded Rust/WASM and trusted Python runtime foundation.
- [x] Shared HTTP/auth tests, race/vet, browser checks, migration and recovery.
- [x] Controlled benchmarks, soak, backup/restore and post-write rollback rehearsal.
- [x] Go default in `run.sh`; tested optimized API and worker installed.
- [x] Independently runnable comparison stacks, stopped during normal operation.
- [x] Unused bundles removed; build output isolated; reference material organized.

The original release passed 42 local checks. The optimization campaign passed
per-operation latency thresholds with zero request errors. These are local results,
not production capacity guarantees. See [completion](migration/RELEASE_STATUS.md),
[performance](migration/PERFORMANCE.md) and [testing](TESTING.md).

## Operational follow-up

Completed local usability follow-up: `run.sh import-demo` supports all demo data,
the built-in showcase, and selected validated JSON files, with dry-run and replay
deduplication. The installation retains 70,000 demo events and ten showcase
investigations. [Import instructions](BENCHMARK_DATA_IMPORT.md) cover preparation,
scope changes, service restarts and verification.

The current local foundation uses migration 032, a supervised Go/Python stack,
fixture-tested configurable source readers, mock responses and archive-inclusive
restore validation. Three consecutive 60k runs exceeded 1,000 EPS, but a later
diagnostic baseline fell to 823 EPS. Repeatable throughput and latency stability
remain unmet. See [current evidence](PERFORMANCE_GATE.md).
See [local release gates](LOCAL_RELEASE_GATES.md) and the [delivery tracker](NEXT_DELIVERY_TASKS.md).
Remote deployment and vendor/model validation remain outside the selected local scope.

- [ ] Complete the minimum seven-day rollback window, then explicitly review legacy
  recovery cleanup. Retention expiry does not delete anything automatically.
- [ ] Install production supervision and backup schedules where needed. Local foundation supervision is running; templates exist.
- [ ] Add encrypted off-host backup storage, retention and failure notifications.
- [ ] Add remote HTTPS deployment, SSO/RBAC, tenant provisioning, managed secret
  rotation, rate limiting, audit export and monitoring alerts.
- [ ] Establish production-like capacity/SLO targets and automate browser checks in CI.
- [ ] Continue investigating shared-host write-tail variation; the original 600 ms
  spikes did not reproduce in the fresh pre-edit baseline.
- [ ] Fix existing dashboard/hunt mobile overflow and reduce the large frontend bundle.

## Product work in dependency order

### Common architecture improvements (2026-10-31)

- [x] Expose finding-linked L1 progress, evidence, verdict, escalation and worker
  failures in the case Summary, with explicit mock labels and stale-data states.
- [ ] Connect and evaluate an actual local model: deferred by user; mock results
  are not a model-quality assessment.

- [x] Verify existing source-key/tenant boundary and reject ambiguous local tenant
  selectors. Preserve the transaction-level credential recheck and existing intake.
- [x] Introduce sqlc for the specialist job repository, preserving transaction
  ownership, tenant predicates and lease fencing. Other repositories remain incremental work.
- [x] Add bounded tenant-fair specialist worker dispatch with starvation/concurrency tests.
  PostgreSQL remains authoritative for durable job state.
- [x] Add optional Go/Python mTLS and peer identity checks, validated locally.
  Existing source key rotation/revocation remains transactional.
- [ ] Automate production PKI/secret rotation and remote deployment. Local-only
  authorization remains in effect.
- [ ] Re-run the strict performance gate on controlled storage; stable 1,000 EPS
  remains unverified. No new throughput claim follows from authentication changes.

These changes belong to `main`. RisingWave evaluation stays on its separate branch.

The Python FastAPI/gRPC prerequisite is implemented in the development framework:
independent lifecycle, bounded authenticated execution, standard gRPC health and
Go dispatcher integration. See [ADR 004](adr/004-python-fastapi-grpc-service.md).
The JSON QRadar-to-L1-to-mock-SOAR sandbox is implemented, including scoped
operations, retries, conflict review, monitoring and verified archive export.
Live vendor adapters and evaluated model reasoning remain subsequent work.

Streaming and agentic L1 work now follows the ordered
[implementation task tracker](IMPLEMENTATION_TASKS.md). The Redis boundary keeps
existing PostgreSQL investigation jobs; Redis will carry telemetry/findings first.

1. **Reusable integration framework and QRadar sandbox slice:** preserve existing
   intake and add capability-based adapters, starting with distinct mock SOAR case
   and SIEM evidence contracts. Verify installed versions/scopes before live access.
   Add bounded sync, cursors, deduplication, provenance and conflict-aware write-back;
   keep containment disabled. Sentinel, CrowdStrike and other providers reuse the
   framework as their adapters are validated. Managed credential rotation is separate.
2. **Evidence-backed tools:** source events, cited findings, replayable inputs/outputs
   and reviewable alert correlation.
3. **Structured analyst labels:** audited true/false-positive, benign/inconclusive
   classifications feeding measured detection and Skills tuning.
4. **Specialist reasoning:** evaluated capabilities, observable plans, bounded tools
   and monitor-only rollout. Runtime foundations already exist.
5. **Real response actions:** previews, authorization, approval, idempotency,
   provider results and recovery.
6. **Federated hunting/IOC extraction:** scoped cross-provider queries, provenance,
   expiry and analyst review.
7. **Enterprise context/reporting:** sourced entities, organization context, exports
   and reconciled operational metrics.

The [feature roadmap](FEATURE_ROADMAP.md) defines acceptance criteria. Stored
queries, demo metrics, simulations and vendor claims are not live provider execution.

## Current local delivery status — 2026-10-30

[Delivery tracker](NEXT_DELIVERY_TASKS.md) records the persisted 10,000-event demo,
main frontend on 8080, sandbox session revocation, verified payload offload, optional
JSON inference transport and read-only QRadar adapters. Three consecutive synthetic
runs completed 180,000/180,000 events at 1,063–1,104 EPS; the strict latency gate
remains open (p95 3.50–6.05 s). Live Ariel/source
mapping, SOAR write-back, Sentinel, model quality and production activation remain
separate gates. JSON fixtures do not establish live integration compatibility.

## React modernization — 2026-10-31

- Completed locally: React 19.3.1 upgrade, Chakra 2 compatibility, selective compiler activation, Hooks lint, browser regressions, clean install/audit and rollback documentation.
- Documented limitation: telemetry component opts out of Compiler 1.0; unsupported functions remain uncompiled.
- Follow-up: route-level bundle reduction, longer memory/browser-matrix evaluation, and targeted Actions/optimistic UX only where appropriate. These are not backend migration blockers.
- [Validation and performance report](REACT_19_MIGRATION.md).

## Navigation usability — completed 2026-10-31

- Detect → Overview is the default home selection; Overview is not a separate primary item.
- Shared menu configuration, consistent submenus, detail-page parent selection and mobile drawer are implemented.
- Desktop/mobile checks cover direct URLs, reloads, Back, keyboard focus and section navigation; production build and lint pass.
- The sparse demo detection-rule API failure is fixed and covered by database and desktop/mobile regressions.
- See the [navigation map](NAVIGATION.md) and [test guide](TESTING.md).

## Breadcrumbs — completed locally 2026-10-31

Shared menu hierarchy, clickable parent navigation and bounded tenant-scoped Go resource labels are implemented. Sparse metadata, missing resources, escaped labels and late responses are covered by tests. No schema migration is needed. Next UI work can proceed screenshot by screenshot, pairing visual states with verified backend behavior; Detect has been selected as the first screen family; the five public screenshots have been reviewed. See [contract and tests](BREADCRUMBS.md).

Proposed Detect work is recorded in the [five-screen 7AI review](SEVENAI_DETECT_REVIEW.md). Screenshot replication remains planned, not implemented. Start with Intelligence and its aggregation contract.

### Detection Intelligence screenshot implementation (2026-10-31)

Source/rule treemap, coverage and escalation views, search, linked-case drill-down, and responsive summary panels now use the tenant-scoped Go sqlc/pgx projection. Existing `/detect/intelligence` links remain valid; `/detect/detection-intelligence` is an alias. Coverage means linked alerts, not completed investigations. See [implementation, API, metric definitions and verification](DETECTION_INTELLIGENCE.md). Other Detect screenshots remain future work.
