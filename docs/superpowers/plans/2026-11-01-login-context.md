# Local IAM/MFA and EDR evidence adapters

User-approved scope: configurable local JSON adapters extending the reviewed suspicious-login slice; no live providers or model activation.

Design: optional bounded adapter bundle in trusted stream configuration, loaded from a scenario-relative JSON file. Go validates tenant/subject/asset binding against retained login evidence, evaluates freshness relative to the historical login time, and snapshots normalized provenance/outcomes/process metadata into the existing durable protobuf job input. No new database or queue. Typed additive EvidenceItem context fields cross the existing gRPC boundary. Mock hypotheses distinguish supportive/counterevidence but always remain INCONCLUSIVE; Go QA validates missing/conflicting context claims. No approval bypass or automatic closure. Existing no-context inputs retain their previous behavior. Separate source IDs keep fixtures and previous receipts immutable.

- [x] Adapter validation and typed snapshot contract, with failing tests first.
- [x] Go queue/config integration, Python mock interpretation, QA and SOAR gaps.
- [x] Case evidence display and configurable fixture runner; corroborating/suspicious/missing/conflicting/stale scenarios.
- [x] Full framework, isolation/replay/error tests and browser verification.
- [x] Independent review and documentation/results.
