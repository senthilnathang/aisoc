# Workspace navigation

Updated 2026-10-31. The application opens at [localhost:8080](http://localhost:8080) with **Detect → Overview** selected. Overview is the first Detect submenu, not a separate main-menu section and not part of Respond.

| Main menu | Submenu | Route |
| --- | --- | --- |
| Detect | Overview | `/` |
| Detect | Rule registry | `/detect/rules` |
| Detect | Intelligence | `/detect/intelligence` |
| Investigate | Investigations | `/investigations` |
| Respond | Overview | `/respond` |
| Respond | Cases | `/respond/cases` |
| Respond | Actions | `/respond/actions` |
| Respond | Approvals | `/respond/approvals` |
| Respond | Workflows | `/respond/workflows` |
| Respond | Runbooks | `/respond/runbooks` |
| Respond | Activity | `/respond/activity` |
| Hunt | Hunt workspace | `/hunt` |
| Threat Intel | Reports | `/threat-intel` |
| Skills | Library | `/skills` |
| Skills | Starter templates | `/skills/templates` |
| Skills | Environment suggestions | `/skills/suggestions` |
| Skills | Outcomes | `/skills/outcomes` |
| Memory | Investigation memory | `/memory` |
| Build | API sources | `/build/api-sources` |
| Build | Stream operations | `/build/stream-operations` |
| Build | Connectors | `/build/connectors/cribl` |

## Behavior

Desktop displays the main sections in the header and the current section's submenu below it. Small screens use a **Menu** button opening a scrollable drawer containing every section and child link. The current submenu remains visible below the header.

Links retain normal browser behavior, including modified-click/new-tab access. Ordinary clicks navigate within the application. Direct URLs, reloads and browser Back retain the correct selection. Closing the mobile drawer with Escape returns focus to the Menu button; choosing a link closes the drawer.

Investigation, detection-rule, threat-report and skill detail views keep their parent section selected. Skill creation belongs to Skills → Library. The legacy `/build-operations` URL still resolves to Build → Stream operations.

Menu availability describes navigation, not authorization. Go API authorization, tenant isolation and response approval policies remain unchanged. Response tools remain within the previously configured local/mock scope.

## Implementation and tests

- [navigation.js](../frontend/src/navigation.js) defines labels, paths and detail-view parent mapping.
- [Navigation.jsx](../frontend/src/Navigation.jsx) renders the responsive header, submenus and drawer.
- [main.jsx](../frontend/src/main.jsx) uses the shared route map and matching breadcrumbs.
- [navigation.test.mjs](../tests/frontend/navigation.test.mjs) checks home ownership, parent selection and unique menu routes.
- [navigation-browser-check.js](../scripts/framework/navigation-browser-check.js) checks active selections, response submenus, deep-link reload, Back, mobile links, Escape/focus restoration and viewport bounds without API writes.

Validation passed against both the development app and a local production preview: 1440px desktop and 375px mobile. Build, Hooks lint, frontend Node tests and Markdown links passed. The temporary preview was stopped after validation; normal access remains port 8080.

See [developer instructions](DEVELOPMENT.md), [test guide](TESTING.md) and [React migration notes](REACT_19_MIGRATION.md).
