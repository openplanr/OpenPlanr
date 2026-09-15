import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { validateProtocolArtifact } from '../../packages/protocol/src/contracts.mjs';
import { SEMVER_REGEX } from '../../packages/protocol/src/semver.mjs';

const fixtures = join(import.meta.dirname, 'fixtures', 'skill-source');
const load = (name) => JSON.parse(readFileSync(join(fixtures, name), 'utf8'));
const V16 = '1.6.0';
const withCeiling = (source, patch) => ({ ...source, authorityCeiling: { ...source.authorityCeiling, ...patch } });

const root = join(import.meta.dirname, '..', '..');
const commandCatalog = JSON.parse(readFileSync(join(root, 'packages', 'protocol', 'registries', 'commands.json'), 'utf8'));
const utilityCommandCatalog = JSON.parse(
  readFileSync(join(root, 'docs', 'generated', 'utility-command-catalog.json'), 'utf8'),
);
const commonSchema = JSON.parse(readFileSync(join(root, 'packages', 'protocol', 'schemas', 'v1.6.0', 'common.schema.json'), 'utf8'));

function canonicalSkillInvocations() {
  const skillRoot = join(root, 'skills');
  return readdirSync(skillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('planr-'))
    .flatMap((entry) => {
      const path = join(skillRoot, entry.name, 'SKILL.md');
      const source = readFileSync(path, 'utf8');
      return [...source.matchAll(/\bplanr\s+([a-z][a-z0-9-]*)\b/gu)].map((match) => ({ path, verb: match[1] }));
    });
}

test('the shared exact-SemVer grammar rejects malformed versions and accepts legitimate ones', () => {
  for (const good of ['1.0.0', '1.6.0', '0.1.0', '1.0.0-alpha.1', '1.0.0-alpha.1+build.5']) {
    assert.ok(SEMVER_REGEX.test(good), good);
  }
  for (const bad of ['1.0.0-alpha..1', '1.0.0-', '01.0.0', '1.0.0+', '1.0.0-01']) {
    assert.ok(!SEMVER_REGEX.test(bad), bad);
  }
});

test('the skill-source schema rejects a non-SemVer version and accepts a valid one', () => {
  const source = load('skill-source-composed.json');
  assert.deepEqual(validateProtocolArtifact('skill-source', { ...source, skillVersion: '1.0.0' }, { protocolVersion: V16 }), []);
  for (const bad of ['1.0.0-alpha..1', '01.0.0', '1.0.0+']) {
    assert.ok(
      validateProtocolArtifact('skill-source', { ...source, skillVersion: bad }, { protocolVersion: V16 }).length > 0,
      bad,
    );
  }
});

test('the authority ceiling accepts every capability, tool, and operation already in use', () => {
  const source = load('skill-source-composed.json');
  const inUse = withCeiling(source, {
    allowedCapabilities: ['read', 'write', 'context-gathering', 'planning-write', 'read-only-view'],
    allowedTools: ['read', 'edit', 'shell', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash(git log:*)'],
    allowedOperations: ['compile', 'render', 'plan', 'status'],
  });
  assert.deepEqual(validateProtocolArtifact('skill-source', inUse, { protocolVersion: V16 }), []);
});

test('the historical operation authority remains closed while current skill utilities are registered', () => {
  const rootVerbs = commandCatalog.commands
    .filter(({ surface }) => surface === 'cli-root')
    .map(({ argv }) => argv[0])
    .sort((left, right) => left.localeCompare(right));
  const authorityVerbs = commonSchema.$defs.operationAuthority.enum;

  assert.equal(rootVerbs.length, commandCatalog.inventory.rootCommandModules);
  assert.deepEqual(authorityVerbs, [...new Set([...rootVerbs, 'compile', 'render'])].sort((left, right) => left.localeCompare(right)));

  const source = load('skill-source-composed.json');
  const invocations = canonicalSkillInvocations();
  const currentUtilityRoots = new Set(
    utilityCommandCatalog.active.map(({ path }) => path.split(' ')[0]),
  );
  assert.ok(invocations.length > 0);
  for (const { path, verb } of invocations) {
    assert.ok(currentUtilityRoots.has(verb), `${path} invokes unregistered utility command ${verb}`);
    if (rootVerbs.includes(verb)) {
      assert.deepEqual(
        validateProtocolArtifact('skill-source', withCeiling(source, { allowedOperations: [verb] }), { protocolVersion: V16 }),
        [],
        `${path} invokes historical operation ${verb}, which the Protocol 1.6 vocabulary cannot represent`,
      );
    }
  }
});

test('the authority ceiling rejects invented capabilities, tools, and operations', () => {
  const source = load('skill-source-composed.json');
  const rejections = [
    { allowedCapabilities: ['make-coffee'] },
    { allowedCapabilities: ['quantum-flux'] },
    { allowedTools: ['Bogus(anything)'] },
    { allowedTools: ['teleport'] },
    { allowedTools: ['Bash()'] },
    { allowedOperations: ['make-coffee'] },
  ];
  for (const patch of rejections) {
    assert.ok(
      validateProtocolArtifact('skill-source', withCeiling(source, patch), { protocolVersion: V16 }).length > 0,
      JSON.stringify(patch),
    );
  }
});

test('the host enum admits the pipeline projection target', () => {
  const registry = {
    kind: 'skill-host-profile-registry', schemaVersion: '1.0.0', protocolVersion: V16, documentVersion: '1.0.0',
    digestAlgorithm: 'sha256', canonicalization: 'rfc8785', documentDigest: `sha256:${'a'.repeat(64)}`,
    profiles: [{
      hostProfileId: 'pipeline-default', hostProfileVersion: '1.0.0', host: 'pipeline',
      description: 'Pipeline projection profile.',
      authorityCeiling: {
        repositoryAccess: 'read-only', externalDataAccess: 'none', allowedCapabilities: ['read'],
        allowedTools: ['read'], allowedOperations: ['render'], allowedOutputClasses: ['A'], forbiddenEffects: ['network-write'],
      },
      source: { path: 'packages/protocol/host-profiles/pipeline.md', digest: `sha256:${'b'.repeat(64)}` },
      overlayModules: [],
    }],
  };
  assert.deepEqual(
    validateProtocolArtifact('skill-host-profile-registry', registry, { protocolVersion: V16 }).filter(({ rule }) => rule !== 'semantic'),
    [],
  );
});
