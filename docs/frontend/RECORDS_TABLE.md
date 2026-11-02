# Reusable records table

Current consumers are `/detect/rules` (`DetectionRegistry.jsx`), Universal Rule Routing / Per-Rule Routing in `/detect/routing` (`DetectionRouting.jsx`), API sources at `/build/api-sources` (`ApiSources.jsx`), and Threat Intel reports at `/threat-intel` and `/hunt/threat-intelligence` (`ThreatIntelWorkspace.jsx`), and Hunt registry at `/hunt/threat-hunting` (`HuntWorkspace.jsx`), and Skills library at `/skills` (`SkillsRegistry.jsx`), and the Active Insights, Prevalence Suggestions and Audit Log tables at `/memory` (`EnterpriseInsights.jsx`), and Build catalog at `/build` (`BuildWorkspace.jsx`), and Investigations/Received alerts at `/investigations` (`InvestigationQueue.jsx`), and Respond workflows/runbooks (`ResponsePlans.jsx`). Other lists remain unchanged.

## Ownership

`frontend/src/components/RecordsTable.jsx` owns semantic table markup, stable row keys, selected-row styling, loading/error/empty states, result counts and server pagination controls. Shared styles live beside it in `records-table.css`; pagination arithmetic lives in `recordPagination.mjs`.

The page owns API requests, cancellation/stale-response protection, filtering, sorting, URL state, permissions, domain rendering and actions. The table never fetches, mutates, sorts or slices records itself. Supply only the current server page, its total, offset and limit. No additional table library is installed. For a bounded configuration already loaded in full, the caller may filter/slice that collection and supply its exact total; the table itself still receives one page.

```jsx
<RecordsTable
  caption="Assets"
  recordLabel="assets"
  columns={[
    { id: 'name', header: 'Name', render: asset => <a href={`/assets/${asset.id}`}>{asset.name}</a> },
    { id: 'source', header: 'Source' },
  ]}
  records={data.items}
  rowKey="id"
  total={data.total}
  offset={offset}
  limit={limit}
  onPageChange={setOffset}
  onPageSizeChange={size => { setLimit(size); setOffset(0); }}
  loading={loading}
  error={error}
  onRetry={reload}
  emptyContent="No matching assets."
/>
```

Columns require a unique `id` and `header`; optionally supply `render(record)`, `width`, `minWidth` and `align`. `rowKey` is a field name or function. `selectedRowKey` highlights an inspected record. Labels, loading text and page-size choices are configurable. `paginationDisabled` freezes navigation and page-size controls during a save without hiding the row being edited. An existing valid custom page size is included in the selector so shared URLs remain usable.

The table has a screen-reader caption, column scopes and a named keyboard-focusable horizontal scroll region. Pagination is a named navigation region; state/counts are announced, and navigation is disabled while loading or after an error. Empty results use a page-specific explanation. Dense columns scroll inside the table on mobile; the page and pagination controls wrap without horizontal overflow.

## Detection Rules integration

The Go `GET /api/v1/detection-registry` contract is unchanged. Search, severity/status/source filters, period, sorting, selection and paging stay in the URL. Requests retain their existing abort protection and debounce. Filter/page-size changes reset the offset. After deletions or changed results, any out-of-range nonzero offset resets to zero, including an empty result set. Existing rule inspector, create/edit/clone actions and Catalog remain unchanged.

## Verification and next consumers

- `node --test tests/frontend/*.test.mjs`: existing regressions plus first/last/empty/custom-page arithmetic.
- `npm --prefix frontend run lint` and `npm --prefix frontend run build`.
- `node scripts/framework/records-table-browser.mjs`: real local Go registry/detail smoke, then intercepted read-only fixtures for 57-row paging, page sizes, reload/back, search resets, loading, empty/error/retry and desktop/mobile layout. Reports/screenshots are in `output/records-table/`; it does not mutate demo data.

Remaining raw-table lists after the API sources migration: approval inbox, retention, telemetry browser, response policies, local integrations, build bulk import and stream operations. Confirm each endpoint's filtered total and server pagination before migration; do not calculate global totals from a single fetched page. Preserve that page's actions, filters, URL history and permissions, and add focused browser coverage for each migration. Do not migrate unrelated lists in one sweeping change.


## Detection Routing integration

Universal policies use the full bounded configuration as their source. Filtering and page slicing stay in DetectionRouting; priority numbers and move actions always use the full policy order. Page sizes are 10/20/50/100, default 20. Archiving a filtered policy clamps an out-of-range page to the last available page without losing staged edits. Selection, entity exceptions, active-policy previews and explicit save confirmation remain unchanged.

Per-rule routes retain the Go registry's server pagination, now with page-size and first/last controls. Their offset and page size remain component-local, matching the existing navigation behavior. Unsaved route drafts survive page changes. Save errors appear separately from fetch errors, so version conflicts leave the table and draft visible. Version-checked writes remain unchanged. Paging and route inputs are disabled during a save. Audit details and the routing-preview table are not migrated.

`node scripts/framework/routing-records-table-browser.mjs` runs the existing routing browser regression and additional paginated configuration/server fixtures. It verifies full-order priority across page boundaries, filtered archive page recovery, explicit preview/save, retained route drafts, version conflicts, save interlocks, fetch retry and desktop/mobile layout. All writes are intercepted; real API checks are read-only. Reports/screenshots: `output/routing-records-table/`.

Validation on 2026-11-02: frontend lint/build, all frontend regression files, Detection Rules browser regression and the Routing records-table browser suite passed. Mobile screenshots for both routing tabs were generated; the per-rule table was visually inspected. The existing frontend bundle-size warning remains outside this table migration.


## Threat Intel reports integration

The report list retains `GET /api/v1/threat-intel/registry` and its filtered `total`/`sources`. It defaults to 50 rows, with 10/25/50/100 available. Search, status and analyst-relevance filters remain page-owned, reset the offset, and are preserved when changing page size. The existing request-lifetime guard prevents delayed responses from overwriting newer results. A nonzero offset beyond the refreshed total resets to zero, including empty results. Filters and paging remain in component state, as before; this migration does not add URL persistence.

Report columns retain actor, industry, region, publication time, actual IOC count, linked local hunts, review status and analyst relevance. Report navigation, manual ingestion, JSON import/validation, report editing, indicator actions and linked-hunt navigation remain unchanged. The detail-page indicator table is not migrated. Both Threat Intel and Threat intelligence hunting entry points share this implementation.

`node scripts/framework/threat-reports-table-browser.mjs` runs real read-only registry/tenant checks and the existing Threat Intel workflow regression, followed by paginated fixtures. It covers combined filters, offset resets, late-response rejection, empty/error/retry states, report navigation, ingestion-dialog availability, JSON import wiring and desktop/mobile layouts at both entry points. All writes are intercepted; real demo data is not mutated. Reports/screenshots: `output/threat-reports-table/`.

Validation on 2026-11-02: frontend lint/build, all 17 frontend regression test files, and the Threat Intel, Detection Rules and Detection Routing table browser suites passed. Threat Intel report screenshots were visually inspected at 1440px and 390px. Browser testing identified a visually hidden caption escaping the horizontal scroll container on mobile; positioning the shared scroll region fixes page overflow while retaining the accessible caption. The existing bundle-size warning remains.

## Hunt registry integration

`/hunt/threat-hunting` uses the shared table with 50 rows by default and 10/25/50/100 choices. Search and paging stay component-local as before. Search and page-size changes reset the offset; changing page size preserves search. Requests retain debounce and late-response protection. Refreshing an out-of-range page resets to zero, including an empty result set. Errors offer explicit retry.

`GET /api/v1/hunts` adds a filtered `total` alongside existing `items`. The sqlc query in `backend-go/internal/modules/hunts/queries/registry.sql` reads both from a single statement snapshot, preserves tenant/search/status predicates and updated-time/ordinal order, and returns the count even for an empty page. No schema migration is needed. Existing API limit defaults/bounds are unchanged; the UI explicitly requests its 50-row default. Deploy the additive API before the frontend; rollback the frontend first if reverting the API.

Name/description, created time, source, updated time, title navigation and Open hunt actions are preserved. Add threat hunt, durable execution, notes, evidence and promotion controls remain in the existing detail workflow. The legacy `mode="intel"` branch is left unchanged; active Threat Intel routes already use their separate shared-table workspace.

Run `node scripts/framework/hunt-records-table-browser.mjs` for real read-only Go/tenant checks plus intercepted paging and action fixtures. It covers paging, search/page-size interaction, stale responses, error/retry/loading, empty-page recovery, title/action navigation, creation, local-search results, notes, historical query attribution, evidence links and desktop/mobile keyboard access. Outputs: `output/playwright/hunt-records-table/`. All browser writes are intercepted. The existing Hunt workflow fixture now models `/executions`, matching the durable execution API rather than the superseded direct-search UI path.

Validation on 2026-11-02: frontend lint/build and all 17 frontend regression files passed; Hunt and HTTP tests passed with the race detector against disposable PostgreSQL, including filtered totals, pagination, empty pages and tenant isolation. Go vet and sqlc diff passed. The local Hunt browser suite passed with all mutations intercepted; demo records were not changed. The existing bundle-size warning remains.

Final desktop (1440px) and mobile (390px) Hunt screenshots were visually inspected. The table scrolls horizontally within its container; page controls and the creation action remain accessible. Browser evidence: `output/playwright/hunt-records-table/report.json`.

## Skills library integration

`/skills` uses `RecordsTable` with the existing 25-row default and 10/25/50/100 page sizes. `GET /api/v1/skills/library` already supplies filtered total, published and draft counts; no backend or schema change is required. Search, state, module and custom/augmented origin filters remain component-local. Filters and page-size changes reset the offset while retaining the other filters. Stale responses are ignored; an out-of-range page resets to zero, including empty results.

The library retains detail navigation, Upload/Create skill, help, empty-view template/suggestion actions, lifecycle badges and version-checked enablement. Archived or stale-source skills remain disabled. Pagination and page-size controls pause while a toggle is pending. Fetch failures use the table retry state; toggle conflicts and upload validation errors appear separately so rows remain visible. Filtered published/draft counts remain below the table. Editor, staged edits, publishing, reapproval and archive controls are unchanged.

Run `node scripts/framework/skills-records-table-browser.mjs`. It checks real read-only API totals/tenant isolation, then runs the existing Skills workflow regression and additional paginated fixtures for combined filters, origin switching, paging, stale responses, loading/retry, disabled lifecycle switches, toggle conflicts and upload validation. Existing workflow coverage includes Markdown preview safety, staged edits, retained edits on conflict, import/publish retry and unmounted-save navigation protection. All domain writes are intercepted. Screenshots/report: `output/playwright/skills-records-table/`.

Validation on 2026-11-02: frontend lint, all 17 frontend regression files, production build and the Skills records-table browser suite passed. Desktop (1440px) and mobile (390px) screenshots were visually inspected. The existing workflow fixture was updated from the obsolete Publish button to saved-draft approval by a separate mock approver; self-approval remains disabled. Browser writes were intercepted and demo data was not changed. The pre-existing bundle-size warning remains. Evidence: `output/playwright/skills-records-table/report.json`.

## Memory library integration

The Active Insights, Prevalence Suggestions and Audit Log views at `/memory` use the shared table. Existing `GET /api/v1/enterprise-insights` filtered totals and summary metrics are reused without backend/schema changes. Table page sizes are 10/25/50/100 with a 25-row default. Search and page-size changes reset the offset; page-size changes preserve search. Tab changes retain the existing behavior of clearing search and resetting the offset. Table page size is retained across table tabs; generated cards continue to request 25 records per page.

Active context, validity/advisory fields, provenance and lifecycle controls, investigation/hunt usage drilldowns, editing, reviewed prevalence creation and confirmed version-checked archive remain unchanged. Audit columns retain their context. The AISOC Generated cards and unconfigured AI Suggestions view remain intact. Requests reject stale responses and recover out-of-range pages after changed results, including an empty last page after archive. Fetch errors use table retry; archive errors remain in their confirmation dialog. Pagination pauses during archive submission.

Run `node scripts/framework/memory-records-table-browser.mjs`. The suite checks real API totals/tenant isolation, existing Memory workflows, and paging/search/page-size/keyboard/responsive behavior for all three tables. It also covers delayed responses, archive-driven empty-page recovery and fetch retry/loading. Domain writes are intercepted; demo records are unchanged. Report/screenshots: `output/playwright/memory-records-table/`. The existing editor fixture uses the current Save for independent approval label, preserving the application's approval boundary.

Validation on 2026-11-02: frontend lint, all 17 frontend regression files, production build and the Memory records-table browser suite passed. All three table views passed desktop (1440px), mobile (390px) and keyboard-scroll checks. Active mobile, prevalence desktop and audit mobile screenshots were visually inspected. Existing workflow coverage passed for usage snapshots, edit conflicts, prevalence creation, generated-card provenance, archive confirmation and delayed modal completion. All domain writes were intercepted; demo data was unchanged. The existing bundle-size warning remains. Evidence: `output/playwright/memory-records-table/report.json`.

## Build catalog integration

The `/build` asset registry uses the shared table with 25 rows by default and 10/25/50/100 choices. Existing `GET /api/v1/build/catalog` totals/counts and kind/search filters are reused. Filters remain component-local; changing page size preserves kind/search and resets offset. Page/filter/refresh changes close the metadata inspector. Stale requests remain ignored; an out-of-range page resets to zero, including empty results. Rows use `(kind,id)` identity because different asset kinds may share IDs.

Asset metadata, stored configuration state, read-only connector inspection and links to Skills, workflows, runbooks and API sources remain unchanged. The separate local integration manager retains its configuration, JSON validation/import, evidence previews, clone/archive and processing/replay controls; this migration changes the catalog and its navigation, not those editors or workflows. No backend/schema changes are required.

Run `node scripts/framework/build-records-table-browser.mjs` for real read-only API totals/tenant checks, existing catalog regression and fixture-driven paging, combined filters, manager navigation, empty-page recovery, fetch retry/loading and desktop/mobile keyboard access. No provider actions or demo mutations are performed. Evidence: `output/playwright/build-records-table/`.

Validation on 2026-11-02: frontend lint, all 17 frontend regression files, production build and the Build records-table browser suite passed. Desktop (1440px) and mobile (390px) screenshots were visually inspected. Coverage includes real read-only API totals/tenant isolation, duplicate IDs across asset kinds, filters, inspector, manager navigation, stale-response rejection, empty-page recovery and error/retry/loading. Integration lifecycle mutations were not rerun for this catalog-only change. No demo data was changed. The existing bundle-size warning remains. Evidence: `output/playwright/build-records-table/report.json`.

## Investigations registry integration

`/investigations` uses the shared table for Investigations and Received alerts. This is client-side pagination of the existing latest-100 snapshot, **not** pagination across all stored history. Each view labels that boundary explicitly; summary counts can include older records. No API/schema change is made. Default page size is 25 with 10/25/50/100 choices. Search remains case-insensitive across title, source, internal ID and source alert ID. Changing tabs resets the offset and preserves search, as before; page-size/search changes reset offset.

The caller filters and slices the loaded snapshot; the table receives only the selected page and filtered snapshot count. Two-second polling remains unchanged and resets an out-of-range page after records disappear. Background errors preserve stale rows with a warning and disable paging/intake until recovery; an initial fetch error uses the shared retry state and is never presented as empty results. Existing status/severity/determination/source fields, rule-backed alert submission, example evidence and case navigation are retained. Unlinked alerts do not gain a case action. Case detail screens are unchanged. Legacy queue-specific table/card CSS is removed in favor of the shared horizontal scroll region.

Run `node scripts/framework/investigations-records-table-browser.mjs`. Real API checks are read-only; registry pages and alert submission use intercepted fixtures. Coverage includes both tabs, filters, page sizes, case navigation, polling/clamping, stale-data and initial-load failures, retry, example intake and desktop/mobile keyboard access. Evidence: `output/playwright/investigations-records-table/`.

Validation on 2026-11-02: frontend lint, all 17 frontend regression files, final production build and the Investigations records-table browser suite passed. Both tabs passed desktop/mobile and keyboard access checks. Investigations mobile and Received alerts desktop screenshots were visually inspected. Mock intake, linked/unlinked alert actions, polling-driven empty-page recovery, stale-row warnings and initial-error retry passed. Real API checks were read-only; alert submission was intercepted, so demo data was unchanged. The existing bundle-size warning remains. Evidence: `output/playwright/investigations-records-table/report.json`.

## API sources integration

`/build/api-sources` uses the shared table with 25 rows by default and 10/25/50/100 choices. `GET /api/v1/api-sources` adds a tenant-scoped `total` alongside `items` (`intake.Store.Count`); the existing `limit`/`offset` validation is unchanged. The count and page are separate statements, so a source created between them can make the total briefly differ from the page; the next refresh corrects it. A nonzero offset beyond a refreshed total resets to zero.

Source name, provider, detection rule, mapping status, key status, expiry, Map events, Rotate key and Revoke are unchanged, and the create, rotate, revoke and mapping dialogs keep their existing behavior. List fetch failures use the table's retry state; action errors stay in their dialogs or the page alert, so rows remain visible. Pagination pauses while a create, rotate or revoke is busy. The detection-rule picker in the create dialog keeps its own search and paging.

Run `node scripts/framework/api-sources-records-table-browser.mjs`. It checks real read-only totals and tenant isolation, then runs intercepted fixtures for paging, page sizes, row dialogs, delayed loading, error and retry with out-of-range recovery, the empty state, keyboard access and desktop/mobile layout. Any non-GET request to the source list is recorded and fails the run. Set `CHROME_PATH` to use a specific Chromium; otherwise Playwright's bundled browser is used. Evidence: `output/playwright/api-sources-records-table/`.

## Respond workflow and runbook registries

`/respond/workflows` and `/respond/runbooks` use the shared table. The existing API returns the saved tenant response-plan library; filtering and slicing remain in `ResponsePlans`, with no backend/schema change. Each view starts at 25 rows and offers 10/25/50/100. Search still covers titles, descriptions, domains, triggers and step titles/instructions. Active/archived/all-state and domain filters are preserved; search/filter/page-size changes reset the offset while retaining the other filters. Refresh or mutation results reset an out-of-range page, including empty results.

Name, step/version summary, description, domain, dates, state and Open workflow/runbook actions are unchanged. Creation/editing, version history, duplicate/archive/restore, runbook JSON import, case attachments and workflow dry previews remain in their existing components. Paging is disabled while an operation is busy; fetch errors use the shared retry view. This adds list pagination, not provider execution or new approval authority.

Run `node scripts/framework/respond-records-table-browser.mjs`. It checks real read-only library/tenant behavior, runs existing local response workflow fixtures (including dry-preview case switching/reopen protection and runbook import identity stripping), and verifies both tables' paging, combined filters, step-content search, clear filters, create drawers, empty-page recovery, loading/retry, keyboard access and desktop/mobile layouts. All mutations are intercepted. Evidence: `output/playwright/respond-records-table/`.

Validation on 2026-11-02: frontend lint, all 17 frontend regression files, production build and the Respond records-table browser suite passed. Both registries passed desktop (1440px), mobile (390px) and keyboard-scroll checks; workflow mobile and runbook desktop screenshots were visually inspected. Existing dry-preview isolation, policy version checks and runbook JSON import regression passed. All domain mutations were intercepted; no demo data or provider actions changed. The pre-existing bundle-size warning remains. Evidence: `output/playwright/respond-records-table/report.json`.
