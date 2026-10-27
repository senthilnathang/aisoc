# Frontend API Integration

`frontend/src/api.js` is the single transport boundary. It implements resource CRUD,
domain actions, error normalization, and `X-Tenant-Id` propagation.

During development, Vite proxies `/api` and `/health` to `http://localhost:3002`.
Deployments can set `VITE_API_URL` to an absolute BFF URL.

The application uses clean client-side routes. Production web servers must serve
`index.html` for unknown application paths such as `/respond`, `/memory`, and
`/investigations/:id`. `app.html` remains a compatibility entry point.

## Routes

| Route | Screen | Status |
|---|---|---|
| `/` | Operations queue dashboard | Live |
| `/detect/rules` | Detection rules (MITRE matrix, catalog, tuning, routing) | Live |
| `/detect/rules/:id` | Detection rule detail (4-tab view with edit mode) | Live |
| `/investigations` | Investigation dashboard | Live |
| `/investigations/:id` | Investigation detail (5 tabs, transcript, verdict) | Live |
| `/respond` | Response center (bulk execute, confirmation modal) | Live |
| `/hunt` | Hunt dashboard (ad-hoc hunts, mode toggle) | Live |
| `/threat-intel` | Threat intel feed with summary metrics | Live |
| `/threat-intel/:id` | Threat intel report detail with IOC table | Live |
| `/memory` | Organizational memory / knowledge base | Live |
| `/build/connectors/cribl` | Cribl connector setup (4-step wizard) | Live |

## Icon System

The frontend uses an inline SVG icon system defined in `main.jsx`. The `Icon` namespace
exposes 30+ icons as functional components: `Icon.search()`, `Icon.bell()`, etc. Each
accepts `size` (px), `color`, and spread props. No external icon library is required.

## Key Frontend Features

- **MITRE ATT&CK Matrix**: Interactive coverage visualization with technique drill-down
- **Detection Catalog**: 10 deployable rules from 7AI and community contributors
- **Tuning Recommendations**: FPR analysis with specific remediation suggestions
- **Alert Routing**: Modal for mapping rules to connector destinations
- **Transcript View**: Expandable investigation steps with query timing and verdict panel
- **Connector Wizard**: 4-step carousel (Select → Configure → Verify → Complete)
- **Responsive Layout**: Tablet (1024px) and mobile (760px) breakpoints

## API Client Methods

| Method | Endpoint | Used By |
|---|---|---|
| `dashboard()` | GET `/dashboard` | Operations queue |
| `investigations(query)` | GET `/investigations` | Investigation list |
| `investigation(id)` | GET `/investigations/:id` | Investigation detail |
| `reinvestigate(id)` | POST `/investigations/:id/reinvestigate` | Reinvestigate button |
| `setDetermination(id, d)` | POST `/investigations/:id/determination` | Determination dropdown |
| `detectionRules(query)` | GET `/detection-rules` | Detection rules list |
| `toggleDetectionRule(id)` | POST `/detection-rules/:id/toggle` | Enable/disable toggle |
| `hunts(query)` | GET `/hunts` | Hunt dashboard |
| `runHunt(id)` | POST `/hunts/:id/run` | Run hunt button |
| `connectors(query)` | GET `/connectors` | Connector list |
| `createConnector(body)` | POST `/connectors` | Connector wizard |
| `testConnector(id)` | POST `/connectors/:id/test` | Test connection |
| `remediations(query)` | GET `/remediations` | Response center |
| `executeRemediation(id)` | POST `/remediations/:id/execute` | Execute action |
| `threatIntelDashboard()` | GET `/threat-intel/dashboard` | Threat intel feed |
| `threatIntelReports(query)` | GET `/threat-intel-reports` | Threat intel list |
| `threatIntelReport(id)` | GET `/threat-intel-reports/:id` | Report detail |
| `launchThreatHunt(id)` | POST `/threat-intel-reports/:id/launch-hunt` | Launch hunt |
| `threatIndicators(query)` | GET `/threat-indicators` | IOC table |

## Phased Mock Replacement

1. ~~Fetch `/dashboard` and keep the current metrics as loading skeleton dimensions.~~  ✅
2. ~~Replace the detection-rule rows with `api.detectionRules()` and wire toggle/create.~~  ✅
3. ~~Load investigation detail by ID and wire determination/reinvestigation actions.~~  ✅
4. ~~Submit the Cribl setup form through `api.createConnector()`, then call the test action.~~  ✅
5. ~~Load remediation rows and wire execute with confirmation and optimistic status.~~  ✅
6. ~~Replace hunt metrics/list data and submit ad-hoc hunts through create/run.~~  ✅
7. ~~Load threat intel reports and wire hunt launching.~~  ✅

Each screen retains its static fixture as a development fallback when the API is unavailable.
Remove fallbacks once end-to-end tests cover that screen.
