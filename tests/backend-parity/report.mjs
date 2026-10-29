import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { argumentsFor, root, output } from './harness.mjs';
import { probeCoverage, routeFor } from './coverage.mjs';

const options = argumentsFor();
const read = async path => JSON.parse(await readFile(root+'/'+path, 'utf8'));
const [inventory, functional, auth, mapping] = await Promise.all([
  read('contracts/current-backend.json'),
  read(options.functional || 'output/backend-parity/node-report.json'),
  read(options.auth || 'output/backend-parity/node-auth.json'),
  read('contracts/frontend-journeys.json'),
]);
assert.ok(functional.results.every(result => result.passed), 'Functional scenarios failed');
assert.equal(auth.passed, true, 'Authentication suite failed');
const events = [...functional.requests, ...auth.checks.map(event => ({...event,scenario:'authentication'}))];
const scenarios = new Set([...functional.results.map(result => result.name), 'authentication']);
const journeys = [];
for (const journey of mapping.journeys) {
  for (const source of journey.sources) await readFile(root+'/'+source);
  for (const name of journey.scenarios) assert.ok(scenarios.has(name), 'Unknown scenario: '+name);
  const missing = journey.endpoints.filter(endpoint => {
    const [method, path] = endpoint.split(' ');
    const fullPath = '/api/v1'+path;
    assert.ok(inventory.routes.some(route => route.method === method && route.path === fullPath), 'Unknown endpoint: '+endpoint);
    return !events.some(event => {
      const route = routeFor(inventory.routes, event);
      return route?.method === method && route?.path === fullPath && journey.scenarios.includes(event.scenario);
    });
  });
  journeys.push({id:journey.id, mapped_endpoints:journey.endpoints.length, missing_probes:missing, behavioral_gaps:journey.gaps});
}
const coverage = probeCoverage(inventory.routes, events);
await output(options.output || 'output/backend-parity/coverage.json', {
  timestamp:new Date().toISOString(), note:'Coverage of HTTP probes, not complete parity or browser verification. Input reports must come from the intended backend/revision.',
  functional_scenarios:functional.results.length, authentication_requests:auth.check_count,
  endpoint_probe_coverage:coverage, journeys,
});
assert.equal(coverage.missing.length, 0, 'Unprobed registered routes');
assert.ok(journeys.every(journey => journey.missing_probes.length === 0), 'Journey endpoint missing from its referenced scenarios');
console.log(`PASS ${coverage.covered}/${coverage.total} route probes; ${journeys.length} mapped journeys`);
