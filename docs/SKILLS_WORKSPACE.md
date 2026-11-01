# Skills workspace

## Reference and implemented screens

Reviewed the three public screenshots on [7AI Skills](https://7ai.com/platform/skills) on 2026-11-01:

| Image | URL visible in image | AISOC implementation |
| --- | --- | --- |
| `skills-1-main.png` | `app.sevenai.com/skills` | `/skills`: custom/augmented tabs, search/state/module filters, Name/Type/Module/State/Last updated columns, enablement switches, upload/create and pagination |
| `skills-2-okta-oauth.png` | `/skills/okta-oauth-grant-investigation` | `/skills/:id`: metadata strip, files panel, central `SKILL.md` editor, relevance sidebar |
| `skills-3-mfa-fatigue.png` | `/skills/mfa-fatigue-attack-detection` | The same editor with a different strategy and scope |

Images are hosted at `https://47518862.fs1.hubspotusercontent-na1.net/hubfs/47518862/` with the filenames above. AISOC retains its branding, navigation, existing data and UUID-based skill IDs. No separate augmented-list screenshot, preview implementation, ZIP import contract or hidden vendor workflow was verified. Those behaviors are defined below for AISOC.

The library uses persisted skills only. Custom includes non-environment-generated origins, including existing built-in guidance; augmented contains `environment_generated` skills accepted from reviewed environment suggestions. The tab does not activate inference. Templates remain unsaved starter drafts. The existing suggestions and outcomes pages are preserved.

## User workflow

1. Create a skill or upload `.md`, `.markdown`, or `.txt` instructions. Import is local text preparation, up to 100 KB and 30,000 JavaScript string units, excluding NUL bytes; no server write occurs until save. ZIP, executable content and front-matter configuration are not imported as settings.
2. Review the name, description, plain-language applicability, tags, instructions and relevance rules. `Preview` renders headings and text safely; raw HTML and links are not executed. It is not a complete Markdown renderer.
3. Save a draft, then publish when ready. Publishing enables matching. A published skill uses **Save changes**; there is no separate unpublished revision of a published skill. Future matches use the current version, while prior application snapshots remain unchanged.
4. Add references, checklists or examples using the preserved material APIs, version history and archive actions. Materials remain bounded to ten active items, with existing text-file/link validation; HTTPS references are stored, not fetched. A material change increments the parent revision. Reload saved guidance before subsequent instruction saves; copy unsaved edits first. The reload control explicitly warns before discarding edits.
5. Disable published guidance with the explicit on/off control. Guidance influences existing case/hunt matching and records application evidence; it does not run privileged response actions or enable a model.

Failures leave form text available. Existing-skill save+publish is one transaction. For a new skill, create-draft and publish are separate requests: if publish fails after creation, the UI opens the persisted draft for retry. Uncertain create delivery is not idempotent; inspect the library before retrying a creation after a lost response. Delayed save completion does not navigate after leaving the editor.

## Backend contracts

All endpoints are under `/api/v1`, using authenticated tenant/actor context.

| Endpoint | Contract |
| --- | --- |
| `GET /skills/library` | `search` up to 200 characters; `state=draft\|published`; `module`; `origin=custom\|augmented`; `limit=1..100` (default 25); `offset=0..1000000`. Reject unknown/duplicate query keys. Returns `items,total,published,drafts,limit,offset`. Counts cover all filtered rows, not the page. |
| `PATCH /skills/:id/workspace` | Required integer `expected_version` (1..2147483647); optional authored fields and boolean `publish`. Unknown fields rejected. Row lock, version comparison, document update and audit commit atomically. Stale revision returns 409 `SKILL_CONFLICT`. |
| `PUT /skills/:id/enabled` | Required `expected_version` and boolean `enabled`. Sets desired state for a published skill; it never toggles implicitly. A stale retry returns 409 rather than reversing state. |

Legacy CRUD, publish/toggle, materials, suggestions, feedback and outcomes endpoints remain. Legacy clients without a version precondition retain their existing update behavior; the new workspace always supplies one. The domain mutation boundary rejects protected identity/origin fields, malformed arrays, blank scope values and invalid revisions. Deletion now records a durable audit event in the same transaction.

`backend-go/internal/modules/skills/queries/workspace.sql` and generated `skillsql` implement parameterized library projections. Counts and rows share a read-only repeatable-read snapshot. Existing skill mutations continue using parameterized pgx and row locks. No migration or new service is required; the Skills baseline was schema 039; Enterprise Insights subsequently adds 040.

```mermaid
sequenceDiagram
 participant UI as React Skills workspace
 participant Go as Go Skills API
 participant DB as PostgreSQL
 UI->>Go: GET library (filters, page)
 Go->>DB: Repeatable-read counts and rows via sqlc
 Go-->>UI: Filtered totals and persisted skills
 UI->>Go: PATCH workspace (expected_version, fields, publish)
 Go->>DB: Lock tenant skill and compare revision
 alt stale or foreign
 Go-->>UI: Conflict or not found; preserve form
 else current and editable
 Go->>DB: Update guidance/version + audit atomically
 Go-->>UI: Saved skill
 end
 Note over Go,DB: Existing case/hunt matcher snapshots enabled guidance; no automatic response execution
```

## Verification and rollback

- Isolated PostgreSQL race tests cover >25 records, origin/search/tenant filtering, concurrent revisions, stale enablement, and rollback when auditing fails, including save+publish/deletion. Existing material concurrency, applications, feedback and outcomes tests remain included.
- HTTP contract tests reject invalid pagination, duplicate/foreign filters, missing revisions, unknown write fields and coerced/null boolean controls.
- `scripts/framework/skills-workspace-browser-check.js` intercepts domain writes. It checks totals/pagination, explicit enablement, safe preview, conflict preservation, import/publish retry, delayed navigation, empty states and desktop/mobile overflow. It does not modify the demo database.
- Run `python3 scripts/framework/check_detection_intelligence.py`, `make -C backend-go test`, `make -C backend-go sqlc-check`, `go vet`, frontend lint/build and `node --test tests/frontend/*.test.mjs`.

Rollback is code-only to the prior UI/API; retain all skill documents, material versions, applications and audit history. No destructive migration is involved.

Remaining: complete Markdown/file-tree editing, portable multi-file bundles, separately staged revisions of published skills, optimistic concurrency for legacy material endpoints, lost-response create idempotency, and live model evaluation. These are not implied by matching, publication, an augmented tab, or source examples.
