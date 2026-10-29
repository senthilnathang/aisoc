import assert from 'node:assert/strict';
import { test } from 'node:test';
import { probeCoverage, routeFor } from './coverage.mjs';

const routes = [
  {method:'GET',path:'/api/v1/skills/:id'},
  {method:'GET',path:'/api/v1/skills/outcomes'},
  {method:'PATCH',path:'/api/v1/skills/:id'},
];
test('static endpoints do not falsely cover parameter endpoints', () => {
  const coverage = probeCoverage(routes, [{method:'GET',path:'/api/v1/skills/outcomes?limit=1'}]);
  assert.equal(coverage.covered, 1);
  assert.deepEqual(coverage.routes, ['GET /api/v1/skills/outcomes']);
  assert.equal(coverage.missing.length, 2);
});
test('route coverage respects method and full path', () => {
  assert.equal(routeFor(routes, {method:'PATCH',path:'/api/v1/skills/example'}), routes[2]);
  assert.equal(routeFor(routes, {method:'POST',path:'/api/v1/skills/example'}), undefined);
  assert.equal(routeFor(routes, {method:'GET',path:'/api/v1/skills/example/materials'}), undefined);
});
