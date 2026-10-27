# ADR 001: Local Modular Monolith With SQLite

## Status

Accepted for the initial implementation.

## Decision

Implement one TypeScript/Fastify service with domain-separated routes, services, and
repositories. Persist data in `backend/data/sqlite.db` using Node's built-in SQLite.

## Rationale

- Fast delivery and simple local operation
- Strong typing shared conceptually with the React client
- No native database package required on Node 24
- Domain boundaries can later become ConnectRPC services
- Repository interfaces isolate SQLite from the use cases

## Consequences

- Long-running workflows run synchronously or as local simulations initially.
- SQLite is not the intended multi-instance production database.
- REST DTOs must remain transport-neutral to avoid coupling services to Fastify.
