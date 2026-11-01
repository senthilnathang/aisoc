# Detect-to-Build UI/UX system

Updated 2026-11-01. Implemented on the existing React 19 / Chakra UI 2 stack.
No new package, backend endpoint, schema migration or provider capability.

## Design direction

Preserve the dark navigation, light evidence surfaces and violet selection accent.
Use a quiet, dense analyst workspace: stable page hierarchy, readable controls,
clear active navigation, and explicit local/mock labels. Evidence, uncertainty,
approval requirements and error messages stay visible; visual polish must not imply
that a provider connection or AI investigation is live.

## Shared implementation

- `frontend/src/WorkspaceHeader.jsx` is the page-header container for the 28
  navigation/editor routes from Detect through Build. It accepts existing action
  controls and explanatory copy rather than duplicating workflow behavior.
- `frontend/src/app.css` owns header layout: 28px desktop/tablet and 24px mobile
  h1, 24px/16px content gutters, a separator, wrapped actions, and shared table
  heading treatments. Detail workspaces retain their specialist evidence layouts.
- `frontend/src/theme.js` owns Chakra defaults: 36px small controls, readable
  12px button/13px input text, 6px control corners and stronger muted text.
  Mobile buttons/inputs/selects have a 44px minimum height; mobile form text is
  16px. Dense tables scroll within their containers.
- `main.jsx` supplies a single main landmark, first-tab skip link, workspace
  document titles and main-content focus on in-app route changes. Ordinary data
  refreshes must not move focus.
- `Navigation.jsx` reveals the selected submenu on navigation and resize. Only
  the submenu scrolls; the document and keyboard focus do not jump. The mobile
  drawer retains Chakra's focus trap and Escape restoration.
- Focus outlines cover links, buttons, form fields, summaries and tabindex
  controls. Reduced-motion preference suppresses entry animations/transitions.
- Build catalog, Skills origin and response board/list controls expose selection
  with `aria-pressed`. Long response source IDs wrap inside case cards.

## Adding or updating a screen

Use a single `<Heading as="h1">` inside `WorkspaceHeader`; reserve h2/h3 for
panels. Keep the page's actions in the header and filters with their results.
Use existing theme tokens and button variants, explicit field labels, descriptive
button names and textual status labels. Keep loading, empty and error states
separate. Error recovery must preserve drafts, and pending requests must not
silently reset inputs. Never replace a required approval with a cosmetic button.

For example:

```jsx
<WorkspaceHeader>
  <Box>
    <Heading as="h1">Workspace title</Heading>
    <Text color={ui.muted}>Explain what the analyst can do here.</Text>
  </Box>
  <Button variant="outline" onClick={refresh}>Refresh records</Button>
</WorkspaceHeader>
```

Keep domain layouts and specialist graphs in their existing components. Avoid
using page-level CSS to flatten case evidence, charts or workflow editors.

## Verification and limits

`ui-consistency-browser-check.js` runs live, read-only Go-backed pages in four
batches (`?uiBatch=0` through `3`), seven routes per batch, at 1440, 768 and
390px: **84 route/viewport checks passed**. It asserts one main landmark, one h1,
shared header and title size, active-submenu visibility, document overflow,
JavaScript errors and failed API responses. Screenshots are retained locally in
`output/playwright/ui-*.png`.

`ui-accessibility-browser-check.js` checks first-tab skip navigation, route focus
and document title, mobile submenu visibility, drawer Escape/focus restoration,
44px controls, 16px input text, visible focus and reduced motion.

The first pass exposed a nonwrapping source badge in Respond → Cases; wrapping
was added and the mobile pass repeated. Initial keyboard-test timing was corrected
to wait for the React shell before pressing Tab.

These checks are Chromium local-sandbox validation, not WCAG certification,
cross-browser certification, a live provider test or a throughput benchmark.
Retained limitations include the existing large production JavaScript chunk and
specialist detail-screen typography. Safari/Firefox and assistive-technology
validation remain follow-up work.

### Supporting checks run in this change

| Check | Result |
|---|---|
| Frontend lint and production build | Passed; existing >500 kB chunk warning |
| Frontend Node test files | 9 passed |
| Markdown link validation | 538 links across 90 documents passed |
| Live route/viewport matrix | 84 passed; report in `output/playwright/ui-consistency-report.json` |
| Keyboard/mobile/reduced-motion interactions | Passed; desktop-to-mobile submenu resize also checked |
| Platform regression fixtures | 6 passed |
| Build catalog and local integration editor | Passed |
| Respond case/policy/workflow/runbook fixtures | Passed |
| Skills library/editor/import/conflict fixtures | Passed |
| Memory usage/edit/archive/empty/error fixtures | Passed |
| Hunt and Threat Intel workflow fixtures | Passed |

Workflow writes in those browser suites were intercepted fixtures. Local integration
preview uses the existing read-only validation API. No live response was enabled.
The response regression now expects the page-level h1 instead of the former h2.
