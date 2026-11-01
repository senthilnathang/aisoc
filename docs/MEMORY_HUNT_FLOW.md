# Memory → Hunt → Investigate (local/mock)

Current approval contract: [independent proposer, approver and executor roles](INDEPENDENT_APPROVAL_ROLES.md). Outcome learning saves proposals; Memory requires independent approval before reuse, and responses require three distinct operators.

Hunt local search now records approved enterprise context alongside immutable
stored evidence. This extends existing Memory eligibility and Hunt run/promotion
contracts; it does not add a service, datastore, model call or migration.

## Operator flow

1. In **Memory**, save analyst-authored context or approve guidance from a resolved
   investigation outcome. Set validity dates as appropriate. Outcome-derived
   context retains source-case revision, evidence hashes, rationale and approver.
2. In **Hunt**, create/open a local hunt for the entity and choose **Run local
   search**. The query remains a literal phrase search of bounded tenant-local
   records. Its exact phrase and returned entity values are matched to Memory.
3. Inspect **Memory captured for this run**: content, version, matched entity,
   origin/author or approver, capture time, validity dates and source provenance.
   The panel distinguishes historical eligibility from current validity; current
   approval may have changed since capture. No expiry means no expiry configured,
   not a guaranteed-fresh observation.
4. Select prior runs using Search history. Their Memory snapshots never change
   when an insight is edited, archived, expires or loses source approval.
5. Review a finding and explicitly promote it. The new investigation retains the
   original run's Memory in Hunt provenance and its evidence artifact. It starts
   with unknown determination. Historical context is not reapplied as current
   approved Memory, and no containment is authorized.
6. Memory's usage dialog now has separate **Investigation applications** and
   **Hunt applications**, with links back to hunts and exact captured versions.
   Registry counts retain their existing investigation-only 30-day meaning.

```mermaid
sequenceDiagram
 participant A as Analyst
 participant M as Go Memory
 participant H as Go Hunt
 participant DB as PostgreSQL
 participant I as Investigation
 A->>M: Save verified context / approve outcome
 M->>DB: Versioned context and approval provenance
 A->>H: Run local search (request ID + expected hunt revision)
 H->>DB: Lock hunt, search tenant-local evidence
 H->>DB: Exact Memory matches + validity + source revision checks
 H->>DB: Atomic immutable run snapshot + Memory-use audit
 H-->>A: Findings and advisory captured context
 A->>H: Explicitly promote a stored finding
 H->>I: Original run context and evidence provenance
 Note over H,I: Replay reuses receipts; verdict is not inferred from Memory
```

## Eligibility, safety and bounds

The authenticated tenant applies throughout. Entity matching reuses Memory's
lowercase/trim normalization and exact keys. Hunt query text is not parsed as a
command, and caller-provided `insight_refs` cannot grant Memory applicability.
Only analyst-authored/reviewed origins with an identified creator are eligible.
Learned context also requires `aisoc_learning_current`: its approved source
revision must still exist, remain resolved/closed with an eligible determination,
and match the current committed source outcome. Existing explicit reapproval
restores eligibility for later runs. Expired, future-dated, archived, unapproved
and source-stale records are omitted; absence never means benign.

Validity is evaluated in the search transaction using the existing PostgreSQL
validity semantics. The snapshot records eligibility at capture, not a promise
about future approval or real-world truth. Editing/archiving Memory does not
retroactively invalidate historical evidence records. This is single-operator
independent local approval; external identity provisioning remains future work.

At most 20 snapshots and 64 KiB of encoded context are captured per run. The
`memory_truncated` flag explicitly reports a limit; findings are not altered by
this cap. Matching includes the query and entities from at most 100 returned
records. Context is run-level: individual snapshots may relate to different
findings; `matched_entity` makes the relationship explicit.

## Implementation and contracts

- `insights.HuntSnapshots` and sqlc `HuntMatchingInsights` reuse Memory record
  serialization and existing eligibility rules, with local Hunt bounds.
- `hunts.Store.Search` records `memory`, `memory_policy` and `memory_truncated`
  inside `hunt_search_runs.document`, together with immutable query/findings.
- Run ID, actor and expected hunt revision retain existing replay/conflict rules.
  Replay returns the saved snapshot, not today's context, and adds no duplicate
  audit. A new run ID is required to evaluate current Memory.
- `applied_to_hunt` audits include Memory version, hunt/run IDs, matched artifact
  and actor. Run persistence and these audits share one transaction.
- `hunts.Store.Promote` copies the same snapshot into promotion provenance and the
  case artifact. It does not fill active case `insight_refs` from old Memory.
- `GET /api/v1/enterprise-insights/{id}/uses` adds `hunt_items` with hunt ID, run ID,
  title, capture time and snapshot. Foreign tenants get no usage records.
- React `HuntMemory` is shared by Hunt and investigation provenance. Existing
  stored runs without `memory_policy` are labeled as older runs without a Memory
  eligibility capture; no historical data is fabricated.

No schema migration is required. Snapshots persist in existing run/promotion JSON.
Deleting a hunt follows existing semantics: its search runs (and their usage
view) are removed; promotion receipts/artifacts retain copied provenance. Memory
archive is not deletion. Hunt usage is a bounded local JSON lookup, not a claim
of production-scale analytics; high-volume usage needs measured indexing work.

## Tests and rollback

Database tests cover expired/future/archived/unapproved/source-stale exclusion,
exact matching, immutable replay after edits, promotion of original context,
foreign usage isolation, bounded context and audit-failure rollback. The full
Detect-to-Build suite adds actual outcome approval → Hunt → source change →
reapproval → archive → historical promotion, with tenant-negative and replay checks.
Frontend tests distinguish current validity dates from historical approval.
Browser coverage checks snapshots, history, Memory usage navigation and promotion.

Rollback restores prior binaries/frontend while preserving additive JSON fields.
Older code ignores those fields; it cannot capture new Memory snapshots and may
omit them if it creates a promotion. Prefer forward fixes when snapshot continuity
is required. No existing records, Redis state or production response policy changes.

## Verified local results — 2026-11-01

The final disposable Detect-to-Build acceptance run passed in 248.63 seconds,
including authenticated tenant negatives and the learned Memory → source change →
reapproval → archive → Hunt promotion sequence. PostgreSQL race tests passed for
context freshness, immutable snapshots, audit rollback and count/byte caps. All
11 frontend test files, lint/build, sqlc consistency and Go vet passed.

Real browser checks passed for capture, new-run expiry exclusion, original history,
promotion with unknown determination, Memory usage navigation and mobile layout,
with no page errors. The promotion comment now has an associated accessible label.
The retained showcase hunt is `HUNT-7542f88e`; promoted case `INV-fdea3c9c` retains
the original Memory snapshot. Memory was intentionally expired after capture.

An early full run hit an unrelated Redis-cache availability assertion; the final
full run passed that test. Browser/API test expectations were corrected to compare
JSON structurally, preserve original snapshot dates and use the existing HTTP 200
promotion contract. Vite still emits its existing large-bundle warning.

Reports: ignored `output/platform-acceptance/` and `output/backend-framework/`.
Screenshots: `output/playwright/memory-hunt-current.png`,
`memory-hunt-promoted.png`, `memory-hunt-mobile.png`. Reproduce the browser flow
with `scripts/framework/memory-hunt-browser-check.js`; it retains labeled local
fixtures and does not execute a response or invoke external services.
