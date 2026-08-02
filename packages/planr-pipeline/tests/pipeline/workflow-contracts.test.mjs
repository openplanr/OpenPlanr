import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');

// BL-010: CI workflows are per-REPOSITORY, so they consolidated to the monorepo
// root and were renamed with package prefixes. Read them from there.
const repoRoot = resolve(root, '../..');
const readWorkflow = (name) => readFileSync(join(repoRoot, '.github/workflows', name), 'utf8');

test('package metadata identifies the provenance repository and license', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.deepEqual(packageJson.repository, {
    type: 'git',
    url: 'https://github.com/openplanr/planr-pipeline',
  });
  assert.equal(packageJson.license, 'MIT');
  assert.equal(packageJson.bugs?.url, 'https://github.com/openplanr/planr-pipeline/issues');
  assert.equal(packageJson.homepage, 'https://github.com/openplanr/planr-pipeline#readme');
});

test('release workflow publishes through changesets with provenance', () => {
  // BL-010 replaced the per-package publish.yml (release-published -> npm publish)
  // with a single monorepo release.yml driven by changesets. The invariant that
  // matters is unchanged: a clean install from the single lockfile, then
  // provenance-attested publication, with id-token permission present.
  // Strip comment lines before any ORDERING assertion: release.yml documents its
  // own design in a header comment that names these same commands, so a raw
  // indexOf would match the prose and compare the wrong positions.
  const workflow = readWorkflow('release.yml')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  const install = workflow.indexOf('npm ci');
  const publish = workflow.indexOf('changeset publish');
  assert.ok(install > 0, 'release workflow must run npm ci');
  assert.ok(publish > install, 'npm ci must precede publication');
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /registry-url/);
});

test('hostile sandbox certification covers Chromium Firefox and WebKit', () => {
  const workflow = readWorkflow('pipeline-tests.yml');
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
