# Breadcrumbs: frontend hierarchy and Go metadata

Implemented 2026-10-31. Breadcrumbs share the [navigation hierarchy](NAVIGATION.md), provide clickable parents, and show resource names on investigation, detection-rule, threat-report and skill detail screens.

Examples:

- `/`: Detect → Overview
- `/detect/rules`: Detect → Rule registry
- `/detect/rules/mock-stream-login`: Detect → Rule registry → mock-stream-login
- `/investigations/{id}`: Investigate → Investigations → case title
- `/skills/new`: Skills → Library → Create skill
- `/build-operations`: Build → Stream operations (legacy alias retained)

Parent links support normal and modified clicks; the final crumb has `aria-current="page"`. The navigation landmark is named Breadcrumb. Labels wrap at separators and truncate long resource names on small screens, with the bounded full label available as a title attribute. A failed lookup keeps a generic resource label and displays “Resource name unavailable”; it does not block the page or display another record's previous name.

## API contract

```http
GET /api/v1/navigation/breadcrumb?resource=detection-rules&id=mock-stream-login
```

```json
{"resource":"detection-rules","id":"mock-stream-login","label":"mock-stream-login"}
```

Allowed resources: `investigations`, `detection-rules`, `threat-intel`, `skills`. Exactly one resource and one ID must be supplied; extra or repeated parameters are rejected. IDs must be nonempty UTF-8, at most 256 bytes, with no control characters. Invalid requests return 400. Unknown IDs and resources owned by another tenant both return the same 404 response. The label is bounded to 160 characters; missing names fall back to the stored ID. Labels are text, not HTML.

Tenant identity comes from existing Go authentication middleware. There is no query parameter for choosing a tenant, and response headers inherit `Cache-Control: no-store`. The current local demo permits the existing explicit tenant header selector; token mode continues to bind it to authenticated identity. No writes, workflow actions, schema changes or new infrastructure are introduced.

## Ownership and implementation

| Path | Responsibility |
| --- | --- |
| `frontend/src/navigation.js` | Shared sections and parent route ownership |
| `frontend/src/breadcrumbs.js` | Static hierarchy and allowlisted detail-resource mapping |
| `frontend/src/Breadcrumbs.jsx` | Accessible links, async label fetch, error fallback, stale-response cancellation |
| `backend-go/internal/transport/httpapi/navigation.go` | Query validation and authenticated context |
| `backend-go/internal/modules/navigation/store.go` | Resource allowlist, ID validation and consistent not-found behavior |
| `backend-go/internal/modules/navigation/queries/navigation.sql` | Fixed tenant/ID predicates; bounded metadata-only query |
| `backend-go/internal/modules/navigation/navigationsql` | sqlc v1.31.1 generated pgx/v5 adapter |

The fixed UNION ALL query is parameterized and each branch uses its existing composite tenant/ID key. It does not fetch full case details or calculate investigation metrics. Frontend routes remain the authority for link destinations; returned labels cannot inject URLs. No shared client cache of tenant resource names is added. Successful resource updates emit an ID-only invalidation event so in-place renames refresh the label. Navigation aborts pending fetches and ignores late responses; session expiry unmounts the authenticated UI.

## Verification and rollback

- Frontend unit tests: root hierarchy, static routes, creation flow and detail-resource mapping.
- PostgreSQL race tests: all four resource types, sparse-rule fallback, unknown/foreign IDs, validation before database access, and 160-character bound.
- HTTP/browser checks: actual label lookup, tenant denial, invalid resource, 1440px/375px parent navigation, escaped untrusted labels, unavailable-name fallback and late-response suppression.
- Hooks lint, production build, Go transport tests/vet, sqlc drift check and Markdown links pass.

Use `node --test tests/frontend/*.test.mjs`, `make -C backend-go sqlc-check`, and `AISOC_GO_TEST_DATABASE_URL=... go test -race ./internal/modules/navigation` from `backend-go` against a disposable database. Run `scripts/framework/breadcrumb-browser-check.js` through the Playwright tool on the local app or production preview; it uses the existing mock-stream-login fixture and intercepts its rename fixture rather than changing stored records.

Rollback consists of reverting the breadcrumb commit, rebuilding frontend/backend, and restarting the affected services. No database migration or data rollback is required.

## Screenshot-driven follow-up

Work through supplied Seven AI screenshots one screen at a time. For each screen: identify the intended workflow, compare it with existing UI and APIs, implement the visible states and required tenant-scoped backend behavior, then verify responsive layout, loading/empty/error states and permissions. A screenshot is visual evidence, not proof of hidden product logic; clarify behavior that cannot be inferred rather than inventing integrations or live autonomous actions. Reuse current components and keep production response disabled under the existing local-only scope.

The first supplied reference is now reviewed in [7AI Detect: five-screen assessment](SEVENAI_DETECT_REVIEW.md), including URLs shown inside each screenshot.
