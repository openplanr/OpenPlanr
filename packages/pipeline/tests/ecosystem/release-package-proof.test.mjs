// @planr-test-group serial
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  bindPackageProofToEcosystemCandidate,
  createEcosystemCandidateProof,
  createInstalledExportProbePlan,
  inventoryGitRepository,
  RELEASE_REPOSITORY_KEYS,
  REQUIRED_RELEASE_DOCUMENTS,
  releaseProofDigests,
  verifyExportTargets,
  verifyPackagedDocumentation,
} from '../../lib/ecosystem/release-package-proof.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function write(rootDirectory, path, content = '') {
  const target = join(rootDirectory, ...path.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function git(rootDirectory, args) {
  const result = spawnSync('git', ['-C', rootDirectory, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test('export proof resolves every literal condition and wildcard to archive bytes', () => {
  const results = verifyExportTargets({
    exportsField: {
      '.': { types: './lib/index.d.mts', import: './lib/index.mjs' },
      './schemas/*': './schemas/*',
    },
    archiveFiles: [
      'lib/index.d.mts',
      'lib/index.mjs',
      'schemas/v1/example.schema.json',
      'schemas/v2/example.schema.json',
    ],
  });

  assert.equal(results.length, 3);
  assert.deepEqual(results.find(({ subpath }) => subpath === './schemas/*').matches, [
    'schemas/v1/example.schema.json',
    'schemas/v2/example.schema.json',
  ]);
  assert.throws(
    () =>
      verifyExportTargets({
        exportsField: { './missing': './lib/missing.mjs' },
        archiveFiles: ['lib/index.mjs'],
      }),
    { code: 'E_RELEASE_PACKAGE_PROOF' },
  );
});

test('installed export probe plan expands wildcard JSON and separates type-only targets', () => {
  const probes = createInstalledExportProbePlan({
    packageName: 'fixture-package',
    exportsField: {
      '.': {
        types: './lib/index.d.mts',
        import: './lib/index.mjs',
        default: './lib/index.mjs',
      },
      './schemas/*': './schemas/*',
      './editor.css': './lib/editor.css',
    },
    archiveFiles: [
      'lib/index.d.mts',
      'lib/index.mjs',
      'lib/editor.css',
      'schemas/v1/one.schema.json',
      'schemas/v2/two.schema.json',
    ],
  });

  assert.equal(probes.length, 6);
  assert.deepEqual(
    probes.filter(({ kind }) => kind === 'json').map(({ specifier }) => specifier),
    ['fixture-package/schemas/v1/one.schema.json', 'fixture-package/schemas/v2/two.schema.json'],
  );
  assert.equal(probes.filter(({ kind }) => kind === 'type-only').length, 1);
  assert.equal(probes.filter(({ kind }) => kind === 'import').length, 2);
  assert.deepEqual(
    probes.filter(({ kind }) => kind === 'css').map(({ specifier }) => specifier),
    ['fixture-package/editor.css'],
  );
});

test('packaged documentation accepts archive-local paths and stable HTTPS URLs only', () => {
  const packageRoot = mkdtempSync(join(tmpdir(), 'planr-package-docs-'));
  for (const path of REQUIRED_RELEASE_DOCUMENTS) write(packageRoot, path, '# Document\n');
  write(packageRoot, 'docs/guide.md', '# Guide\n');
  write(
    packageRoot,
    'README.md',
    '[Guide](docs/guide.md) [Protocol directory](docs/protocol/) [Public](https://openplanr.dev)\n',
  );
  const archiveFiles = [...REQUIRED_RELEASE_DOCUMENTS, 'docs/guide.md'];

  const results = verifyPackagedDocumentation({ packageRoot, archiveFiles });
  assert.equal(results.length, 3);

  write(packageRoot, 'README.md', '[Missing](docs/not-packed.md)\n');
  assert.throws(() => verifyPackagedDocumentation({ packageRoot, archiveFiles }), {
    code: 'E_RELEASE_PACKAGE_PROOF',
  });

  write(packageRoot, 'README.md', '[Insecure](http://openplanr.dev/docs)\n');
  assert.throws(() => verifyPackagedDocumentation({ packageRoot, archiveFiles }), {
    code: 'E_RELEASE_PACKAGE_PROOF',
  });
});

test('coordinated candidate proof requires exactly the five repository custody keys', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'planr-five-repository-proof-'));
  const repositories = Object.fromEntries(
    RELEASE_REPOSITORY_KEYS.map((key) => {
      const path = join(workspace, key);
      mkdirSync(path, { recursive: true });
      return [key, { path, label: key }];
    }),
  );
  const inventoryRepository = ({ key, label }) => ({
    key,
    label,
    baseline: `baseline-${key}`,
    fileCount: 1,
    inventory: [{ path: 'package.json', mode: 0o644, size: 2, contentDigest: `sha256:${key}` }],
    inventoryDigest: `sha256:inventory-${key}`,
  });

  const first = createEcosystemCandidateProof({ repositories, inventoryRepository });
  const second = createEcosystemCandidateProof({ repositories, inventoryRepository });
  assert.deepEqual(first.repositoryKeys, ['pipeline', 'web', 'cli', 'skills', 'marketplace']);
  assert.equal(first.repositories.length, 5);
  assert.equal(first.candidateDigest, second.candidateDigest);

  const incomplete = { ...repositories, web: null };
  assert.throws(
    () => createEcosystemCandidateProof({ repositories: incomplete, inventoryRepository }),
    { code: 'E_RELEASE_PACKAGE_PROOF' },
  );

  const aliased = {
    ...repositories,
    web: { ...repositories.web, path: repositories.pipeline.path },
  };
  assert.throws(
    () => createEcosystemCandidateProof({ repositories: aliased, inventoryRepository }),
    { code: 'E_RELEASE_PACKAGE_PROOF' },
  );
});

test('dirty repository identity is deterministic, deletion-aware, and sensitive to working bytes', () => {
  const repository = mkdtempSync(join(tmpdir(), 'planr-dirty-candidate-'));
  try {
    git(repository, ['init', '-q']);
    git(repository, ['config', 'user.name', 'Planr Test']);
    git(repository, ['config', 'user.email', 'planr-test@example.invalid']);
    write(repository, 'package.json', '{"name":"fixture"}\n');
    write(repository, 'deleted.txt', 'delete me\n');
    git(repository, ['add', '.']);
    git(repository, ['commit', '--no-gpg-sign', '-qm', 'fixture baseline']);

    write(repository, 'package.json', '{"name":"fixture","dirty":1}\n');
    unlinkSync(join(repository, 'deleted.txt'));
    write(repository, 'untracked.txt', 'first working bytes\n');

    const first = inventoryGitRepository({ key: 'fixture', label: 'fixture', root: repository });
    const replay = inventoryGitRepository({ key: 'fixture', label: 'fixture', root: repository });
    assert.equal(first.dirty, true);
    assert.equal(first.snapshotDigest, replay.snapshotDigest);
    assert.equal(first.inventory.find(({ path }) => path === 'deleted.txt').kind, 'deletion');
    assert.equal(
      first.inventory.find(({ path }) => path === 'untracked.txt').kind,
      'untracked-file',
    );
    assert.throws(
      () =>
        inventoryGitRepository({
          key: 'fixture',
          label: 'fixture',
          root: repository,
          requireClean: true,
        }),
      { code: 'E_RELEASE_PACKAGE_PROOF' },
    );

    write(repository, 'untracked.txt', 'second working bytes\n');
    const changed = inventoryGitRepository({ key: 'fixture', label: 'fixture', root: repository });
    assert.notEqual(changed.snapshotDigest, first.snapshotDigest);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test('five-repository proof rejects bytes that drift between custody passes', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'planr-drifting-candidate-'));
  try {
    const repositories = Object.fromEntries(
      RELEASE_REPOSITORY_KEYS.map((key) => {
        const path = join(workspace, key);
        mkdirSync(path, { recursive: true });
        return [key, { path, label: key }];
      }),
    );
    let call = 0;
    const driftingInventory = ({ key, label }) => {
      const pass = Math.floor(call / RELEASE_REPOSITORY_KEYS.length);
      call += 1;
      const identity = { key, label, baseline: 'baseline', nonce: key === 'pipeline' ? pass : 0 };
      return { ...identity, snapshotDigest: JSON.stringify(identity) };
    };

    assert.throws(
      () =>
        createEcosystemCandidateProof({
          repositories,
          inventoryRepository: driftingInventory,
        }),
      { code: 'E_RELEASE_PACKAGE_PROOF' },
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('package source inventory is digest-bound to the coordinated pipeline candidate', () => {
  const sourceInventory = [
    {
      path: 'lib/index.mjs',
      mode: 0o644,
      size: 5,
      contentDigest: `sha256:${'a'.repeat(64)}`,
    },
  ];
  const packageProof = { sourceInventory, sourceDigest: sha256Jcs(sourceInventory) };
  const ecosystemProof = {
    candidateDigest: `sha256:${'b'.repeat(64)}`,
    repositories: [
      {
        key: 'pipeline',
        inventory: [{ ...sourceInventory[0], kind: 'tracked-file', tracked: true }],
      },
    ],
  };

  const binding = bindPackageProofToEcosystemCandidate({ packageProof, ecosystemProof });
  assert.equal(binding.packageSourceDigest, packageProof.sourceDigest);
  assert.equal(binding.candidateDigest, ecosystemProof.candidateDigest);

  ecosystemProof.repositories[0].inventory[0].contentDigest = `sha256:${'c'.repeat(64)}`;
  assert.throws(() => bindPackageProofToEcosystemCandidate({ packageProof, ecosystemProof }), {
    code: 'E_RELEASE_PACKAGE_PROOF',
  });
});

test('the proof exposes the per-repository digests a release ledger binds', () => {
  const exports = [
    { subpath: '.', conditions: ['import'], target: 'lib/index.mjs', matches: ['lib/index.mjs'] },
  ];
  const ecosystemProof = {
    candidateDigest: `sha256:${'b'.repeat(64)}`,
    repositories: [
      {
        key: 'pipeline',
        baseline: 'a'.repeat(40),
        dirty: false,
        fileCount: 1,
        inventoryDigest: `sha256:${'c'.repeat(64)}`,
        snapshotDigest: `sha256:${'d'.repeat(64)}`,
      },
    ],
  };
  const packageProof = {
    package: { name: 'planr-pipeline', version: '0.42.0' },
    archive: { digest: `sha256:${'e'.repeat(64)}` },
    sourceDigest: `sha256:${'f'.repeat(64)}`,
    exports,
  };

  const surface = releaseProofDigests({ ecosystemProof, packageProof });
  assert.deepEqual(
    surface.repositories.map(({ key }) => key),
    [...RELEASE_REPOSITORY_KEYS],
  );
  assert.equal(
    surface.repositories.find(({ key }) => key === 'pipeline').inventoryDigest,
    ecosystemProof.repositories[0].inventoryDigest,
  );
  assert.equal(surface.repositories.find(({ key }) => key === 'web').present, false);
  assert.equal(surface.payload.payloadDigest, packageProof.archive.digest);
  assert.equal(surface.payload.exportSurfaceDigest, sha256Jcs(exports));
  assert.equal(releaseProofDigests({ ecosystemProof }).payload, null);
  assert.throws(() => releaseProofDigests({ ecosystemProof: {} }), {
    code: 'E_RELEASE_PACKAGE_PROOF',
  });
});

test('real pipeline archive is deterministic and byte-equal to its source inventory', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-release-package.mjs', '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const proof = JSON.parse(result.stdout);

  assert.equal(proof.ok, true);
  assert.equal(proof.package.archive.deterministicRepack, true);
  assert.equal(proof.package.archive.symlinkCount, 0);
  assert.equal(proof.package.sourceDigest, proof.package.payloadDigest);
  assert.equal(
    proof.package.package.version,
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  );
  assert.ok(proof.package.exports.length > 0);
  assert.equal(proof.package.installedExports.count, proof.package.installedExports.results.length);
  assert.ok(proof.package.installedExports.runtime > 0);
  assert.ok(proof.package.installedExports.typeOnly > 0);
  assert.ok(proof.package.installedExports.json > 0);
  assert.ok(
    proof.package.installedExports.results.every(({ status }) =>
      ['loaded', 'validated'].includes(status),
    ),
  );
  assert.ok(
    proof.package.sourceInventory.some(({ path }) => path === 'scripts/verify-release-package.mjs'),
  );
  assert.doesNotMatch(result.stdout, /(?:\/Users\/|[A-Z]:\\Users\\)/u);
});

test('root-only CI and release gates use authoritative workspace package proofs', () => {
  const workspaceRoot = resolve(root, '../..');
  for (const [path, proofCommand] of [
    ['.github/workflows/ci.yml', /npm run verify:packed:strict/u],
    ['.github/workflows/release-proof.yml', /npm run verify/u],
  ]) {
    const workflow = readFileSync(join(workspaceRoot, path), 'utf8');
    assert.match(workflow, proofCommand, path);
    assert.doesNotMatch(workflow, /npm pack --dry-run/u, path);
    assert.doesNotMatch(workflow, /npm publish/u, path);
  }
});
