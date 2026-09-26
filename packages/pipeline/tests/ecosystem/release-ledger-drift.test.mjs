// @planr-test-group serial
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertReleaseCompatibilityClaim,
  assertReleaseLedger,
  renderCompatibilityDisplay,
} from '../../lib/ecosystem/release-ledger.mjs';
import {
  PACKED_WORKSPACE_DIAGRAM_GRAMMAR_COUNT,
  PACKED_WORKSPACE_GENERATED_SKILL_COUNT,
  PACKED_WORKSPACE_PROOF_KIND,
  PACKED_WORKSPACE_PROOF_SCHEMA_VERSION,
  PACKED_WORKSPACE_PROTOCOL_ASSET_COUNTS,
  PACKED_WORKSPACE_REQUIRED_CHECKS,
  capturePackedWorkspaceCustody,
  packedWorkspaceProofDigest,
} from '../../lib/ecosystem/packed-workspace-proof.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const bytes = (path) => readFileSync(join(root, path));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const valid = readJson('conformance/fixtures/release-ledger/ledger-valid.json');
const ledger = valid['release-ledger'];
const claims = readJson(
  'conformance/fixtures/release-ledger/compatibility-claims-valid.json',
).claimSet;

function codeOf(call) {
  try {
    call();
    return null;
  } catch (error) {
    return error.code ?? 'E_UNTYPED';
  }
}

function write(directory, path, content) {
  const target = join(directory, ...path.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function runVerifier(args, environment = {}) {
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts/verify-release-ledger.mjs'), ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', OPENPLANR_STRICT_ECOSYSTEM: '0', ...environment },
    },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runStrictPackedVerifier(args, environment = {}) {
  const result = spawnSync(
    process.execPath,
    [resolve(root, '../../scripts/verify-packed-workspace-strict.mjs'), ...args],
    {
      cwd: resolve(root, '../..'),
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', ...environment },
    },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function createPackedWorkspaceProof(workspaceRoot, custody) {
  const cli = JSON.parse(readFileSync(join(workspaceRoot, 'packages/cli/package.json'), 'utf8'));
  const pipeline = JSON.parse(
    readFileSync(join(workspaceRoot, 'packages/pipeline/package.json'), 'utf8'),
  );
  const protocol = JSON.parse(
    readFileSync(join(workspaceRoot, 'packages/protocol/package.json'), 'utf8'),
  );
  const proof = {
    kind: PACKED_WORKSPACE_PROOF_KIND,
    schemaVersion: PACKED_WORKSPACE_PROOF_SCHEMA_VERSION,
    ok: true,
    checks: PACKED_WORKSPACE_REQUIRED_CHECKS.map((id) => ({ id, status: 'pass' })),
    environment: { nodeVersion: process.version },
    packages: {
      protocol: { name: protocol.name, version: protocol.version, ...custody.protocol },
      cli: {
        name: cli.name,
        version: cli.version,
        binAliases: cli.bin,
        archiveSha256: custody.cli.archiveSha256,
        payloadDigest: custody.cli.payloadDigest,
      },
      pipeline: {
        name: pipeline.name,
        version: pipeline.version,
        exportKeys: Object.keys(pipeline.exports).length,
        generatedSkillPortability: {
          skills: PACKED_WORKSPACE_GENERATED_SKILL_COUNT,
          violations: 0,
        },
        protocolAssets: { ...PACKED_WORKSPACE_PROTOCOL_ASSET_COUNTS },
        archiveSha256: custody.pipeline.archiveSha256,
        payloadDigest: custody.pipeline.payloadDigest,
      },
    },
    installs: {
      cliOnly: {
        pipelineInstalled: false,
        operateUtility: { status: 'passed' },
      },
      full: {
        protocol: {
          name: protocol.name,
          version: protocol.version,
          node: { status: 'passed', exports: 28, typedExports: 18, assets: 46 },
          browser: { status: 'passed', exports: 24, assets: 46 },
          workers: { status: 'passed', exports: 24 },
        },
        diagram: {
          galleryCount: PACKED_WORKSPACE_DIAGRAM_GRAMMAR_COUNT,
          renderValidation: 'passed',
          checkValidation: 'passed',
        },
        exportKeys: Object.keys(pipeline.exports).length,
        rootSymbols: 229,
        retiredPipelineOperate: { absenceContracts: 80, removedPaths: 34 },
      },
    },
  };
  return { ...proof, proofDigest: packedWorkspaceProofDigest(proof) };
}

test('a version label edited without repacking is a typed refusal, not a re-rendered claim', () => {
  const claim = structuredClone(
    claims.find(({ producer }) => producer.repositoryKey === 'pipeline'),
  );
  const original = claim.display;
  claim.producer.declaredVersion = '9.9.9';
  assert.equal(
    codeOf(() => assertReleaseCompatibilityClaim(claim, { ledger })),
    'E_RELEASE_LEDGER_CLAIM_DRIFT',
  );
  assert.equal(claim.display, original, 'a refused claim is never re-rendered in place');

  const relabelled = structuredClone(ledger);
  relabelled.rows[0].declaredVersion = '9.9.9';
  assert.equal(
    codeOf(() => assertReleaseLedger(relabelled)),
    'E_RELEASE_LEDGER_DIGEST_MISMATCH',
  );
  assert.equal(
    relabelled.rows[0].payloadDigest,
    ledger.rows[0].payloadDigest,
    'the payload digest is unchanged: only the editable label moved',
  );

  const rerendered = structuredClone(claims[0]);
  rerendered.display = renderCompatibilityDisplay({
    derivation: rerendered.derivation,
    declaredVersion: '9.9.9',
  });
  assert.equal(
    codeOf(() => assertReleaseCompatibilityClaim(rerendered, { ledger })),
    'E_RELEASE_LEDGER_CLAIM_DRIFT',
  );
});

test('the workspace verifier refuses a published range the repositories do not derive', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'planr-release-ledger-drift-'));
  try {
    const manifest = structuredClone(valid['ecosystem-manifest']);
    const pipelineVersion = readJson('package.json').version;
    manifest.components.pipeline.version = pipelineVersion;
    manifest.components.cli.pipelineRange = '^9.9.9';
    for (const adapter of manifest.adapters) adapter.pipelineRange = `^${pipelineVersion}`;

    write(workspace, 'marketplace/.claude-plugin/marketplace.json', '{"plugins":[]}\n');
    write(workspace, 'marketplace/ecosystem.json', `${JSON.stringify(manifest, null, 2)}\n`);
    write(
      workspace,
      'marketplace/package.json',
      `${JSON.stringify({ name: 'openplanr-marketplace', version: manifest.components.marketplace.version })}\n`,
    );
    write(
      workspace,
      'OpenPlanr/package.json',
      `${JSON.stringify({ name: 'openplanr', version: manifest.components.cli.version })}\n`,
    );
    write(workspace, 'skills/skills/openplanr/SKILL.md', '# skill\n');
    write(
      workspace,
      'skills/package.json',
      `${JSON.stringify({ name: '@openplanr/skills', version: manifest.components.skills.version, pipelineCompatibility: `planr-pipeline@${pipelineVersion}` })}\n`,
    );
    write(workspace, 'openplanr-web/package.json', '{"name":"openplanr-web","version":"0.1.0"}\n');

    const drifted = runVerifier(['--workspace-root', workspace, '--json']);
    assert.equal(drifted.status, 1, drifted.stdout || drifted.stderr);
    const report = JSON.parse(drifted.stdout);
    assert.equal(report.ok, false);
    assert.ok(
      report.refusals.some(
        ({ code, reason }) =>
          code === 'E_RELEASE_LEDGER_MANIFEST_DRIFT' && reason.includes('^9.9.9'),
      ),
      `expected a typed manifest drift refusal, got ${JSON.stringify(report.refusals)}`,
    );

    const repaired = structuredClone(manifest);
    repaired.components.cli.pipelineRange = `^${pipelineVersion}`;
    write(workspace, 'marketplace/ecosystem.json', `${JSON.stringify(repaired, null, 2)}\n`);
    const clean = runVerifier(['--workspace-root', workspace, '--json']);
    assert.equal(clean.status, 0, clean.stdout || clean.stderr);
    const cleanReport = JSON.parse(clean.stdout);
    assert.deepEqual(cleanReport.refusals, []);
    assert.equal(cleanReport.layout, 'multi-repository');
    assert.deepEqual(cleanReport.releasePackageKeys, [
      'pipeline',
      'web',
      'cli',
      'skills',
      'marketplace',
    ]);

    const strict = runVerifier(['--workspace-root', workspace, '--strict', '--json']);
    assert.equal(strict.status, 1, strict.stdout || strict.stderr);
    assert.deepEqual(
      JSON.parse(strict.stdout)
        .unproven.filter(({ input }) => input.startsWith('payload.'))
        .map(({ repositoryKey }) => repositoryKey),
      ['pipeline', 'web', 'cli', 'skills', 'marketplace'],
      'the legacy layout retains the frozen five-repository proof boundary',
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('verification is byte-stable and mutates no committed metadata', () => {
  const watched = [
    'conformance/fixtures/release-ledger/ledger-valid.json',
    'conformance/fixtures/release-ledger/compatibility-claims-valid.json',
    'schemas/v1.3.0/release-ledger.schema.json',
  ];
  const before = watched.map((path) => sha256(bytes(path)));

  const first = runVerifier(['--json']);
  const second = runVerifier(['--json']);
  assert.equal(first.status, 0, first.stdout || first.stderr);
  assert.equal(
    first.stdout,
    second.stdout,
    'repeated verification from unchanged inputs is byte-identical',
  );

  const conformance = spawnSync(
    process.execPath,
    [join(root, 'conformance/verify-release-ledger.mjs')],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  assert.equal(conformance.status, 0, conformance.stdout || conformance.stderr);
  assert.deepEqual(
    watched.map((path) => sha256(bytes(path))),
    before,
    'verification writes nothing',
  );
});

test('the workspace verifier understands the consolidated integration manifest', () => {
  const verified = runVerifier(['--json']);
  assert.equal(verified.status, 0, verified.stdout || verified.stderr);
  const report = JSON.parse(verified.stdout);
  assert.deepEqual(report.refusals, []);
  assert.ok(
    report.projections.some(({ path }) => path === 'adapters.hosts[].version'),
    `expected the consolidated adapter-host projection, got ${JSON.stringify(report.projections)}`,
  );
  assert.ok(
    report.versionProjections.every(
      ({ repositoryKey }) => !['skills', 'marketplace'].includes(repositoryKey),
    ),
    `workspace domains are not independent package identities: ${JSON.stringify(report.versionProjections)}`,
  );
  assert.deepEqual(report.releasePackageKeys, ['pipeline', 'cli']);
  assert.deepEqual(report.catalogDomains, ['skills', 'marketplace']);
  assert.deepEqual(report.externalRepositories, ['web']);
});

test('consolidated strict verification accepts the current CLI and pipeline packed proof', () => {
  const workspaceRoot = resolve(root, '../..');
  const fixture = mkdtempSync(join(tmpdir(), 'openplanr-consolidated-ledger-proof-'));
  const npmCache = join(fixture, 'npm-cache');
  const previousCache = process.env.npm_config_cache;
  try {
    process.env.npm_config_cache = npmCache;
    const proof = createPackedWorkspaceProof(
      workspaceRoot,
      capturePackedWorkspaceCustody(workspaceRoot),
    );
    const proofPath = join(fixture, 'packed-workspace-proof.json');
    writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);

    const withoutProof = runVerifier(['--strict', '--json']);
    assert.equal(withoutProof.status, 1, withoutProof.stdout || withoutProof.stderr);
    assert.deepEqual(
      JSON.parse(withoutProof.stdout).unproven.map(({ input }) => input),
      ['payload.pipeline', 'payload.cli'],
    );

    const verified = runVerifier(['--strict', '--json', '--proof', proofPath], {
      npm_config_cache: npmCache,
    });
    assert.equal(verified.status, 0, verified.stdout || verified.stderr);
    const report = JSON.parse(verified.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.layout, 'consolidated-monorepo');
    assert.equal(report.packedProofDigest, proof.proofDigest);
    assert.deepEqual(report.refusals, []);
    assert.deepEqual(report.unproven, []);

    const strictPacked = runStrictPackedVerifier(['--proof', proofPath], {
      npm_config_cache: npmCache,
    });
    assert.equal(strictPacked.status, 0, strictPacked.stdout || strictPacked.stderr);
    const strictReport = JSON.parse(strictPacked.stdout);
    assert.equal(strictReport.ok, true);
    assert.equal(strictReport.proof.schemaVersion, PACKED_WORKSPACE_PROOF_SCHEMA_VERSION);
    assert.equal(strictReport.proof.digest, proof.proofDigest);
    assert.equal(strictReport.conformance.failures, 0);
    assert.equal(strictReport.conformance.warnings, 0);
    assert.equal(
      strictReport.conformance.checks.find(({ id }) => id === 'ledger.derivation')?.status,
      'ok',
      'the strict wrapper forwards the validated proof through ecosystem conformance to the ledger',
    );
  } finally {
    if (previousCache === undefined) delete process.env.npm_config_cache;
    else process.env.npm_config_cache = previousCache;
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('the frozen ecosystem-manifest 1.1.0 contract bytes are unchanged', () => {
  assert.equal(
    sha256(bytes('schemas/v1.1.0/ecosystem-manifest.schema.json')),
    '69288636afc2692229e59952417aef7602eb92436478e3e21a991d355584f61a',
  );
});

test('the reconciliation reaches no network, credential, git write, or publication effect', () => {
  const sources = [
    'lib/ecosystem/release-ledger.mjs',
    'scripts/verify-release-ledger.mjs',
    'conformance/verify-release-ledger.mjs',
  ];
  const forbidden = [
    'await fetch(',
    'globalThis.fetch',
    'XMLHttpRequest',
    'npm publish',
    'git push',
    'git tag',
    'git commit',
    'git add',
    'NPM_TOKEN',
    'GITHUB_TOKEN',
  ];
  const allowedSpecifiers = new Set([
    'node:assert/strict',
    'node:fs',
    'node:path',
    'node:url',
    'planr-pipeline/protocol',
  ]);
  for (const path of sources) {
    const text = bytes(path).toString('utf8');
    for (const reach of forbidden) {
      assert.ok(!text.includes(reach), `${path} must make no ${reach} reach`);
    }
    for (const [, specifier] of text.matchAll(/from\s+'([^']+)'/gu)) {
      assert.ok(
        allowedSpecifiers.has(specifier) || specifier.startsWith('.'),
        `${path} may not import ${specifier}`,
      );
    }
  }
  const ledgerSource = bytes('lib/ecosystem/release-ledger.mjs').toString('utf8');
  const specifiers = [...ledgerSource.matchAll(/from\s+'([^']+)'/gu)].map(
    ([, specifier]) => specifier,
  );
  assert.deepEqual(specifiers, ['../protocol/jcs.mjs', './release-package-proof.mjs']);
});
