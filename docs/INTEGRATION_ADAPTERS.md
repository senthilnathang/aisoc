# Integration and inference adapter boundaries

The approved validation environment uses local JSON fixtures. No installed vendor
edition/version, endpoint, credential scope or real model quality is verified.

## QRadar read adapters

`backend-go/internal/modules/integrations/qradar.go` implements bounded read-only
SIEM offense polling and SOAR incident retrieval. SIEM uses a pinned `Version`,
`SEC` token, domain binding, 100-record limit and a `(last_persisted_time,id)` cursor
within a fixed upper time bound. The cursor is proposed only; advance durable state
after acceptance. Replay an earlier cursor with existing deduplication. Multi-domain
offenses are rejected instead of being assigned to a tenant by assumption.

The field used for case updates is last persistence time, which differs from the
time of the last contributing event. This follows IBM's
[offense endpoint contract](https://ibmsecuritydocs.github.io/qradar_api_25.0/25.0--siem-offenses-GET.html).
The pinned API version is mandatory because an omitted version can change behavior
after an upgrade; see IBM's [version guidance](https://www.ibm.com/docs/en/qradar-common?topic=api-endpoint-documentation-supported-versions).

SOAR uses explicit organization/incident IDs and its own credential file. It
retrieves case context through `/rest/orgs/{org}/incidents/{id}`; this is not raw
SIEM telemetry. Installed schemas and conflict behavior must be checked using the
product's API browser, as described by IBM's [SOAR REST guide](https://www.ibm.com/support/pages/rest-api).
Live SOAR writes, Ariel query admission and Sentinel adapters remain separate
capabilities; the working demo continues to use normalized JSON and mock notes.

Both adapters enforce bounded payloads, deadlines, no redirects, TLS outside
literal loopback, at most three read attempts for 429/503 and bounded retry delays.
They expose no privileged methods. Credential files contain a SIEM token or the
SOAR `Basic …` authorization value; never put credentials in endpoint URLs.

Explicit read-only probe:

```bash
cd backend-go
go build -o bin/integration-probe ./cmd/integration-probe
bin/integration-probe --config /private/qradar.json --out /private/sample.json
```

Configuration keys use the exported Go names: `Endpoint`, `Version`, `Product`,
`CredentialFile`, `DomainID`, `OrganizationID`. Pin the actual installed version;
the fixture's 25.0/51.0 labels are not discovery of your products. Probe output
does not automatically become an authentication event or advance a database cursor.

## Optional JSON inference service

The independent Python FastAPI/gRPC service accepts `mock-v1` by default. Explicit
`model-v1` tasks require `AISOC_INFERENCE_URL` and `AISOC_INFERENCE_MODEL`; optional
`AISOC_INFERENCE_CREDENTIAL_FILE` is a private inference-only bearer credential.
The JSON adapter endpoint is a service contract, not an assumption that every
commercial model API accepts this body. Supply a provider wrapper implementing it.

Request: schema version, model label, metadata-only evidence, instruction to treat
evidence as untrusted, output fields and a 1,024-token budget. Response fields:
`verdict`, two `hypotheses` (kind/supporting_refs/counterevidence_refs), and
`missing_evidence`. Transport is capped at four seconds and 16 KiB response size.
No tools or response credentials are sent. Redirects and insecure remote URLs fail.

Go calls the existing typed Investigator RPC and applies QA to identities,
deadlines, evidence coverage, contradictory/unknown citations and missing evidence.
Every model verdict still requires human review. The durable showcase queue stays
explicitly mock-only; an inference transport test does not authorize production
model scheduling or automatic closure. The test harness exercises Go → Python
gRPC → local JSON model-service fixture → Go QA. This establishes the transport
and veto behavior, not analyst-labelled precision/recall or real LLM quality.
