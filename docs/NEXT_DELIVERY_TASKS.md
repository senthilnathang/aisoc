# Persistent demo and operational foundation

Scope: local JSON data, local deployment, production configuration prepared only;
sandbox session revocation. Live vendor/model verification is not claimed.

| Work | Acceptance | Status |
|---|---|---|
| Persistent showcase | 10,000 synthetic events, replay-safe seed, scoped API pagination and browser evidence | Loaded: ten demo sources, ten synced investigations |
| P1 performance | Reduce SQL/locking costs while preserving idempotency and faults; repeat comparable load tests | Implemented and measured; stable 1,000 EPS gate remains open |
| P1 integrations | Versioned source adapters, bounded polling/replay and fixture contracts | Read-only QRadar transport and JSON contracts tested; live mapping/write-back/Ariel/Sentinel not validated |
| P1 inference | Preserve typed gRPC; configurable model adapter and local evidence evaluation | Go/Python/JSON service contract tested; real model quality and production scheduling not enabled |
| P2 continuous ingestion | Bounded correlation windows, verified retention/replay and dedup preservation | Verified payload offload frees hot capacity; identities/dedup retained; bounded metadata ceiling |
| P2 operations | Local supervision plus production TLS, encrypted backup and alert configuration; no external activation | Supervisor crash recovery and encryption round-trip passed; production templates prepared |
| P3 responses | Sandbox session revocation, explicit approval, idempotency, audit, kill switch and compensation semantics | Implemented; expiry, denial, rollback and replay tested; no live IAM calls |

## Showcase

Open `http://127.0.0.1:8080/build/stream-operations` (alias `/build-operations`) and select `demo-showcase-01`
through `demo-showcase-10`. Each source retains 1,000 synthetic events and one
suspicious-login investigation with a mock SOAR note. The telemetry table reads
through Go API 3003, uses keyset pagination and reveals the stored JSON on demand.
The prior four-event fixture is also retained under `mock-qradar`.

There is one main frontend. `run.sh` reads the private `.run/runtime-profile`, now
`foundation`, and starts the supervised Go/Python/Streams stack on API 3003.
The extra 8082 demo preview is stopped. `./run.sh stop backend` stops the supervisor
and its owned services while preserving data. Release API 3002/database 55436 remain
separate; switching profiles never copies or overwrites records.

`python3 scripts/framework/demo.py --configure` adds only the known private demo
grants; restart foundation to load them, then run the script without flags. Repeats
deduplicate events. It does not load anything into release database 55436.

## Continuous intake and retention

Migration 029 adds archive references. Verified archive export replaces eligible
old payloads with source-identity pointers in the same transaction as audit and
completed-work compaction. Original hashes, checkpoints, inboxes and event keys
remain. Evidence readers and the telemetry API verify and resolve archive content.
Corruption or missing files fails closed. Case-referenced evidence is excluded.

The hot-payload budget is configurable with `max_hot_events` (100–10,000, default
1,000), alongside the 16 MiB byte cap. Archived events no longer spend that budget.
Retained identity metadata is capped at 100,000 events per source; there is no
unbounded database or destructive tombstone expiry. Size limits from actual source
rate/replay requirements before deployment. Correlation groups by identity/asset/IP,
retains a 100-event per-entity window bound and reports capacity instead of dropping
overflow. Multiple conflicting source revisions require authoritative resolution.

```bash
python3 scripts/framework/archive.py --scope demo-showcase-01 --min-age-days 7
```

This archives only genuinely eligible old completed events; it does not age demo
data artificially. Timer templates are opt-in. Preserve `.run/go-dev/archives/`
with database backups: a database dump alone cannot restore offloaded payloads.
Restore archives at their recorded locations before starting restored services.

## Sandbox session revocation

Only `demo-showcase-01` has the separate sandbox-response grant. Its panel supports
session creation/inspection, proposal, five-minute approval, dry run, execution and
an explicit kill switch. The switch defaults to stopped. Ten executions/minute and
100 retained sessions/actions per source bound the fixture. Replay never revokes
twice; a failed audit rolls back the action. Revocation is not honestly reversible:
simulate reauthentication with a new session ID, preserving the revoked session.
These APIs cannot contact IAM and production config refuses sandbox grants.

## Operations and integration limits

The local supervisor is running with private PID/log files under `.run/go-dev/`.
Stop its verified PID before manual foundation maintenance; it otherwise restarts
missing owned workers. Production systemd/TLS/backup/alert configuration is in
[deployment preparation](../deploy/production/README.md). No off-host destination,
public TLS endpoint, external alert destination or production response was activated.

[Adapter documentation](INTEGRATION_ADAPTERS.md) distinguishes fixture-tested
transport from live integration and inference. The user supplied JSON/local scope,
not vendor versions, credentials, model endpoint or analyst-labelled evaluations.
Those remain explicit production acceptance gates, rather than claimed completions.
