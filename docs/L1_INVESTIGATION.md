# Typed Python investigation and Go QA (S07 sandbox)

The independent Python FastAPI service now also registers
`aisoc.worker.v1.Investigator/Investigate` on its existing gRPC listener. The existing
Worker/Execute API and Rust specialists remain unchanged. FastAPI still provides
health, readiness and authenticated capabilities; investigation execution uses gRPC.

## Evidence and execution

`l1.LoadTask` is a read-only Go evidence adapter. It requires an admitted finding
under the trusted tenant/connector/source binding, reads its case ID and retained
envelopes in a consistent PostgreSQL snapshot, and verifies hashes and references.
Python receives only reference, content hash, event time and authentication type.
It receives no raw logs, source URLs, database/provider credentials or response tools.

`l1.QueueMock` explicitly creates one `python.investigate_mock` specialist job per
finding and version. A deterministic ID makes retries of enqueue idempotent, and a
tenant lock enforces the configured active-job admission cap (1–100). Duplicate
enqueue still succeeds at capacity. This uses the existing PostgreSQL `jobs` table;
there is no new queue, automatic LLM-per-event fan-out or HTTP enqueue API.
Migration 023 extends the existing database plugin allowlist with the mock ID.
Task/case identity is embedded in the typed job input; no new case-link table is added.

The existing Go dispatcher supplies the claimed attempt ID and a fresh five-second
deadline, invokes the typed RPC, applies QA and only then commits output through the
existing fenced job completion. Failed RPC/QA follows existing bounded job retries.
Cancellation, expired leases and replaced attempts cannot commit via that store.
The result remains in `jobs.output`; [S08](MOCK_SOAR_RECONCILIATION.md) can explicitly
stage a review record and note-only mock SOAR draft from a completed result.

## Explicit mock behavior

Only `mock-v1` is accepted. Python emits two possible explanations—credential
compromise and legitimate user/automation—with citations to supplied observations.
These are alternatives, not tested conclusions. It always returns `INCONCLUSIVE`,
requires human review, and lists missing IAM/MFA context and endpoint process trees.
Its model version is `deterministic-mock-v1`. There is no LLM, calibrated confidence,
external enrichment, prompt execution, model spend or privileged action. An input
reference resembling an instruction remains an opaque citation.

Go QA checks tenant/case/task/attempt identity, schema/model version, deadline,
supported verdict, review requirement, competing hypothesis kinds, citation
membership/coverage, contradictory support/counterevidence references and required
missing evidence. Unknown protobuf fields are rejected at this strict sandbox
boundary. A valid citation establishes membership, not factual truth. No output can
authorize actions or close a case; stronger future model outputs require a reviewed
contract and evaluation policy.

## Budgets and limits

- Task/result envelope cap: 16 KiB; 1–16 unique evidence references. The Go evidence
  adapter currently supplies four observations from the admitted login finding.
- Task lifetime: at most 30 seconds; dispatcher RPC deadline: five seconds. Output
  budget: 512–16,384 bytes (the adapter requests 8,192).
- Python shares its existing four-RPC concurrency limit across services. Each Go
  dispatcher executes one specialist job at a time; worker process count bounds
  global specialist concurrency. Queue admission caps active mock work per tenant.
- Tool calls, model calls and model tokens: zero. Live model token/cost budgets,
  tenant-fair specialist scheduling and calibrated model quality evaluation remain
  production follow-ups; domain-job fairness from S06 does not extend to `jobs`.
- Event timestamps and hashes are validated, but there is no provider freshness SLA,
  live revision reconciliation or independent evidence verification. Late corrections
  require explicit follow-up; the mock does not establish that old evidence is fresh.

## Verification and rollout

`python3 scripts/framework/check.py --with-streams` covers:

- Go QA vetoes for foreign/stale identity, invented citations, contradictory refs,
  unsupported verdicts, omitted evidence gaps, expired deadlines and unknown fields.
- Real Python gRPC auth/duplicate credentials, typed validation, injection-shaped
  references and bounded requests; existing overload/cancellation tests remain.
- Read-only evidence isolation and idempotent/capped mock task enqueue after the
  Redis-to-finding-to-case flow in disposable PostgreSQL.
- Go-to-Python typed RPC and wrong-credential rejection, plus an actual durable
  dispatcher job that commits an inconclusive result only after Go QA.

These are contract/sandbox evaluations, not LLM accuracy, precision/recall or
production performance results. No live model or provider has been enabled.
Running foundation/release binaries and Python processes remain unchanged. Deploy
after applying source migrations (23 in total, still 37 tables). Migration 023 was
tested only in disposable databases; the running databases remain on 019. Deploy
Go/Python generated contracts together; an older Python service returns UNIMPLEMENTED
and normal bounded job retry applies. Rollback stops new mock enqueues and pauses or
cancels pending mock jobs before reverting the dispatcher; retain existing outputs.

See [task tracker](IMPLEMENTATION_TASKS.md), [finding admission](FINDING_ADMISSION.md)
and [protobuf contract](../contracts/proto/aisoc/worker/v1/investigation.proto).
