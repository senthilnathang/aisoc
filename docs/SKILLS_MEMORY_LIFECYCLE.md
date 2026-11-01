# Skills and Memory lifecycle

Current approval contract: [independent proposer, approver and executor roles](INDEPENDENT_APPROVAL_ROLES.md). Outcome learning saves proposals; Memory requires independent approval before reuse, and responses require three distinct operators.

Local/mock lifecycle controls extend the existing owners and matching paths. No provider, model, queue or response executor is added.

## Staged Skill revisions

A published Skill has an editor revision (`version`) and a released guidance revision (`published_version`). Saving instructions, metadata or relevance scopes updates `staged_edit` and increments only the editor revision. New matches keep using the published fields and revision. The editor loads saved staged fields so navigation does not lose a draft.

Published material create/edit/archive operations also stage changes. Before the first material edit, the existing released material set is frozen in `published_materials`; subsequent matches use that release. Material content/version history remains available to the editor. Explicit **Publish saved staged edits** releases the saved instructions/scopes and materials together, with one resource version and audit transaction. Unsaved form text is not part of that operation. Disabled Skills stay disabled; publication of a staged revision does not silently enable them.

**Discard staged edits** drops staged instruction/metadata changes and restores published materials. Restoring a material creates a new material-history version rather than deleting prior versions. Materials added only to the draft are archived. The release revision and earlier investigation snapshots remain unchanged.

Draft Skills retain the existing initial Publish workflow. Legacy published PATCH writes now stage edits; an attempt to use the old publish/save-publish route to bypass staged approval is rejected. Existing material endpoints still edit the draft material library and increment the parent revision; they no longer immediately change future matches of a published Skill.

## Source-outcome review

Derived Skill/Memory records retain their immutable `learning_origin`. Migration **046** adds the tenant-scoped `aisoc_learning_current` SQL function used by both matching paths. A record is eligible only if:

- it is not lifecycle-archived;
- its source investigation still exists in the same tenant;
- the source remains resolved/closed with a reviewed determination;
- the source revision matches the original approval or latest explicit reapproval.

Non-derived records continue to use their existing matching rules. Source revision comparison is conservative: metadata edits that advance the case timestamp also require review, even if the determination is unchanged. This is read-time validation of committed state; existing and already-started investigation snapshots are not retroactively rewritten or cancelled.

The lifecycle panel shows original and current source status/determination, the current revision, and the last reapproval rationale. **Refresh lifecycle** clears confirmation so a newly loaded source revision must be explicitly confirmed again. A changed/deleted/reopened source blocks future matching and staged publication. Existing source links let the analyst inspect evidence in the case.

**Reapprove guidance** requires a rationale, confirmation, expected resource version and exact current source revision. It preserves original provenance and adds a review snapshot/audit. The source must have a reviewed terminal outcome and the original entity must remain unchanged; rescoping to another entity requires new captured learning. Expired Memory must have its validity reviewed through the existing editor first; reapproval does not extend expiry. Reapproval does not publish staged edits, enable disabled Skills, or overwrite a case determination.

**Archive guidance** requires confirmation, rationale and current resource revision. A Skill is disabled and marked archived; Memory uses its existing archived column as well. Archive prevents subsequent editing/re-enabling/reapproval. Capture new reviewed guidance if replacement is needed. Memory archive removes the row from the active registry but keeps its usage snapshots and journal. Existing Memory archive remains a version-checked confirmed UI operation.

## API

For `skills` or `enterprise-insights`:

- `GET /api/v1/{kind}/{id}/lifecycle` returns resource revision, source/current eligibility, archive state, original source, latest review and staged fields.
- `POST /api/v1/{kind}/{id}/lifecycle` accepts `operation`, `expected_version`, `expected_source_version`, `confirm`, `rationale`. Operations: `reapprove`, `archive`, plus Skill-only `publish-staged` and `discard-staged`.

Unknown fields/query parameters and invalid confirmation/version values are rejected. Tenant and actor are authenticated context, never body fields. Resource version mismatches return 409; after an uncertain write, refresh the resource instead of blindly overwriting it. Archive is terminal, and repeated writes with an old revision cannot duplicate effects.

Mutation locking follows source-case → owning-resource order, consistent with initial learning approval. SQL updates and audit writes share a transaction. New queries are sqlc-generated in the existing investigation query package; existing Skill persistence remains reused. Read-time source validity is applied in PostgreSQL before guidance selection. No mutable eligibility cache is introduced.

## Verification

- `TestLifecycleStagingSourceChangeAndArchive`: staged text preserves released guidance/version; explicit publish; confirmation, tenant and stale-version rejection; source changes block both owners; stale source reapproval fails; valid reapproval resumes matching; old snapshots remain unchanged; archive cannot be bypassed by enabling.
- `TestStagedMaterialsDiscardAndAuditRollback`: published material changes remain staged; final-audit failure rolls back restoration; discard restores content with retained history; explicit publication releases new materials.
- Updated Skill application regression expects one released application while material edits are staged.
- Strict HTTP tests reject unconfirmed/forged lifecycle bodies.
- `scripts/framework/learning-lifecycle-browser.js` creates uniquely named local fixtures and exercises instruction staging, source-change warnings, reapproval, publication and archive for both owners, plus desktop/mobile overflow checks. It retains the synthetic demo records.
- `scripts/framework/check_platform_acceptance.py` now includes API lifecycle operations in the existing Skills/Memory stage. Run `python3 scripts/framework/acceptance.py` for two disposable end-to-end runs.

## Deployment and rollback

Deploy Go/frontend together; normal local startup applies additive migration 046. No table rewrite or historical snapshot migration is needed. The first material edit lazily captures the current release. Keep the function and document fields on rollback. Older binaries do not enforce source validity or staged-release semantics: pause derived guidance and disable affected published Skills before reverting to them; do not drop histories or approval receipts.

Remaining production work includes external identity integration, real model/RAG evaluation and workload-scale profiling. These controls record analyst decisions and deterministic matching eligibility; they do not assert model-quality gains.

## Recorded local validation — 2026-11-01

Two full disposable acceptance runs passed in **150.71 s** and **155.31 s**, including the lifecycle HTTP extension and Go/Python/Rust, stream and fault checks. Focused database tests also passed staged material restoration and audit rollback. Final frontend lint/build, nine frontend tests, Go vet, sqlc drift checks and diff whitespace checks passed. The existing large frontend bundle warning remains.

The retained browser walkthrough passed on the refreshed local service for source case `INV-730a12cc`, Skill `SK-a6f29da4-7a47-45be-85bd-93c1618cbba6` and Memory `EI-dafac59e-c99e-4bf0-a134-ce2160ecba5c`. Both guidance records end archived by design. The library displays archive state and disables its enable switch; lifecycle audit entries appear in existing Skill history.

`scripts/framework/learning-lifecycle-regression-browser.js` passed injected 503/409 draft-preservation checks, no automatic write retries, renewed confirmation after source refresh, authenticated actor/tenant derivation and mobile layout. The updated existing Skills browser regression passed pagination, safe preview, staged save, conflict preservation, publish retry and unmounted-save checks. Browser evidence is under ignored `output/playwright/lifecycle-*.png`; reports are under ignored `output/platform-acceptance/`.

## Repeatable browser coverage

This workflow is now included in the fresh-fixture local/mock browser release gate, alongside API acceptance and backup recovery. See [critical workflow actions, assertions and verified results](BROWSER_RELEASE_GATE.md#critical-workflow-stages). No live provider execution is enabled.
