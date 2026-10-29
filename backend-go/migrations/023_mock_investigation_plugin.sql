-- Extend the existing specialist allowlist; no existing job semantics change.
ALTER TABLE jobs DROP CONSTRAINT jobs_plugin_id_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_plugin_id_check CHECK
 (plugin_id IN ('python.normalize','rust.sha256','rust.wasm_ascii_upper','python.investigate_mock'));
