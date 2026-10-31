# Multi-tenant streaming threat model and isolation gates

Date: 2026-10-31. Proposed data plane, not a production security certification.
Assets: source credentials, raw telemetry, evidence, investigations, model context,
actions, tenant budgets and source/broker replay positions. Actors include hostile
tenant clients, forged source records, compromised workers, operators and privileged
infrastructure administrators. Tenant identity is authenticated at Go ingress.

| Boundary / threat | Required control | Negative test / evidence | Current status |
|---|---|---|---|
| Payload/header tenant spoof | Connector principal determines tenant and allowed source; reject mismatch | Same payload under two credentials; forged header/source; revoked/rotated key | Source-key HTTP intake binds stored tenant and rechecks under transaction lock; middleware route/scope tests cover local/token modes. Local ambiguous selectors rejected. Stream bindings exist; remote service identity remains incomplete |
| Broker cross-tenant read/write | Service ACLs, routing enforcement, quotas, topic/deployment tier | Tenant A cannot produce/consume B; forged key and wildcard ACL tests | Missing broker deployment |
| Partition hot-key denial of service | Bounded key cardinality, quotas, backpressure and reserved capacity | Large tenant + many small tenants; one entity floods; critical capacity remains available | Bounded local batches; specialist jobs have PostgreSQL tenant fairness/caps; telemetry and weighted distributed fairness remain pending |
| SQL/view leakage | Go-only query surface, scoped query allowlist, least-privilege grants; dedicated deployment for hard boundary | Missing predicates, malicious view, direct SQL credentials, privileged maintenance | Application scoping exists; hard database isolation remains unverified |
| Correlation contamination | Tenant + connector/source + entity keys; validated canonical projection | Same user/IP/event IDs in A/B and two connectors; cross-source joins explicit | Go negative checks; additional engines require their own parity tests |
| Replay/conflicting identity | Stable identity and content hash; conflict quarantine; revision policy | Exact duplicate, same key/different body, opaque revisions, replay after restart | Existing Go contracts; future broker bridge missing |
| Late or future timestamps | Clock-skew limits, explicit watermark/idle policy, replay lane | Boundary timestamps, delayed success/failure, idle partition, far-future event | Bounded Go watermark; distributed late-event policy missing |
| Finding update causes duplicate incident | Stable rule instance + revision, durable suppression/admission transaction | Repeated MV updates/retractions, crash between admission and offset commit | Current evidence-based finding dedup; streaming updates not designed |
| Redis queue loss | PostgreSQL job/outbox authority and recoverable dispatch | Flush/restart hint queue; job still discoverable exactly once for effects | Existing PG jobs; proposed Redis dispatcher missing |
| Compromised Python/Rust worker | No provider/DB credentials, tenant-scoped task/result validation, tool authorization in Go | Forged result tenant/attempt/evidence, excessive output, cancellation, injection | Typed bounded workers/QA; optional Go/Python mTLS and SAN checks locally tested; production PKI/rotation pending |
| Cross-tenant cache/RAG/evidence | Scope keys/retrieval by authenticated tenant and policy; object IAM | Same IOC with tenant-private annotations, guessed object ref, stale permission, cache poisoning | Cache scope exists; production object/RAG IAM unverified |
| Unsafe response/retry | Go approval, scoped target, idempotency and uncertain-result reconciliation | Lost provider ACK, duplicate approval, expiry, kill switch, wrong tenant target | Sandbox session revocation only |
| Privileged DB/admin access | Separate roles, RLS where appropriate, audited break-glass, dedicated planes | BYPASSRLS/admin queries, backup access, tenant restore, access after offboarding | App predicates/composite keys; no found RLS policies |
| Leaks through diagnostics | Redaction, bounded payloads, metadata-only traces and scoped dashboards | Secrets/PII in input, DLQ, exception, labels and model prompt | Existing bounded contracts; new data-plane paths must be evaluated |

Release gate: no observed cross-tenant disclosure or duplicate externally effective
actions in this defined suite; this is not a mathematical zero-risk claim. Test
low-privilege and maintenance roles separately, across replay, recovery and tenant
offboarding. Exercise at least two same-key tenants, one hot tenant and a reserved
critical lane. Track starvation duration, tenant lag, resource use, admission rejects
and operator overrides; aggregate throughput alone is insufficient.

Tenant deletion includes broker retention, correlation state/views, cache, evidence
objects, PostgreSQL, backups and model-provider retention obligations. Do not claim
instant erasure of immutable logs/backups. Dedicated planes do not remove control-
plane authorization obligations or privileged operator access risks.

Correlation key separation alone does not validate database user permissions,
resource pools, tenant IAM, compromise containment, broker durability or production
actions. Those remain explicit release blockers for any future data-plane engine.
