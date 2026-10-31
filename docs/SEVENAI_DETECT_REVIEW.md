# 7AI Detect screenshot review

Reviewed 2026-10-31 against the public [Detection page](https://7ai.com/platform/detection) and its five product images. URL paths below are transcribed from the browser chrome drawn inside those images, not verified authenticated application routes. The site is `7ai.com`; the screenshot chrome uses `app.sevenai.com`.

This is a proposed UI/backend plan. This review initially described proposed work. Detection Intelligence and the Rules workspace are now implemented locally; see [Intelligence](DETECTION_INTELLIGENCE.md) and [Rules](DETECTION_RULES.md) for metric differences and validation. Coverage is also implemented locally; see [Coverage](DETECTION_COVERAGE.md) for the pinned reference and assessment semantics. [Local Recommendations](RULE_RECOMMENDATIONS.md) is now implemented; provider query validation/sync and Routing remain proposals; no production integrations were enabled. Preserve the current local/mock response boundary and existing working features.

## Screen 1 — Detection Intelligence

Screenshot URL: `app.sevenai.com/detect/detection-intelligence`.

[Source image](https://47518862.fs1.hubspotusercontent-na1.net/hubfs/47518862/01-intelligence-browser.png)

Visible: source inventory with alert counts and proportions; a source-grouped alert treemap colored by investigation coverage; search/time filtering; coverage/escalation tabs; category/severity summaries; a stacked time chart and investigation navigation.

Assessment: the strongest starting screen. It connects volume, source and investigation progress in one workspace. The treemap needs a keyboard-accessible table alternative and stable drill-down filters. Define each coverage state explicitly rather than treating “case exists” as “investigation complete.”

Reuse: `frontend/src/DetectionIntelligence.jsx` and `backend-go/internal/modules/detection/intelligence.go` already provide tenant-scoped alert totals, source/filter/time aggregation, daily severity counts and recent alerts. Extend the query contract for normalized provider → rule/alert-type groups, coverage-state counts and filtered investigation links. Avoid one database request per tile. Keep imported/mock data identified and do not copy screenshot counts as live measurements.

## Screen 2 — Detection Coverage

Screenshot URL: `app.sevenai.com/detect/detection-coverage`.

[Source image](https://47518862.fs1.hubspotusercontent-na1.net/hubfs/47518862/02-coverage-browser.png)

Visible: a coverage-analysis radar chart across ATT&CK tactics, percentage labels, view-toggle icons and a Create detection rule action.

Assessment: useful summary, but a chart alone cannot substantiate a coverage score. Provide an explicit denominator and tactic/technique detail with mapping provenance. An accepted risk or alternative control must not silently count as a functioning detection.

Reuse/gap: rules already contain `mitre_techniques`; the inspected detection module has no corresponding persisted coverage-assessment service. Add a versioned ATT&CK reference, tenant technique mappings, applicability and assessed states, evidence, reviewer/expiry and deterministic aggregate calculations. Do not infer measured coverage solely from rules carrying a technique tag. Keep unknown and unassessed states visible.

## Screen 3 — Detection Rules

Screenshot URL: `app.sevenai.com/detect/detection-rules`.

[Source image](https://47518862.fs1.hubspotusercontent-na1.net/hubfs/47518862/03-rules-browser.png)

Visible: summary KPIs; searchable registry and catalog tabs; rule/technique/execution/status/detection/investigation/FPR columns; a right-hand rule panel with 30-day metrics, determination distribution, details/recommendations/history tabs and management actions. The image already shows recommendation content while its browser chrome remains on the registry path.

Assessment: evolve the existing registry rather than replace it. The panel should preserve filtering and selection; on mobile it can become a detail page. Store selected rule/tab in a shareable URL, not only component state.

Reuse: `DetectionRegistry.jsx`, `CreateDetectionRule.jsx`, `detection/rules.go` and `detection/registry.go` support CRUD, source bindings, versions, audit, counts and detail inspection. Gaps: aggregate header metrics with explicit periods, real catalog contracts, consistent panel deep links and defensible false-positive measurement. Current counts are all-time; the screenshot panel is 30 days, so the API must expose the selected window rather than relabel existing totals.

## Screen 4 — Rule Recommendations

Screenshot URL: `app.sevenai.com/detect/detection-rules/recommendations`.

[Source image](https://47518862.fs1.hubspotusercontent-na1.net/hubfs/47518862/04-recommendations-browser.png)

Visible: the same registry with Recommendations selected in the side panel, false-positive analysis and confidence, proposed scoped query changes, and Apply, Validate Query, Test Query and Dismiss controls. Sync Now appears among rule actions.

Assessment: implement this as a rule-workspace subview, not a disconnected recommendations application. The screenshot URL omits a rule ID; our URLs must retain which rule is being reviewed. Exact hidden routing behavior cannot be established from this image.

Original backend gap (local subset now implemented; see [current boundaries](RULE_RECOMMENDATIONS.md)): persisted recommendations tied to rule version and evidence window; explicit analyst false-positive labels and denominator; proposed query diff; provider/dialect validation; sandbox replay/test receipts; approval, audit and optimistic concurrency for apply/dismiss/sync. Python may draft explanations, while Go verifies evidence references and gates any writes. Benign determinations are not automatically false-positive labels, and insufficient samples should produce unknown statistics rather than fabricated confidence.

## Screen 5 — Detection Routing

Screenshot URL: `app.sevenai.com/detect/detection-routing`.

[Source image](https://47518862.fs1.hubspotusercontent-na1.net/hubfs/47518862/05-routing-browser.png)

Visible: Universal Rule Routing, Per-Rule Routing, Audit Logs and Entity Lists; ordered rules with status, exceptions, outcomes, impacted-rule counts and last editor; enabled/draft/archived states and create/edit/archive controls.

Assessment: this is a policy-management screen, more substantial than adding another routing dropdown. Show precedence and provide an event-based “why this route?” preview before activation.

Reuse/gap: current detection rules and `backend-go/internal/modules/intake` implement per-rule investigate/sample/suppress/escalate handling. Extend with versioned universal policies, deterministic precedence, tenant entity lists/exceptions, explainable evaluation, draft/active/archive lifecycle and simulation. Impact counts must come from an actual evaluation set. The screenshot's quarantine actions require the existing Go authorization/approval boundary; begin with mock execution and do not make suppression/quarantine automatic merely because a screenshot displays it.

## Navigation and implementation order

Keep **Detect → Overview** as requested. Add explicit Detection Intelligence, Coverage, Rules and Routing entries as their implementations become available. Recommendations belongs under the selected rule. Preserve existing `/detect/intelligence` and `/detect/rules` links with aliases/redirects if adopting the longer screenshot paths; choose one canonical path per view.

Recommended order:

1. Intelligence layout and aggregation contracts.
2. Rules table, panel and period-correct metrics.
3. Coverage reference data and evidence-backed assessment.
4. Recommendations and sandbox query validation.
5. Universal routing, simulation, audit and exception handling.

For each screen: agree its visible states and semantics, reuse current APIs where possible, implement missing contracts incrementally, and verify desktop/mobile screenshots plus empty/error/loading states, tenant isolation, filters and persistence. Visual similarity is achievable; the screenshots do not disclose 7AI's private algorithms or establish how unshown interactions behave.
