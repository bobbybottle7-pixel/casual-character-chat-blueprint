/* Tests for the single-file build.
 *
 * The first test here exists because of a bug that actually shipped into a
 * build and broke the whole app: `const $$ = ...` arrived in the bundle as
 * `const $ = ...`, because String.replace() treats "$$" in a STRING
 * replacement as an escape meaning one literal "$". The page died with
 * "Identifier '$' has already been declared". It is an easy mistake to make
 * again, so it gets a test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist/allai.html');

function build() {
  execFileSync(process.execPath, [path.join(ROOT, 'build/build-allai.js')], { cwd: ROOT });
  return fs.readFileSync(OUT, 'utf8');
}

test('the build produces a single self-contained file', () => {
  const html = build();
  assert.ok(html.includes('<style>'), 'the stylesheet should be inlined');
  assert.ok(!/<link\s+rel="stylesheet"/.test(html), 'no stylesheet should still be linked');
  assert.ok(!/<script[^>]+src=/.test(html), 'no script should still be linked');
});

test('dollar signs in the source survive inlining', () => {
  const html = build();
  const source = fs.readFileSync(path.join(ROOT, 'src/ui/app.js'), 'utf8');
  assert.ok(source.includes('const $$ ='), 'this test assumes app.js still defines $$');
  assert.ok(html.includes('const $$ ='), '$$ was mangled on the way into the bundle');
  assert.ok(!/const \$ = \(sel, root = document\) => \[\.\.\./.test(html), '$$ collapsed into $');
});

test('every module keeps its own scope, so shared names do not collide', () => {
  const html = build();
  // Three provider files each declare their own ENDPOINT. A plain
  // concatenation would produce a duplicate-declaration crash.
  const endpoints = (html.match(/^const ENDPOINT = /gm) || []).length;
  assert.ok(endpoints >= 2, `expected several scoped ENDPOINT declarations, found ${endpoints}`);
});

test('--check reports a stale file', () => {
  build();
  execFileSync(process.execPath, [path.join(ROOT, 'build/build-allai.js'), '--check'], { cwd: ROOT });

  fs.writeFileSync(OUT, '<!-- tampered -->');
  assert.throws(
    () => execFileSync(process.execPath, [path.join(ROOT, 'build/build-allai.js'), '--check'], { cwd: ROOT, stdio: 'pipe' }),
    'a stale dist file should fail the check',
  );
  build();
});

test('no API key is ever baked into the shipped file', () => {
  const html = build();
  // Keys live in the phone's storage, never in source. These are the shapes
  // the common providers use.
  assert.ok(!/sk-or-v1-[A-Za-z0-9]{12}/.test(html), 'an OpenRouter key is in the build');
  assert.ok(!/sk-ant-[A-Za-z0-9]{12}/.test(html), 'an Anthropic key is in the build');
  assert.ok(!/\bBearer\s+[A-Za-z0-9_-]{20,}/.test(html), 'a hardcoded bearer token is in the build');
});
