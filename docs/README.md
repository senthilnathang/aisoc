# Documentation index

Current architecture and local migration status: 2026-10-29.

| Document | Purpose |
|---|---|
| [Root README](../README.md) | Running application, capabilities and repository layout |
| [Architecture](ARCHITECTURE.md) | Go/PostgreSQL and optional specialist boundaries |
| [Developer guide](DEVELOPMENT.md) | Fresh checkout, local setup, conventions and checks |
| [Go guide](../backend-go/README.md) | Backend configuration and specialist runtime setup |
| [API contract](API_CONTRACT.md) | Supported HTTP behavior and auth/intake semantics |
| [Data model](DATA_MODEL.md) | Logical entities and physical PostgreSQL mapping |
| [Frontend integration](FRONTEND_INTEGRATION.md) | Routes, API transport and UI boundaries |
| [Testing](TESTING.md) | Suite coverage, commands, browser evidence and limits |
| [Delivery roadmap](ROADMAP.md) | Completed work and prioritized follow-up |
| [Feature roadmap](FEATURE_ROADMAP.md) | Product acceptance criteria beyond migration |
| [Migration completion](GO_BACKEND_MIGRATION_PLAN.md) | Completed phases and recovery constraints |
| [Release receipt](migration/RELEASE_STATUS.md) | Original cutover checks and retained evidence |
| [Operations](migration/OPERATIONS.md) | Lifecycle, auth, backups, upgrades and rollback |
| [Performance](migration/PERFORMANCE.md) | Absolute results, optimizations and measurement limits |
| [ADR 002](adr/002-go-backend-replacement.md) | Accepted backend replacement decision |
| [ADR 003](adr/003-replacement-contract-decisions.md) | Intentional contract/runtime differences |
| [ADR 004](adr/004-python-fastapi-grpc-service.md) | Independent Python FastAPI lifecycle and Go gRPC boundary |
| [Python service](../services/python-worker/README.md) | Startup, health, capabilities and worker contracts |

[Phase-zero notes](migration/PHASE_0_STATUS.md), [Node baseline](migration/NODE_BASELINE.md),
[ADR 001](adr/001-local-modular-monolith.md) and
[vendor technology observations](BACKEND_TECHNOLOGY_ASSESSMENT.md) are historical
context. They do not describe the active backend. The original assessment and
visual references live under `reference/`; generated verification receipts live
under ignored `output/` and are not guaranteed on a fresh checkout.
