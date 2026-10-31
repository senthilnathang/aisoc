import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { compilerPlugins } from '../../frontend/compiler.config.js';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { transformSync } = require('@babel/core');
const fixture = 'export function Results({items}) { const names = items.map(item => item.name); return <ul>{names.map(name => <li key={name}>{name}</li>)}</ul>; }';

test('compiler generates memoized React 19 output and can be disabled', () => {
  const compile = flag => transformSync(fixture, { filename:'Results.jsx', configFile:false, babelrc:false, parserOpts:{plugins:['jsx']}, plugins:compilerPlugins(flag) }).code;
  assert.match(compile('1'), /react\/compiler-runtime/);
  assert.doesNotMatch(compile('0'), /react\/compiler-runtime/);
  assert.match(compile(undefined), /react\/compiler-runtime/);
  assert.throws(() => compilerPlugins('invalid'), /0 or 1/);
});
