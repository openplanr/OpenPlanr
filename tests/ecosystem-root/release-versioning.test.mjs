import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { PUBLIC_PACKAGE_PATHS, WORKSPACE_IDENTITIES, validateWorkspaceManifests } from '../../scripts/lib/workspace-release-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const readManifests = (directory = root) => new Map(Object.keys(WORKSPACE_IDENTITIES).map(path => [path, readJson(join(directory, path, 'package.json'))]));
const fixtureManifests = () => {
  const manifests = readManifests();
  // A future, coherent package set must pass without rewriting the release gate.
  const releases = { 'openplanr': '3.2.1', 'planr-pipeline': '1.4.2', '@openplanr/protocol': '2.3.0' };
  for (const manifest of manifests.values()) {
    manifest.version = releases[manifest.name] ?? '1.2.0';
    manifest.private = !PUBLIC_PACKAGE_PATHS.some(path => WORKSPACE_IDENTITIES[path] === manifest.name);
    for (const section of ['dependencies', 'optionalDependencies']) {
      for (const target of Object.keys(manifest[section] ?? {})) {
        if (Object.values(WORKSPACE_IDENTITIES).includes(target)) manifest[section][target] = releases[target] ?? '1.2.0';
      }
    }
  }
  return manifests;
};

test('release boundaries accept new coherent versions and reject drifted pins and invalid SemVer', () => {
  const rootManifest = readJson(join(root, 'package.json'));
  const manifests = fixtureManifests();
  assert.deepEqual(validateWorkspaceManifests(rootManifest, manifests), []);
  manifests.get('packages/cli').optionalDependencies['planr-pipeline'] = '^1.4.2';
  assert.ok(validateWorkspaceManifests(rootManifest, manifests).some(message => /pin planr-pipeline exactly/u.test(message)));
  manifests.get('packages/cli').optionalDependencies['planr-pipeline'] = '1.4.2';
  manifests.get('packages/protocol').version = '2.03.0';
  assert.ok(validateWorkspaceManifests(rootManifest, manifests).some(message => /valid SemVer/u.test(message)));
  assert.ok(validateWorkspaceManifests(rootManifest, manifests).some(message => /pin @openplanr\/protocol exactly/u.test(message)));
});

test('new versions do not permit publishing private workspaces or introducing forbidden dependencies', () => {
  const rootManifest = readJson(join(root, 'package.json'));
  for (const mutate of [
    manifests => { manifests.get('packages/design').private = false; },
    manifests => { manifests.get('packages/protocol').dependencies = { '@openplanr/design': '1.2.0' }; },
    manifests => { manifests.get('packages/pipeline').optionalDependencies['@openplanr/protocol'] = '2.3.0'; },
    manifests => { manifests.get('packages/artifact').peerDependencies = { '@openplanr/design': '1.2.0' }; },
    manifests => { manifests.get('packages/protocol').dependencies = { example: 'file:../example' }; },
    manifests => { manifests.get('packages/protocol').dependencies = { example: 'workspace:*' }; },
    manifests => { manifests.get('packages/cli').bundledDependencies = ['@openplanr/design']; },
    manifests => { manifests.get('packages/protocol').private = true; },
  ]) {
    const manifests = fixtureManifests();
    mutate(manifests);
    assert.notDeepEqual(validateWorkspaceManifests(rootManifest, manifests), []);
  }
});

test('Changesets versions the actual pending notes, updates exact pins, and generates readable changelogs without publishing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-release-versioning-'));
  const env = { ...process.env, CI: '1', NO_COLOR: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: directory, env, encoding: 'utf8', timeout: 60_000 });
    assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    return result;
  };
  try {
    const rootManifest = readJson(join(root, 'package.json'));
    writeFileSync(join(directory, 'package.json'), JSON.stringify(rootManifest));
    for (const [path, manifest] of readManifests()) {
      mkdirSync(join(directory, path), { recursive: true });
      writeFileSync(join(directory, path, 'package.json'), JSON.stringify(manifest));
    }
    mkdirSync(join(directory, '.changeset'));
    for (const file of readdirSync(join(root, '.changeset')).filter(file => file.endsWith('.md') || file === 'config.json')) {
      writeFileSync(join(directory, '.changeset', file), readFileSync(join(root, '.changeset', file)));
    }
    // This is a metadata-only version rehearsal. No installation, package
    // publication, source override, or change to the developer's tree occurs.
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
    run('git', ['init', '--initial-branch=main', '--quiet']);
    run('git', ['add', 'package.json', 'packages', 'apps', '.changeset']);
    run('git', ['-c', 'user.name=Release test', '-c', 'user.email=release-test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--message=Initialize disposable release fixture']);
    const cli = join(root, 'node_modules/@changesets/cli/bin.js');
    run(process.execPath, [cli, 'status', '--output', join(directory, 'release-plan.json')]);
    const planned = readJson(join(directory, 'release-plan.json'));
    const candidate = planned.releases.filter(release => release.type !== 'none');
    if (candidate.length === 0) return; // A release branch may have consumed every changeset.
    run(process.execPath, [cli, 'version']);
    const manifests = readManifests(directory);
    assert.deepEqual(validateWorkspaceManifests(rootManifest, manifests), []);
    for (const release of candidate) {
      const path = Object.keys(WORKSPACE_IDENTITIES).find(path => WORKSPACE_IDENTITIES[path] === release.name);
      assert.equal(manifests.get(path).version, release.newVersion);
      const notes = readFileSync(join(directory, path, 'CHANGELOG.md'), 'utf8');
      assert.ok(notes.includes(`## ${release.newVersion}`), `${release.name} changelog misses its released version`);
      assert.ok(notes.length > 50, `${release.name} changelog is empty`);
    }
    const workflowMigration = planned.changesets.find(changeset => changeset.id === 'host-native-workflow-migration');
    if (workflowMigration) {
      const cliRelease = planned.releases.find(release => release.name === 'openplanr');
      assert.equal(cliRelease.type, 'major');
      const notes = readFileSync(join(directory, 'packages/cli/CHANGELOG.md'), 'utf8');
      assert.match(notes, /breaking CLI change/u);
      assert.match(notes, /planr spec decompose/u);
    }
    assert.deepEqual(readdirSync(join(directory, '.changeset')).filter(file => file.endsWith('.md') && file !== 'README.md'), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
