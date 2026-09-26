import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  PUBLIC_PACKAGE_PATHS,
  WORKSPACE_IDENTITIES,
  validateWorkspaceManifests,
} from '../../scripts/lib/workspace-release-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const readManifests = (directory = root) =>
  new Map(
    Object.keys(WORKSPACE_IDENTITIES).map((path) => [
      path,
      readJson(join(directory, path, 'package.json')),
    ]),
  );
const releaseFixtureEnv = () => ({
  ...process.env,
  PATH: [dirname(process.execPath), process.env.PATH ?? ''].join(delimiter),
  CI: '1',
  NO_COLOR: '1',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  // A release fixture can contain enough objects for Git to launch detached
  // maintenance. Keep the fixture synchronous so cleanup cannot race a child
  // process recreating .git directories after the test has removed them.
  GIT_CONFIG_COUNT: '4',
  GIT_CONFIG_KEY_0: 'gc.auto',
  GIT_CONFIG_VALUE_0: '0',
  GIT_CONFIG_KEY_1: 'gc.autoDetach',
  GIT_CONFIG_VALUE_1: 'false',
  GIT_CONFIG_KEY_2: 'maintenance.auto',
  GIT_CONFIG_VALUE_2: 'false',
  GIT_CONFIG_KEY_3: 'maintenance.autoDetach',
  GIT_CONFIG_VALUE_3: 'false',
});
const fixtureManifests = () => {
  const manifests = readManifests();
  // A future, coherent package set must pass without rewriting the release gate.
  const releases = {
    openplanr: '3.2.1',
    'planr-pipeline': '1.4.2',
    '@openplanr/protocol': '2.3.0',
  };
  for (const manifest of manifests.values()) {
    manifest.version = releases[manifest.name] ?? '1.2.0';
    manifest.private = !PUBLIC_PACKAGE_PATHS.some(
      (path) => WORKSPACE_IDENTITIES[path] === manifest.name,
    );
    for (const section of ['dependencies', 'optionalDependencies']) {
      for (const target of Object.keys(manifest[section] ?? {})) {
        if (Object.values(WORKSPACE_IDENTITIES).includes(target))
          manifest[section][target] = releases[target] ?? '1.2.0';
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
  assert.ok(
    validateWorkspaceManifests(rootManifest, manifests).some((message) =>
      /pin planr-pipeline exactly/u.test(message),
    ),
  );
  manifests.get('packages/cli').optionalDependencies['planr-pipeline'] = '1.4.2';
  manifests.get('packages/protocol').version = '2.03.0';
  assert.ok(
    validateWorkspaceManifests(rootManifest, manifests).some((message) =>
      /valid SemVer/u.test(message),
    ),
  );
  assert.ok(
    validateWorkspaceManifests(rootManifest, manifests).some((message) =>
      /pin @openplanr\/protocol exactly/u.test(message),
    ),
  );
});

test('new versions do not permit publishing private workspaces or introducing forbidden dependencies', () => {
  const rootManifest = readJson(join(root, 'package.json'));
  for (const mutate of [
    (manifests) => {
      manifests.get('packages/design').private = false;
    },
    (manifests) => {
      manifests.get('packages/protocol').dependencies = { '@openplanr/design': '1.2.0' };
    },
    (manifests) => {
      manifests.get('packages/pipeline').optionalDependencies['@openplanr/protocol'] = '2.3.0';
    },
    (manifests) => {
      manifests.get('packages/artifact').peerDependencies = { '@openplanr/design': '1.2.0' };
    },
    (manifests) => {
      manifests.get('packages/protocol').dependencies = { example: 'file:../example' };
    },
    (manifests) => {
      manifests.get('packages/protocol').dependencies = { example: 'workspace:*' };
    },
    (manifests) => {
      manifests.get('packages/cli').bundledDependencies = ['@openplanr/design'];
    },
    (manifests) => {
      manifests.get('packages/protocol').private = true;
    },
  ]) {
    const manifests = fixtureManifests();
    mutate(manifests);
    assert.notDeepEqual(validateWorkspaceManifests(rootManifest, manifests), []);
  }
});

test('Changesets versions the actual pending notes, updates exact pins, and generates readable changelogs without publishing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-release-versioning-'));
  const env = releaseFixtureEnv();
  const run = (command, args) => {
    const result = spawnSync(command, args, {
      cwd: directory,
      env,
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(
      result.status,
      0,
      `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`,
    );
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
    for (const file of readdirSync(join(root, '.changeset')).filter(
      (file) => file.endsWith('.md') || file === 'config.json',
    )) {
      writeFileSync(
        join(directory, '.changeset', file),
        readFileSync(join(root, '.changeset', file)),
      );
    }
    // This is a metadata-only version rehearsal. No installation, package
    // publication, source override, or change to the developer's tree occurs.
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
    for (const path of Object.keys(WORKSPACE_IDENTITIES)) {
      const dependencies = join(root, path, 'node_modules');
      if (existsSync(dependencies))
        symlinkSync(dependencies, join(directory, path, 'node_modules'), 'dir');
    }
    run('git', ['init', '--initial-branch=main', '--quiet']);
    run('git', ['add', 'package.json', 'packages', 'apps', '.changeset']);
    run('git', [
      '-c',
      'user.name=Release test',
      '-c',
      'user.email=release-test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '--message=Initialize disposable release fixture',
    ]);
    const cli = join(root, 'node_modules/@changesets/cli/bin.js');
    run(process.execPath, [cli, 'status', '--output', join(directory, 'release-plan.json')]);
    const planned = readJson(join(directory, 'release-plan.json'));
    const candidate = planned.releases.filter((release) => release.type !== 'none');
    if (candidate.length === 0) return; // A release branch may have consumed every changeset.
    run(process.execPath, [cli, 'version']);
    const manifests = readManifests(directory);
    assert.deepEqual(validateWorkspaceManifests(rootManifest, manifests), []);
    for (const release of candidate) {
      const path = Object.keys(WORKSPACE_IDENTITIES).find(
        (path) => WORKSPACE_IDENTITIES[path] === release.name,
      );
      assert.equal(manifests.get(path).version, release.newVersion);
      const notes = readFileSync(join(directory, path, 'CHANGELOG.md'), 'utf8');
      assert.ok(
        notes.includes(`## ${release.newVersion}`),
        `${release.name} changelog misses its released version`,
      );
      // Changesets also bumps dependents to refresh exact dependency pins.
      // Those releases have no direct change note and may have a bare heading.
      if (release.changesets.length > 0) {
        const currentNotes =
          notes.split(`## ${release.newVersion}`)[1]?.split(/\n## /u)[0].trim() ?? '';
        assert.ok(currentNotes.length > 50, `${release.name} changelog is empty`);
      }
    }
    const workflowMigration = planned.changesets.find(
      (changeset) => changeset.id === 'host-native-workflow-migration',
    );
    if (workflowMigration) {
      const cliRelease = planned.releases.find((release) => release.name === 'openplanr');
      assert.equal(cliRelease.type, 'major');
      const notes = readFileSync(join(directory, 'packages/cli/CHANGELOG.md'), 'utf8');
      assert.match(notes, /breaking CLI change/u);
      assert.match(notes, /planr spec decompose/u);
    }
    assert.deepEqual(
      readdirSync(join(directory, '.changeset')).filter(
        (file) => file.endsWith('.md') && file !== 'README.md',
      ),
      [],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a real package version operation regenerates current runtime projections without changing document contracts', {
  timeout: 120_000,
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-release-generation-'));
  const env = releaseFixtureEnv();
  const run = (command, args, cwd = directory) => {
    const result = spawnSync(command, args, {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(
      result.status,
      0,
      `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`,
    );
    return result.stdout;
  };
  try {
    // Copy current tracked source bytes, including the generator under test;
    // no private planning files, sibling checkout, or Git history is required.
    const files = run('git', ['ls-files', '-z'], root)
      .split('\0')
      .filter((path) => path && existsSync(join(root, path)));
    for (const path of files) {
      const destination = join(directory, path);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join(root, path), destination);
    }
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
    for (const path of Object.keys(WORKSPACE_IDENTITIES)) {
      const dependencies = join(root, path, 'node_modules');
      if (existsSync(dependencies))
        symlinkSync(dependencies, join(directory, path, 'node_modules'), 'dir');
    }
    run('git', ['init', '--initial-branch=main', '--quiet']);
    run('git', ['add', '.']);
    run('git', [
      '-c',
      'user.name=Release test',
      '-c',
      'user.email=release-test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '--message=Initialize disposable source fixture',
    ]);
    const contractPaths = files.filter(
      (path) =>
        path.startsWith('packages/protocol/schemas/') ||
        path === 'packages/protocol/registry/adapters.json',
    );
    const contracts = new Map(
      contractPaths.map((path) => [path, readFileSync(join(directory, path))]),
    );
    const previous = readJson(join(directory, 'packages/pipeline/package.json')).version;
    writeFileSync(
      join(directory, '.changeset/runtime-version-regression.md'),
      '---\n"openplanr": minor\n"planr-pipeline": minor\n"@openplanr/protocol": minor\n---\n\nExercise runtime release projections after a real version operation.\n',
    );
    run(process.execPath, [join(root, 'node_modules/@changesets/cli/bin.js'), 'version']);
    run(process.execPath, ['scripts/generate-all.mjs']);
    const current = readJson(join(directory, 'packages/pipeline/package.json')).version;
    assert.notEqual(current, previous);
    const ecosystem = readJson(join(directory, 'ecosystem.json'));
    assert.equal(ecosystem.components.pipeline.version, current);
    assert.equal(ecosystem.compatibility.cliOptionalPipeline.version, current);
    assert.ok(ecosystem.adapters.hosts.every(({ version }) => version === current));
    for (const [path, bytes] of contracts)
      assert.deepEqual(readFileSync(join(directory, path)), bytes, path);
    run(process.execPath, ['scripts/generate-all.mjs', '--check']);
    assert.equal(readJson(join(directory, '.changeset/config.json')).prettier, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
