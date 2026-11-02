# Local retention and recovery implementation

Use existing Go/sqlc/PostgreSQL and React/Chakra. No scheduler, external storage or live integrations.

1. Add tenant-scoped configurable archive ages (1–3650 days), disabled by default; never automatically delete data.
2. Expose bounded candidate previews across Detect, Investigate, Respond, Hunt, Threat Intel, Skills, Memory and Build. Active/unread/unresolved records remain protected. Archive immutable record snapshots without removing domain evidence, replay receipts or audit references.
3. Bind explicit archive/cleanup actions to source digest and policy version; reject stale previews. Cleanup is restricted to the current recipient's read notifications after an identical archive snapshot exists. Restore those notifications without changing ownership or approval state. Other domain records stay in place; their snapshots are inspectable recovery material, not full standalone exports.
4. Add Build retention workspace, archive receipts, clear protected reasons and per-item confirmation. Persist atomic audit for mutations, role-gate controls and scope every query by tenant; notification operations additionally by recipient.
5. Extend database tests for stale previews, disabled policies, active protection, recipient/tenant denial, replay and restore conflicts. Extend existing two-clone archive-file restore rehearsal with policy/snapshot/audit recovery checks. Run full acceptance and browser tests; document limits and results.

Rollback: retain additive migration052 tables and deploy prior app. Never remove archive/audit history automatically.
