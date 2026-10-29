import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('./compare.mjs', import.meta.url).pathname;
const latency = value => ({ p50_ms: value / 2, p95_ms: value, p99_ms: value });
const campaign = () => ({ label: 'fixture', fixture_fingerprint: 'matched', reports: [1, 2, 3].map(repeat => ({
  size: 'small', repeat, error_count: 0, successful_rps: 100,
  latency: latency(10), operations: { list: latency(10), update: latency(10) },
})) });

async function compare(t, before, after) {
  const directory = await mkdtemp(join(tmpdir(), 'aisoc-compare-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'before.json'), JSON.stringify(before));
  await writeFile(join(directory, 'after.json'), JSON.stringify(after));
  const result = spawnSync(process.execPath, [script, '--before', join(directory, 'before.json'),
    '--after', join(directory, 'after.json'), '--output', join(directory, 'result.json')], { encoding: 'utf8' });
  return { ...result, report: result.status === 0 ? JSON.parse(await readFile(join(directory, 'result.json'), 'utf8')) : null };
}

test('per-operation tails fail the gate even when aggregate latency improves', async t => {
  const before = campaign(), after = campaign();
  for (const row of after.reports) { row.latency = latency(5); row.operations.update = latency(20); }
  const result = await compare(t, before, after);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.latency_gate_passed, false);
  assert.deepEqual(result.report.latency_regressions_over_10_percent.map(row => [row.operation, row.metric]),
    [['update', 'p95_ms'], ['update', 'p99_ms']]);
});

test('uses repeat medians and allows exactly ten percent regression', async t => {
  const before = campaign(), after = campaign();
  after.reports[0].operations.update = latency(1000);
  after.reports[1].operations.update = latency(11);
  after.reports[2].operations.update = latency(11);
  const result = await compare(t, before, after);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.latency_gate_passed, true);
});

for (const [name, mutate, message] of [
  ['different workloads', c => { c.fixture_fingerprint = 'other'; }, /fingerprints differ/],
  ['failed requests', c => { c.reports[0].error_count = 1; }, /Failed requests/],
  ['sampling failure', c => { c.reports[0].resources = { sampling_error: 'gone' }; }, /sampling errors/],
  ['unequal repeats', c => { c.reports.pop(); }, /Repeat counts differ/],
  ['missing operations', c => { delete c.reports[0].operations.update; }, /Operation sets differ/],
  ['invalid latency', c => { c.reports[0].operations.update.p99_ms = null; }, /finite nonnegative/],
  ['empty report', c => { c.reports = []; }, /measured reports/],
]) {
  test(`rejects ${name}`, async t => {
    const after = campaign(); mutate(after);
    const result = await compare(t, campaign(), after);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  });
}
