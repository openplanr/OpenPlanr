import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  PACKED_WORKSPACE_DIAGRAM_GRAMMAR_COUNT,
  PACKED_WORKSPACE_GENERATED_SKILL_COUNT,
  PACKED_WORKSPACE_PROOF_KIND,
  PACKED_WORKSPACE_PROOF_SCHEMA_VERSION,
  PACKED_WORKSPACE_PROTOCOL_ASSET_COUNTS,
  PACKED_WORKSPACE_REQUIRED_CHECKS,
  assertPackedWorkspaceProof,
  packedWorkspaceProofDigest,
  parseNpmPackJson,
  readPackedWorkspaceProof,
} from '../../lib/ecosystem/packed-workspace-proof.mjs';

const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fakeDigest = (character) => `sha256:${character.repeat(64)}`;

function writeJson(path, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, bytes);
  return digest(bytes);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-packed-workspace-proof-test-'));
  const manifests = {
    root: { name: 'openplanr-workspace', private: true, version: '0.1.0' },
    cli: {
      name: 'openplanr',
      version: '1.25.3',
      optionalDependencies: { 'planr-pipeline': '0.44.0' },
    },
    pipeline: { name: 'planr-pipeline', version: '0.44.0' },
    protocol: { name: '@openplanr/protocol', version: '0.1.0' },
  };
  const manifestDigests = {
    root: writeJson(join(root, 'package.json'), manifests.root),
    cli: writeJson(join(root, 'packages/cli/package.json'), manifests.cli),
    pipeline: writeJson(join(root, 'packages/pipeline/package.json'), manifests.pipeline),
    protocol: writeJson(join(root, 'packages/protocol/package.json'), manifests.protocol),
  };
  writeJson(join(root, 'ecosystem.json'), {
    kind: 'openplanr-ecosystem',
    releaseState: 'local-snapshot',
    workspace: {
      package: manifests.root.name,
      version: manifests.root.version,
      manifestDigest: manifestDigests.root,
    },
    components: {
      protocol: { package: manifests.protocol.name, version: manifests.protocol.version, path: 'packages/protocol', manifestDigest: manifestDigests.protocol },
      cli: {
        package: manifests.cli.name,
        version: manifests.cli.version,
        path: 'packages/cli',
        manifestDigest: manifestDigests.cli,
      },
      pipeline: {
        package: manifests.pipeline.name,
        version: manifests.pipeline.version,
        path: 'packages/pipeline',
        manifestDigest: manifestDigests.pipeline,
      },
    },
    compatibility: {
      cliOptionalPipeline: {
        package: manifests.pipeline.name,
        version: manifests.pipeline.version,
        exact: true,
      },
    },
    publicCompatibility: { pipelineExportKeys: 40, pipelineRootSymbols: 229 },
  });

  const packageCustody = {
    cli: { archiveSha256: fakeDigest('a'), payloadDigest: fakeDigest('b') },
    pipeline: { archiveSha256: fakeDigest('c'), payloadDigest: fakeDigest('d') },
    protocol: { archiveSha256: fakeDigest('e'), payloadDigest: fakeDigest('f') },
  };
  const proof = {
    kind: PACKED_WORKSPACE_PROOF_KIND,
    schemaVersion: PACKED_WORKSPACE_PROOF_SCHEMA_VERSION,
    ok: true,
    checks: PACKED_WORKSPACE_REQUIRED_CHECKS.map((id) => ({ id, status: 'pass' })),
    environment: { nodeVersion: 'v22.0.0' },
    packages: {
      protocol: { name: manifests.protocol.name, version: manifests.protocol.version, ...packageCustody.protocol },
      cli: {
        name: manifests.cli.name,
        version: manifests.cli.version,
        binAliases: {
          planr: './bin/planr.js',
          openplanr: './bin/planr.js',
          opr: './bin/planr.js',
        },
        ...packageCustody.cli,
      },
      pipeline: {
        name: manifests.pipeline.name,
        version: manifests.pipeline.version,
        exportKeys: 40,
        generatedSkillPortability: {
          skills: PACKED_WORKSPACE_GENERATED_SKILL_COUNT,
          violations: 0,
        },
        protocolAssets: { ...PACKED_WORKSPACE_PROTOCOL_ASSET_COUNTS },
        ...packageCustody.pipeline,
      },
    },
    installs: {
      full: {
        protocol: { name: manifests.protocol.name, version: manifests.protocol.version, node: { status: 'passed', exports: 28, typedExports: 18, assets: 46 }, browser: { status: 'passed', exports: 24, assets: 46 }, workers: { status: 'passed', exports: 24 } },
        diagram: {
          galleryCount: PACKED_WORKSPACE_DIAGRAM_GRAMMAR_COUNT,
          renderValidation: 'passed',
          checkValidation: 'passed',
        },
        exportKeys: 40,
        rootSymbols: 229,
        retiredPipelineOperate: { absenceContracts: 80, removedPaths: 34 },
      },
      cliOnly: {
        pipelineInstalled: false,
        operateUtility: { status: 'passed' },
      },
    },
    proofDigest: null,
  };
  proof.proofDigest = packedWorkspaceProofDigest(proof);
  return { root, proof, packageCustody };
}

test('npm pack JSON parsing tolerates lifecycle output prefixes and rejects suffixes', () => {
  const report = [{ filename: 'openplanr-1.25.3.tgz' }];
  assert.deepEqual(
    parseNpmPackJson(`\n> openplanr@1.25.3 prepare\n> npm run build\n[prepare] complete\n${JSON.stringify(report)}\n`),
    report,
  );
  assert.equal(parseNpmPackJson(`${JSON.stringify(report)}\npostfix`), null);
  assert.equal(parseNpmPackJson('prepare completed without a report'), null);
});

test('missing and malformed packed-workspace proofs fail closed', () => {
  const { root } = fixture();
  try {
    assert.throws(
      () => readPackedWorkspaceProof(join(root, 'missing.json')),
      { code: 'E_PACKED_WORKSPACE_PROOF_MISSING' },
    );
    const malformed = join(root, 'malformed.json');
    writeFileSync(malformed, '{not-json');
    assert.throws(
      () => readPackedWorkspaceProof(malformed),
      { code: 'E_PACKED_WORKSPACE_PROOF_INVALID' },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the superseded 1.0 proof shape is rejected', () => {
  const { root, proof, packageCustody } = fixture();
  try {
    proof.schemaVersion = '1.0.0';
    assert.throws(
      () => assertPackedWorkspaceProof({ proof, workspaceRoot: root, packageCustody }),
      { code: 'E_PACKED_WORKSPACE_PROOF_INVALID' },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a proof from sibling package bytes cannot satisfy current workspace custody', () => {
  const { root, proof, packageCustody } = fixture();
  try {
    const siblingCustody = {
      ...packageCustody,
      pipeline: { ...packageCustody.pipeline, payloadDigest: fakeDigest('e') },
    };
    assert.throws(
      () => assertPackedWorkspaceProof({
        proof,
        workspaceRoot: root,
        packageCustody: siblingCustody,
      }),
      { code: 'E_PACKED_WORKSPACE_PROOF_CUSTODY' },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a digest-mismatched packed-workspace proof is rejected', () => {
  const { root, proof, packageCustody } = fixture();
  try {
    proof.installs.full.rootSymbols = 228;
    assert.throws(
      () => assertPackedWorkspaceProof({ proof, workspaceRoot: root, packageCustody }),
      { code: 'E_PACKED_WORKSPACE_PROOF_DIGEST' },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the packed-workspace digest binds proof identity, result, and every check', () => {
  const { root, proof } = fixture();
  try {
    const expected = proof.proofDigest;
    for (const mutate of [
      (candidate) => { candidate.kind = 'forged-proof'; },
      (candidate) => { candidate.schemaVersion = '9.9.9'; },
      (candidate) => { candidate.ok = false; },
      (candidate) => { candidate.checks[0].status = 'fail'; },
      (candidate) => { candidate.checks[0].detail = { forged: true }; },
    ]) {
      const candidate = structuredClone(proof);
      mutate(candidate);
      assert.notEqual(packedWorkspaceProofDigest(candidate), expected);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('strict proof validation rejects stale Protocol totals and generated-skill drift', () => {
  const { root, proof, packageCustody } = fixture();
  try {
    proof.packages.pipeline.generatedSkillPortability.violations = 1;
    proof.proofDigest = packedWorkspaceProofDigest(proof);
    assert.throws(
      () => assertPackedWorkspaceProof({ proof, workspaceRoot: root, packageCustody }),
      { code: 'E_PACKED_WORKSPACE_PROOF_IDENTITY' },
    );

    proof.packages.pipeline.generatedSkillPortability.violations = 0;
    proof.packages.pipeline.protocolAssets.successorSchemasV16 = 10;
    proof.proofDigest = packedWorkspaceProofDigest(proof);
    assert.throws(
      () => assertPackedWorkspaceProof({ proof, workspaceRoot: root, packageCustody }),
      { code: 'E_PACKED_WORKSPACE_PROOF_IDENTITY' },
    );

    proof.packages.pipeline.protocolAssets.successorSchemasV16 = 11;
    proof.packages.pipeline.protocolAssets.successorRegistriesV16 = 2;
    proof.proofDigest = packedWorkspaceProofDigest(proof);
    assert.throws(
      () => assertPackedWorkspaceProof({ proof, workspaceRoot: root, packageCustody }),
      { code: 'E_PACKED_WORKSPACE_PROOF_IDENTITY' },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the exact digest-bound workspace proof is accepted', () => {
  const { root, proof, packageCustody } = fixture();
  try {
    assert.deepEqual(
      assertPackedWorkspaceProof({ proof, workspaceRoot: root, packageCustody }),
      {
        proofDigest: proof.proofDigest,
        cliPayloadDigest: packageCustody.cli.payloadDigest,
        pipelinePayloadDigest: packageCustody.pipeline.payloadDigest,
        protocolPayloadDigest: packageCustody.protocol.payloadDigest,
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('Protocol proof rejects stale package bytes and absent Workers execution', () => {
  const { root, proof, packageCustody } = fixture();
  try {
    assert.throws(() => assertPackedWorkspaceProof({ proof, workspaceRoot: root, packageCustody: { ...packageCustody, protocol: { ...packageCustody.protocol, payloadDigest: fakeDigest('a') } } }), { code: 'E_PACKED_WORKSPACE_PROOF_CUSTODY' });
    delete proof.installs.full.protocol.workers;
    proof.proofDigest = packedWorkspaceProofDigest(proof);
    assert.throws(() => assertPackedWorkspaceProof({ proof, workspaceRoot: root, packageCustody }), { code: 'E_PACKED_WORKSPACE_PROOF_INSTALL' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
