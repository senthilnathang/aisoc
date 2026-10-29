import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'aisoc-publish-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  await copyFile(new URL('../../frontend/scripts/publish.mjs', import.meta.url), join(root, 'scripts/publish.mjs'));
  return root;
}

test('build alias stays in dist and does not copy assets into the source root', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'dist/assets'), { recursive: true });
  await mkdir(join(root, 'public/fonts'), { recursive: true });
  await writeFile(join(root, 'dist/index.html'), '<html>built</html>');
  await writeFile(join(root, 'dist/assets/app.js'), 'built');
  await writeFile(join(root, 'public/fonts/source.woff'), 'source');
  const result = spawnSync(process.execPath, [join(root, 'scripts/publish.mjs')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(root, 'dist/app.html'), 'utf8'), '<html>built</html>');
  assert.equal(await readFile(join(root, 'public/fonts/source.woff'), 'utf8'), 'source');
  assert.deepEqual((await readdir(root)).sort(), ['dist', 'public', 'scripts']);
});

test('missing build fails without manufacturing output', async t => {
  const root = await fixture(t);
  const result = spawnSync(process.execPath, [join(root, 'scripts/publish.mjs')], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Expected dist\/index.html/);
  assert.deepEqual(await readdir(root), ['scripts']);
});
