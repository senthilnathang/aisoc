# Local credential-phishing flow

Build → Detect → Investigate → Respond → Skills/Memory now has an additive credential-phishing scenario. It uses synthetic JSON and the existing Go control plane, Redis delivery, PostgreSQL state and Python gRPC mock worker. It does not open links, parse mail attachments, contact a mailbox/identity provider or run an LLM. The existing suspicious-login flow remains supported.

## Try it

1. Open **Build → Local integrations** (`/build/integrations`), create a profile and select an authorized mock source.
2. Select **Load phishing example (replaces JSON)**, or upload a bundle matching `examples/scenarios/phishing/document.json`. The checked-in example uses tenant `demo`; the generated example uses the authenticated tenant. Go rejects a foreign tenant rather than silently relabeling it.
3. Validate and inspect the finding, event types, message reference and review gaps. Save the draft, explicitly confirm import and refresh pipeline status.
4. Open the investigation's review tab. Inspect cited hypotheses, event times/hashes and missing evidence. Explicitly approve the mock SOAR note. This leaves the case open and its analyst determination unchanged.
5. With configured sandbox response grants, propose **mock session revocation** for an explicitly selected test session. A different approver reviews the target/evidence; a third operator previews and executes with confirmation. The sandbox kill switch must permit execution. The receipt and mock SOAR response note record zero external calls. This is not email quarantine.
6. An analyst may record a reviewed outcome and evidence, then create scoped Skill and Memory proposals using existing outcome learning. Another operator must approve them before future matching. Future cases retain an unknown determination; prior guidance is advisory.

The scenario example API is `GET /api/v1/build/integrations/example?scope_id=<authorized-scope>&scenario=phishing`. Omit `scenario` or use `login` for the existing login example. Unknown scenarios fail validation. The managed Build runtime uses the existing `build-login-v1` processor identifier for backward-compatible progress/recovery records; that internal name now handles both supported fixture families.

## Contract and detection

The bundle retains `schema_version: "1"` and the existing `events` array. Each event retains telemetry `schema_version: "1.0"` and adds `projection.message_ref`, an opaque allowlisted identifier, for these four types:

| Event | Meaning of the synthetic observation |
|---|---|
| `email.delivered` | Message delivered to the named principal/device |
| `email.authentication_failed` | Source reports failed email authentication; original headers remain unavailable |
| `email.link_clicked` | Source reports a click associated with this message |
| `email.credential_submitted` | Source reports credential submission; it does not include credentials or establish compromise |

The current fixture requires exactly one of each, in strictly increasing event time within five minutes, with the same message, principal, asset and canonical IP. Arrival order does not matter. Source IDs, revisions, evidence references and times remain validated. The generic detector supports bounded snapshots; the Build phishing profile accepts exactly four events, one finding and no optional IAM/EDR context. Ambiguous repeated stages do not produce a finding; conflicting content/revisions fail closed. Broader mail campaigns, same-time stages, multiple devices/IPs and attachment malware are outside this slice.

Message references are required for phishing and forbidden on login observations. The field is omitted when absent, preserving existing login content hashes. Raw mail, arbitrary payload fields and executable instructions are not accepted. Evidence references are not fetchable URLs. Tenant/source authorization comes from the configured Go scope; profile connectors are assigned by Go.

The `mail-credential-submission` rule (version 1) produces a `credential_phishing` review candidate. Admission rechecks the persisted evidence and recomputes the rule before atomically creating the source alert and investigation. The local rule record is `mock-stream-phishing`; disabling it prevents new admissions. Replay preserves the original case and job identities. Login-only enrichment is omitted for phishing findings even when the direct mock source has login context configured; phishing gaps remain explicit. No SQL schema migration or new service is required.

## Investigation and response boundaries

The existing typed gRPC `InvestigationTask` carries four evidence references, hashes, event times and allowlisted event types. Go already validated message/user/device binding before queueing; the worker does not resolve raw source payloads. Python mock reasoning returns:

- **Possible credential phishing:** the linked sequence supports this hypothesis, without proving it.
- **Possible authorized simulation:** delivery is compatible with it, while the other observations remain neutral until the simulation is verified. There is no fabricated counterevidence.
- **Missing evidence:** original email headers, independent URL reputation, authorized-simulation verification, current IAM/session context and independent verification.

Go QA requires exact supported hypotheses, complete citation membership, deterministic support/neutral classification, all five gaps and an `INCONCLUSIVE` verdict with human review. Mixed login/phishing tasks, partial or duplicate stages and phishing `model-v1` tasks are rejected. No response authority or credentials are passed to Python. There is no claim of model quality or phishing precision/recall.

Mock session response reuses the existing proposer/approver/executor roles, exact evidence snapshot, scoped grants, source-version check, expiring approval, kill switch, atomic audit/receipt and replay protection. The proposed session is an analyst-selected synthetic target, not an automatically discovered compromised session. [Response details](INVESTIGATE_RESPOND_SANDBOX.md).

Outcome learning reuses [Skills/Memory lifecycle](SKILLS_MEMORY_LIFECYCLE.md): source version, artifact references, independent approval, freshness, immutable application snapshots and reapproval/archive controls. The mock worker does not resolve the case or generate approved guidance by itself. The local case processor preserves the current analyst determination for phishing, including a decision recorded while processing was underway; source severity does not replace it. Login processing retains its existing behavior.

## Implementation map

| Boundary | Files |
|---|---|
| Envelope and rule | `backend-go/internal/modules/telemetry/{contract,phishing,finding}.go` |
| Build preview and example | `backend-go/internal/modules/localintegrations/preview.go`, `backend-go/internal/transport/httpapi/local_integrations.go` |
| Durable admission and processing | `backend-go/internal/modules/intake/findings.go`, `backend-go/internal/modules/telemetrypipeline/sandbox.go` |
| Typed reasoning and QA | `services/python-worker/investigation.py`, `backend-go/internal/modules/l1/qa.go` |
| UI | `frontend/src/LocalIntegrations.jsx`, `frontend/src/InvestigationReview.jsx` |
| API acceptance | `scripts/framework/check_phishing.py` |
| Browser acceptance | `scripts/release/phishing.mjs` |

Rust is not added to this small four-observation rule without a measured need. Existing Rust workers remain available for their established capabilities.

## Tests and rollback

Focused Go tests cover order/replay, message/tenant/entity isolation, conflicting source revisions, incomplete evidence, malformed previews, invented citations and QA classification. Python tests exercise the authenticated gRPC path and reject unsupported mixed/model tasks. The mandatory local release gate adds phishing API acceptance and browser import/review checks alongside existing login, approvals, SSO and recovery checks.

Run `python3 scripts/framework/release_gate.py --chromium-executable /opt/google/chrome/chrome`. All services and mutations are confined to disposable local fixtures. Generated reports distinguish API-executed response/feedback from browser-executed import/review; the existing response/Skills/Memory browser workflows continue to run independently.

Rollback requires coordinating API and worker versions. Old binaries reject the new event family; stop new phishing imports and retain/archive their records before deploying older code. Never replay phishing evidence through an older login-only worker. Existing login data requires no conversion. No live provider settings are changed.


## Verified phishing release — 2026-11-02

Run `108f639e1ceb493f9bc044d81079f416` passed all five release stages in 279.95 seconds: frontend lint/build and 35 regression tests; backend/API acceptance including phishing; eleven browser stages with 72 desktop/mobile route checks; eight OIDC checks plus self-approval denial; and backup/restore matching 76 tables, one archived payload and two retention snapshots with corruption rejection. Go race/vet and Python worker checks ran in the disposable framework suite. Reports and screenshots are under `output/release-gate/108f639e1ceb493f9bc044d81079f416/`.

The earlier `06da61047f714c6696870297ac50aeb1` run failed during its mobile route sweep after phishing passed. The route gate now explicitly waits for a visible heading before inspecting rendered content, instead of assuming network idle means rendering is complete. The complete rerun passed without weakening authorization or evidence checks. Results validate local/mock behavior only; no live mail provider, production response, actual-model quality or throughput is certified.
