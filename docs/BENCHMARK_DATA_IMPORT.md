# Import benchmark data into the local demo

The load test exports its exact generated synthetic input **after** timing ends to
`output/backend-framework/stream-load.json.events.jsonl`. Its successful report
contains the export SHA-256. The one setup event is excluded. Test database cleanup
continues; neither benchmark timing nor correctness depends on persistent demo data.

Create a bundle only after the test exits successfully:

```bash
python3 scripts/framework/check.py --with-streams --stream-load --stream-measure-only --stream-events 60000 --stream-eps 1000 --stream-idle-poll-ms 20 --stream-consumer-batch 100 --stream-monitor-ms 1000
python3 scripts/framework/benchmark_import.py prepare --bundle output/demo-import/benchmark-60k
python3 scripts/framework/benchmark_import.py validate --bundle output/demo-import/benchmark-60k
python3 scripts/framework/benchmark_import.py configure --bundle output/demo-import/benchmark-60k
./run.sh stop backend
./run.sh start backend
python3 scripts/framework/benchmark_import.py import --bundle output/demo-import/benchmark-60k
python3 scripts/framework/benchmark_import.py verify --bundle output/demo-import/benchmark-60k
```

`--stream-measure-only` runs the bounded measurement and its reconciliation checks;
it does not rerun the entire regression suite. Omit it when full validation is needed.
The performance target can remain unmet even when all events complete correctly.

The bundle retains `benchmark-report.json`, original `benchmark-events.jsonl`, a
checksummed `manifest.json`, and up to 60 `benchmark-import-NN.json` files. Each file
contains at most 1,000 projected events. The importer reads these files and submits
100-event batches through the existing Go mock-import API, using current source
checkpoints. Repeating the same bundle inserts zero duplicates. A partial import
can be restarted; source hashes and server-side conflict checks prevent silent
replacement. Preparing refuses to overwrite an existing directory.

The demo copy explicitly changes tenant/connector bindings and assigns a unique
synthetic principal to each event, keeping entity correlation within its configured
bound. Original timestamps, event IDs and evidence references remain. These failed
login events alone do not create suspicious-login investigations; the existing
10,000-event showcase retains its ten investigation examples. This is an importable
demo projection of tested input, not an unchanged production telemetry replay.

All grants use local development identity and the `demo` tenant, allow mock intake,
and deny sandbox response actions. Existing grants are preserved; incompatible
grants are rejected. No schema changes or direct database inserts are needed.
Files contain synthetic data only and are stored under ignored `output/`.

View `http://127.0.0.1:8080/build-operations`, select `benchmark-import-01` through
`benchmark-import-60`, and use the telemetry table's pagination/JSON viewer. The
API is `http://127.0.0.1:3003/api/v1/stream-operations` with `X-Tenant-Id: demo`.
The receipt records accepted imports, not consumer completion or benchmark EPS;
verify completed/pending counts separately in the operations page.
`verify` checks Go API counts and worker health, records `verification.json`, and
exits nonzero while processing is incomplete or workers report a retry condition.
Full sources display the expected `mock_source_capacity` alert at 1,000 events;
this indicates the configured intake cap, not lost data or a processing failure.

Tests: `python3 -m unittest discover -s scripts/framework -p 'test_benchmark_import.py'`.

The expanded demo uses a bounded 16-connection Redis consumer pool because many
independent sources perform blocking reads concurrently. Other clients retain the
four-connection default; Redis remains capped at 32 clients. The concurrent-reader
regression is covered by `python3 scripts/framework/check_streams.py`.
