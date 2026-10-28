# Frontend API Integration

`frontend/src/api.js` is the single transport boundary. It implements resource CRUD,
domain actions, error normalization, local tenant propagation, and auth/session
handling. In token mode the backend binds tenant identity to the credential.

During development, Vite proxies `/api` and `/health` to `http://localhost:3002`.
Deployments can set `VITE_API_URL` to an absolute BFF URL.

The application uses clean client-side routes. Production web servers must serve
`index.html` for unknown application paths such as `/respond`, `/memory`, and
`/investigations/:id`. `app.html` remains a compatibility entry point.

## Routes

| Route | Screen | Status |
|---|---|---|
| `/` | Operations queue dashboard | Live |
| `/detect/rules` | Full-width, searchable detection registry and inspector | Live |
| `/detect/rules/:id` | Rule detail, logic, versions and audit history | Live |
| `/detect/intelligence` | Alert volume and disposition trends | Live |
| `/investigations` | Investigation queue and alert intake | Live |
| `/investigations/:id` | Case evidence, transcript, feedback and history | Live |
| `/respond` | Response center (bulk execute, confirmation modal) | Live |
| `/hunt` | Hunt dashboard (ad-hoc hunts, mode toggle) | Live |
| `/threat-intel` | Threat intel feed with summary metrics | Live |
| `/threat-intel/:id` | Threat intel report detail with IOC table | Live |
| `/skills` | Searchable Skills library | Live |
| `/skills/new` | Skill authoring and reference materials | Live |
| `/skills/:id` | Skill editor, scopes, materials and audit history | Live |
| `/skills/templates` | Starter strategies | Live |
| `/skills/suggestions` | Reviewable environment patterns | Live |
| `/skills/outcomes` | Applications, ratings and labeled case counts | Live |
| `/build/api-sources` | Scoped API source management | Live |
| `/memory` | Organizational memory / knowledge base | Live |
| `/build/connectors/cribl` | Cribl connector setup (4-step wizard) | Live |

## Icon System

The frontend uses an inline SVG icon system defined in `main.jsx`. The `Icon` namespace
exposes 30+ icons as functional components: `Icon.search()`, `Icon.bell()`, etc. Each
accepts `size` (px), `color`, and spread props. No external icon library is required.

## Key Frontend Features

- **Detection registry**: Tenant-scoped filters, pagination, source metrics, rule versions and audit history
- **Investigation pipeline**: Normalized intake, duplicate protection, routing and durable local worker progress
- **Skills**: Versioned guidance, scope matching, references, analyst feedback and sample-count outcomes
- **Transcript view**: Persisted investigation steps, supplied evidence and review history
- **Responsive workspaces**: Skills and Threat Intel detail use the available page width and collapse for mobile
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
