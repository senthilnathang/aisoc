# RisingWave correlation POC

Status: prepared and local execution approved; **runtime execution deferred by
the user after the storage constraint, not yet verified**. The active
Go/PostgreSQL/Redis/Python services and demo data are unchanged. No broker, SQL
analytics service, production response or application migration is activated.

## Scope and semantics

[The experiment](../backend-go/internal/experiments/risingwavepoc/poc_test.go)
compares SQL finding evidence edges with the existing Go `SuspiciousLogins` rule:
three distinct failures strictly before success within five minutes, matching
tenant, connector, source, principal, asset and canonical IP. The last three
failures are selected by event time and identity, preserving the Go tie-break.
This is not the proposal's different failed-login-count-by-IP detector.

Fixtures use three tenants and a second connector with shared user/IP values.
Only tenant A's first connector should produce one finding. Fixtures also include
an older fourth failure, an out-of-window failure and a failure exactly at success
time; none may displace the three strictly preceding failures. Partial/out-of-order
input has no finding; a delayed failure completes it; exact replay does not add
evidence. Go validates binding and content, canonicalizes IPv4-mapped IPs and
computes identities before SQL insertion. Fixture conflicts and forged tenant
values are rejected in Go tests. RisingWave's table conflict policy alone is not
content-conflict detection or an authenticated gateway.

The [SQL](../backend-go/internal/experiments/risingwavepoc/schema.sql) creates a
bounded-fixture table, self-join, top-three view and qualifying finding edges.
It deliberately does **not** claim production watermark eviction, TTL, rule
suppression, changelog retractions, authentication, hard tenant isolation or
restart/replay guarantees. The finite fixture is an authoritative snapshot;
production late-data/finality needs a separate versioned contract and test suite.

## Run without new infrastructure

From `backend-go`:

```bash
go test -race -count=1 -v ./internal/experiments/risingwavepoc ./internal/modules/telemetry
go test -run '^$' -bench BenchmarkGoReference -benchmem ./internal/experiments/risingwavepoc
```

The first command passes Go fixture/contract tests and explicitly skips
`TestRisingWaveParity` when no endpoint is configured. A package-level PASS with
that skip is **not** evidence that RisingWave SQL executed. The Go microbenchmark
measures a tiny in-process fixture, not sustained ingestion or networked parity.

## Execute against an isolated local RisingWave instance

Candidate release: [v3.1.0](https://github.com/risingwavelabs/risingwave/releases/tag/v3.1.0),
identified from upstream release documentation during this review. Runtime SQL
compatibility is unverified until the test executes. Pin an image digest when
provisioning; do not use a floating `latest` tag. Upstream's full Compose example
includes multiple services and large memory settings; do not start it unchanged
on this shared host (98% disk used, swap nearly full at review time).

Use a dedicated loopback-only development instance at `127.0.0.1:4567`, database
`dev`, development user `root`, containing no customer data. The user approved a
disposable container limited to 2 CPUs/4 GiB and that loopback port; no `run.sh`
default is changed. No existing RisingWave image/endpoint was found. The approved
pull was stopped: the amd64 image totals ~2.35 GiB compressed, while free disk fell
to ~3.2 GiB (99% full) before extraction completed. No unrelated Docker data was
pruned. The user then explicitly deferred runtime execution and requested that
the remaining work continue. Resume this step only when local capacity is suitable.

From `backend-go`, after the isolated runtime is available:

```bash
AISOC_RISINGWAVE_ADDR=127.0.0.1:4567 \
AISOC_RISINGWAVE_REPORT=/tmp/aisoc-risingwave-parity.json \
go test -count=1 -run '^TestRisingWaveParity$' -v ./internal/experiments/risingwavepoc
```

The test refuses non-loopback addresses and checks the server identifies itself
as RisingWave before mutation. It creates a uniquely named `aisoc_rw_poc_*`
schema, uses parameterized inserts, and drops only that schema on exit. It has a
120-second total deadline, bounded observation waits and a cleanup timeout. If
cleanup fails, the test fails and prints the generated schema name for inspection.
It never connects to the application database or executes containment actions.

The JSON result records actual server version, whether RisingWave was reached,
parity outcome and two phase durations. Those durations include inserts, network
and polling (plus explicit flush for replay), and are not p95/p99 detection SLOs.
Report Go in-process timings separately rather than presenting a misleading speed
ratio. No EPS, HA, memory or cost certification follows from this fixture.

## Next measurements, before adoption

Run the same source fixture and rule version through both complete ingestion
paths; measure durable acceptance to visible finding, not just function execution.
Record cgroup CPU/RAM, object/state growth, checkpoint/recovery, network and broker
lag. Test timestamp boundaries/ties, beyond-watermark events, duplicate conflicts,
corrections/retractions, hot entities, tenant skew, rule upgrade/backfill and lost
ACKs. Repeat sustained/burst/failure runs on controlled hardware before progressing
from 1k to 10k/50k/100k/1M aggregate EPS. Realistic 2 KB distributions are separate
from the existing ~490-byte projected fixture.

No broker is necessary for this finite SQL parity step. The later durable ingestion
POC chooses one broker after [ADR 006's gates](adr/006-streaming-data-plane-evaluation.md).

## Results as of 2026-10-31

Go race-enabled experiment and telemetry contract tests passed. The real RisingWave
test explicitly skipped without an endpoint. The 14-input Go reference fixture
microbenchmark measured 103,116 ns/op, 25,981 B/op and 211 allocations/op on the
shared Intel i5-8365U host (linux/amd64). This is in-process computation, not EPS
capacity or a comparable RisingWave service measurement. The
[result record](benchmarks/risingwave-poc-2026-10-31.json) marks SQL parity, runtime
latency/resource use, restart recovery and 1M EPS as unverified/unmeasured.
