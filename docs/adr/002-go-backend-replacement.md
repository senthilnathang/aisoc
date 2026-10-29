# ADR 002 Go Backend Replacement

## Status

Accepted on 2026-10-28; implemented and active after cutover on 2026-10-29.
See the [completion report](../migration/RELEASE_STATUS.md) and
[contract/runtime decisions](003-replacement-contract-decisions.md).

## Decision

Build a new modular Go backend for AISOC, preserving the React frontend and existing
HTTP API behavior. Use PostgreSQL as the target datastore. Run API and durable job
workers as separate Go processes sharing domain services.

Use Rust for a resource-limited WASM execution service and other measured heavy
workloads. Use Python only through optional isolated plugin workers where Python
libraries are needed. Go owns tenant authorization, business state, approvals, audit,
and core data writes. Specialist workers communicate through versioned typed contracts.

Develop and verify the replacement alongside the current service using separate ports,
databases, credentials, and test fixtures. Switch AISOC only after complete functional
replacement, data reconciliation, performance verification, and recovery rehearsals.
Do not perform a partial live migration or leave Node proxy dependencies.

## Rationale

Go provides a consistent core runtime for concurrent APIs and background work while
keeping deployment boundaries limited. PostgreSQL supports the intended shared
transactional data model. Specialist runtimes keep Python dependencies and WASM
execution outside the core process.

HyperBus supplies candidate infrastructure patterns; MetaGrid supplies candidate module
and plugin lifecycle patterns. Reuse requires adaptation and verification rather than
copying either platform wholesale. Language selection is not a performance guarantee.

## Consequences

- Existing features, tenant isolation, history, credential semantics, and simulations
  must be ported and tested before cutover.
- PostgreSQL introduces an operational dependency and requires a validated SQLite
  migration plus post-write rollback support.
- Rust and Python integrations need explicit resource budgets, cancellation,
  capability controls, and failure isolation.
- Redis, distributed brokers, analytics stores, and Temporal remain optional future
  decisions rather than default dependencies.
- The original TypeScript implementation stays operational during development and
  remains available for recovery through the agreed rollback window.
- Live external response execution and new product capabilities are outside this
  backend replacement scope.

## Delivery

Follow the [Go backend architecture and migration plan](../GO_BACKEND_MIGRATION_PLAN.md).
The plan defines the parity inventory, implementation phases, release gates, and
cutover sequence.
