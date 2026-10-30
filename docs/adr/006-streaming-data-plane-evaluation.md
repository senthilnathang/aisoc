# ADR 006: Evaluate a separate streaming data plane

Date: 2026-10-31. Status: **evaluation decision recorded; production adoption deferred**.
This extends ADR 005's bounded sandbox direction; it does not replace its live path.

## Context

The proposed 1M EPS is aggregate tenant telemetry. Current PostgreSQL admission,
publication receipts and inbox effects remain in every event's path, and repeated
1k EPS latency gates fail. RisingWave is absent from the active framework; Redis
is telemetry transport/cache, while durable agent jobs already use PostgreSQL.

## Decision

Preserve Go orchestration/auth/action policy, Python FastAPI/gRPC and transactional
PostgreSQL. Evaluate RisingWave as an optional shadow correlation engine with the
existing Go `SuspiciousLogins` function as the bounded reference. Keep specialized
Rust processing conditional on measurement. Do not translate every detector twice.

For the proposed sustained high-volume/replay requirement, evaluate a durable
partitioned event log. **Apache Kafka is the first evaluation baseline**, not an
installed or benchmark-selected winner. Choose Redpanda instead only if measured
operational/resource benefits and selected-version feature/licensing review justify
it. Never deploy both to solve the same pipeline requirement.

| Option | What must be established | Current conclusion |
|---|---|---|
| Existing Redis + PostgreSQL | Bounded backlog, replay, local operational simplicity | Keep for current demo; not validated for aggregate 1M EPS |
| Kafka | Producer/consumer compatibility, replicated ACK failure model, quotas, partition skew, managed/self-hosted cost | First broker evaluation candidate; no capacity claim |
| Redpanda | Same tests plus exact Kafka API/transaction/connector compatibility and commercial feature requirements | Alternative candidate, not a second backbone |
| RisingWave without external log | Required independent replay, fan-out and raw-history retention | Not selected for the proposed long-retention backbone |

A Kafka-compatible client interface must not hide broker-specific delivery,
transaction, retention or failure semantics. Run the same failure suite against
the chosen version. Defaults are not durability requirements.

Shared control plane with pooled data planes is a target for standard tenants;
dedicated deployments/credentials/keys are the target for hard isolation or high
volume. Tenant SQL predicates do not prove authorization. The placement controller,
resource isolation and tenant migration mechanism are missing and require design.
SaaS versus hybrid/on-prem remains open; contracts should preserve provenance and
support evidence references even when raw data stays at the customer edge.

## Adoption gates and consequences

1. POC parity on the same rule/evidence, including duplicates, late inputs and
   tenant/connector separation; prove actual runtime execution, not only SQL text.
2. Select broker/version/topology and prove acknowledged-data/replay guarantees
   under named failure scenarios. Benchmark stateful rules, not just empty pipes.
3. Implement durable finding/job admission before optional Redis coordination.
4. Pass threat-model gates, capacity/cost review and rollback rehearsal.
5. Obtain approval for infrastructure activation/cutover and any breaking schema
   migration; privileged response activation remains separately scoped.

This adds stateful infrastructure, observability, upgrades, credentials and recovery
cost. Object storage is justified for a selected production RisingWave deployment,
not automatically provisioned for the existing application. Retire the per-event
PostgreSQL path only after the new durability/replay boundary is demonstrated.

Rollback is feature-flagged shadow disablement until cutover. After cutover, retain
broker offsets and replay material, version rules and drain findings before changing
owners. Do not silently switch acknowledgement semantics mid-source cursor.

See [repository gap analysis and PR gates](../RISINGWAVE_1M_REVIEW.md). No final
production Kafka-vs-Redpanda or RisingWave adoption verdict can honestly be based
on the current local measurements; this ADR records that deferral explicitly.
