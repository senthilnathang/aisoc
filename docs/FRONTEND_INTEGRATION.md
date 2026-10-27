# Frontend API Integration

`frontend/src/api.js` is the single transport boundary. It implements resource CRUD,
domain actions, error normalization, and `X-Tenant-Id` propagation.

During development, Vite proxies `/api` and `/health` to `http://localhost:3002`.
Deployments can set `VITE_API_URL` to an absolute BFF URL.

The application uses clean client-side routes. Production web servers must serve
`index.html` for unknown application paths such as `/respond`, `/memory`, and
`/investigations/:id`. `app.html` remains a compatibility entry point.

| Route | Screen |
|---|---|
| `/` | Operations queue |
| `/detect/rules` | Detection rules |
| `/investigations` | Investigation dashboard |
| `/investigations/:id` | Investigation detail |
| `/respond` | Response center |
| `/hunt` | Hunt dashboard |
| `/memory` | Organizational memory |
| `/build/connectors/cribl` | Cribl connector setup |

## Phased Mock Replacement

1. Fetch `/dashboard` and keep the current metrics as loading skeleton dimensions.
2. Replace the detection-rule rows with `api.detectionRules()` and wire toggle/create.
3. Load investigation detail by ID and wire determination/reinvestigation actions.
4. Submit the Cribl setup form through `api.createConnector()`, then call the test action.
5. Load remediation rows and wire execute with confirmation and optimistic status.
6. Replace hunt metrics/list data and submit ad-hoc hunts through create/run.

Each screen should retain its current static fixture as an explicit development fallback
until the corresponding endpoint has loading, empty, and error states. Remove the fallback
once end-to-end tests cover that screen.
