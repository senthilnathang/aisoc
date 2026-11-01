# Critical workflow browser coverage

Extend the existing disposable release gate; keep all integrations local/mock. No new runtime infrastructure or production actions.

1. Require four additional browser stages and evidence fields in the combined report; test rejection of incomplete reports.
2. Generate run-specific source cases, guidance, hunt and alert/rule fixtures through the disposable API. Add a separate mock-response scope so browser actions do not affect existing response-capacity fixtures.
3. Drive real UI operations: independent response approval, kill switch, executor preview/confirmation and receipt replay; staged Skill edits, source changes, independent reapproval/publication and archive; approved Memory search, stale exclusion, historical snapshot promotion; explicit alert labels, recommendation validation/replay and guarded local application.
4. Use API reads for persisted state assertions. Replay the exact browser-originated response execution request through its authenticated session to verify idempotency; record that distinction. Do not intercept writes or expose credentials in reports.
5. Run the combined browser/API/backup gate, inspect screenshots, fix discovered issues, and update coverage/results documentation. Existing demo remains untouched.
