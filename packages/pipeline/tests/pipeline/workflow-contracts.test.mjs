import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspaceRoot = resolve(root, '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const readWorkspace = (path) => readFileSync(join(workspaceRoot, path), 'utf8');

test('package metadata identifies the provenance repository and license', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.deepEqual(packageJson.repository, {
    type: 'git',
    url: 'git+https://github.com/openplanr/OpenPlanr.git',
    directory: 'packages/pipeline',
  });
  assert.equal(packageJson.license, 'MIT');
  assert.equal(packageJson.bugs?.url, 'https://github.com/openplanr/OpenPlanr/issues');
  assert.equal(
    packageJson.homepage,
    'https://github.com/openplanr/OpenPlanr/tree/main/packages/pipeline#readme',
  );
});

test('local release proof installs the exact root lock and never publishes', () => {
  const workflow = readWorkspace('.github/workflows/release-proof.yml');
  const install = workflow.indexOf('run: npm ci');
  const verification = workflow.indexOf('run: npm run verify');
  assert.ok(install > 0, 'release proof must run npm ci');
  assert.ok(install < verification, 'npm ci must precede workspace verification');
  assert.doesNotMatch(workflow, /npm publish|id-token:\s*write/u);
});

test('hostile sandbox certification covers Chromium Firefox and WebKit', () => {
  const workflow = readWorkspace('.github/workflows/artifact-browser.yml');
  assert.match(workflow, /browser:\s*\[chromium, firefox, webkit\]/);
  assert.match(workflow, /PLANR_BROWSER_ENGINE:\s*\$\{\{ matrix\.browser \}\}/);
  assert.match(workflow, /playwright install --with-deps \$\{\{ matrix\.browser \}\}/);
  assert.match(
    workflow,
    /node --test packages\/pipeline\/tests\/artifact\/sandbox-hostile\.test\.mjs/,
  );

  const hostile = read('tests/artifact/sandbox-hostile.test.mjs');
  assert.match(hostile, /\['chromium', 'firefox', 'webkit'\]\.includes\(browserEngine\)/);
  assert.match(hostile, /playwright\[browserEngine\]/);
});

test('release stack metadata remains valid in spec-driven conformance', () => {
  for (const fixture of ['spec-driven-todo', 'spec-driven-todo-shipped']) {
    assert.doesNotThrow(() =>
      execFileSync(
        process.execPath,
        [
          'conformance/runner.mjs',
          '--runtime',
          'cursor',
          '--validate-schema',
          `conformance/fixtures/${fixture}`,
        ],
        { cwd: root, stdio: 'pipe' },
      ),
    );
  }
});
