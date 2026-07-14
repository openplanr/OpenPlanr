import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');

test('publish workflow installs the exact lock before every release gate', () => {
  const workflow = read('.github/workflows/publish.yml');
  const install = workflow.indexOf('- run: npm ci');
  const tests = workflow.indexOf('- run: npm test');
  const publish = workflow.indexOf('- run: npm publish --access public --provenance');
  assert.ok(install > 0, 'publish workflow must run npm ci');
  assert.ok(install < tests, 'npm ci must precede package tests');
  assert.ok(tests < publish, 'tests must precede provenance publication');
  assert.match(workflow, /id-token:\s*write/);
});

test('hostile sandbox certification covers Chromium Firefox and WebKit', () => {
  const workflow = read('.github/workflows/test.yml');
  assert.match(workflow, /browser:\s*\[chromium, firefox, webkit\]/);
  assert.match(workflow, /PLANR_BROWSER_ENGINE:\s*\$\{\{ matrix\.browser \}\}/);
  assert.match(workflow, /playwright install --with-deps \$\{\{ matrix\.browser \}\}/);
  assert.match(workflow, /node --test tests\/artifact\/sandbox-hostile\.test\.mjs/);

  const hostile = read('tests/artifact/sandbox-hostile.test.mjs');
  assert.match(hostile, /\['chromium', 'firefox', 'webkit'\]\.includes\(browserEngine\)/);
  assert.match(hostile, /playwright\[browserEngine\]/);
});

test('release stack metadata remains valid in spec-driven conformance', () => {
  for (const fixture of ['spec-driven-todo', 'spec-driven-todo-shipped']) {
    assert.doesNotThrow(() => execFileSync(process.execPath, [
      'conformance/runner.mjs',
      '--runtime', 'cursor',
      '--validate-schema', `conformance/fixtures/${fixture}`,
    ], { cwd: root, stdio: 'pipe' }));
  }
});
