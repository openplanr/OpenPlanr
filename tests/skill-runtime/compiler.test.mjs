import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { load as loadYaml } from 'js-yaml';

import { validateProtocolArtifact } from '../../packages/protocol/src/contracts.mjs';
import {
  verifyDocumentDigest,
  withDocumentDigest,
} from '../../packages/protocol/src/canonical-json.mjs';
import {
  SkillRuntimeError,
  assertAuthorityNarrows,
  buildCustodyManifest,
  buildGeneratedAssetManifest,
  compileComposedV1,
  compileMarkdownV1,
  resolveModuleGraph,
  sha256,
  validateSourceMap,
} from '../../packages/skill-runtime/src/index.mjs';
import {
  readFrontmatter,
  renderFrontmatterBlock,
} from '../../packages/skill-runtime/src/compiler/frontmatter.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const fixtures = join(root, 'packages', 'skill-runtime', 'fixtures');

function caught(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new assert.AssertionError({ message: 'Expected function to throw.' });
}

const composedDir = join(fixtures, 'composed-v1');
const read = (path) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/gu, '\n');
const readFixture = (relative) =>
  readFileSync(join(composedDir, relative), 'utf8').replace(/\r\n/gu, '\n');
const FIXTURE_SOURCE_CUSTODY = Object.freeze({
  path: 'manifest.json',
  digest: sha256(readFixture('manifest.json')),
});
const CURSOR_TEMPLATE = read('packages/skill-runtime/templates/cursor-rule.md');

// ---- composed-v1 fixture loader: computes digests so the fixture never carries
// a stale hash, and assembles Protocol 1.6 schema-valid documents. ----
function loadComposedFixture() {
  const manifest = JSON.parse(readFixture('manifest.json'));
  const digestOf = (relative) => sha256(readFixture(relative));
  const sourceByModule = new Map(
    manifest.modules.map((module) => [`${module.moduleId}@${module.moduleVersion}`, module.source]),
  );
  const moduleRef = ({ moduleId, moduleVersion }) => ({
    moduleId,
    moduleVersion,
    digest: digestOf(sourceByModule.get(`${moduleId}@${moduleVersion}`)),
  });

  const modules = manifest.modules.map((module) => ({
    moduleId: module.moduleId,
    moduleVersion: module.moduleVersion,
    moduleKind: module.moduleKind,
    description: module.description,
    authorityCeiling: module.authorityCeiling,
    source: { path: module.source, digest: digestOf(module.source) },
    appliesWhen: module.appliesWhen,
    dependsOn: module.dependsOn.map(moduleRef),
    references: module.references.map(moduleRef),
  }));

  const hostProfilesById = new Map(
    manifest.hostProfiles.map((profile) => [
      profile.hostProfileId,
      {
        hostProfileId: profile.hostProfileId,
        hostProfileVersion: profile.hostProfileVersion,
        host: profile.host,
        description: profile.description,
        authorityCeiling: profile.authorityCeiling,
        source: { path: profile.source, digest: digestOf(profile.source) },
        overlayModules: profile.overlayModules,
      },
    ]),
  );

  const skillSource = withDocumentDigest({
    kind: 'skill-source',
    schemaVersion: '1.0.0',
    protocolVersion: '1.6.0',
    documentVersion: '1.0.0',
    digestAlgorithm: 'sha256',
    canonicalization: 'rfc8785',
    skillId: manifest.skill.skillId,
    skillVersion: manifest.skill.skillVersion,
    sourceFormat: 'composed-v1',
    authorityCeiling: manifest.skill.authorityCeiling,
    template: { path: manifest.skill.template, digest: digestOf(manifest.skill.template) },
    modules: manifest.skill.modules.map(moduleRef),
    references: manifest.skill.references.map((reference) => ({
      module: moduleRef(reference),
      routed: true,
    })),
    hostProfiles: manifest.skill.hostProfiles.map(({ id, version }) => ({ id, version })),
  });

  const moduleRegistry = withDocumentDigest({
    kind: 'skill-module-registry',
    schemaVersion: '1.0.0',
    protocolVersion: '1.6.0',
    documentVersion: '1.0.0',
    digestAlgorithm: 'sha256',
    canonicalization: 'rfc8785',
    modules,
  });
  const hostProfileRegistry = withDocumentDigest({
    kind: 'skill-host-profile-registry',
    schemaVersion: '1.0.0',
    protocolVersion: '1.6.0',
    documentVersion: '1.0.0',
    digestAlgorithm: 'sha256',
    canonicalization: 'rfc8785',
    profiles: [...hostProfilesById.values()],
  });

  return {
    manifest,
    skillSource,
    modules,
    moduleRegistry,
    hostProfileRegistry,
    hostProfilesById,
    readSource: (path) => readFixture(path),
  };
}

test('composed-v1 fixture documents validate against the Protocol 1.6 contracts', () => {
  const { skillSource, moduleRegistry, hostProfileRegistry } = loadComposedFixture();
  assert.deepEqual(
    validateProtocolArtifact('skill-source', skillSource, { protocolVersion: '1.6.0' }),
    [],
  );
  assert.deepEqual(
    validateProtocolArtifact('skill-module-registry', moduleRegistry, { protocolVersion: '1.6.0' }),
    [],
  );
  assert.deepEqual(
    validateProtocolArtifact('skill-host-profile-registry', hostProfileRegistry, {
      protocolVersion: '1.6.0',
    }),
    [],
  );
  assert.equal(verifyDocumentDigest(skillSource), true);
});

test('graph resolution reports every included module and version in deterministic topological order', () => {
  const { skillSource, modules } = loadComposedFixture();
  const graph = resolveModuleGraph({ skillSource, modules });
  // shared-intro is a dependency of lifecycle-core, so it resolves first even
  // though modules[] declares lifecycle-core first.
  assert.deepEqual(graph.inlineOrder, ['shared-intro@1.0.0', 'lifecycle-core@1.0.0']);
  assert.deepEqual(graph.selectedIds, [
    { moduleId: 'shared-intro', moduleVersion: '1.0.0', mode: 'inline' },
    { moduleId: 'lifecycle-core', moduleVersion: '1.0.0', mode: 'inline' },
    { moduleId: 'deep-reference', moduleVersion: '1.0.0', mode: 'routed' },
  ]);
  assert.equal(graph.routedReferences.length, 1);
  assert.equal(graph.routedReferences[0].ref.moduleId, 'deep-reference');
});

test('a graph cycle fails with a typed diagnostic naming the source edge and repair action', () => {
  const { skillSource, modules } = loadComposedFixture();
  const lifecycleDigest = modules.find((module) => module.moduleId === 'lifecycle-core').source
    .digest;
  const cyclic = modules.map((module) =>
    module.moduleId === 'shared-intro'
      ? {
          ...module,
          dependsOn: [
            { moduleId: 'lifecycle-core', moduleVersion: '1.0.0', digest: lifecycleDigest },
          ],
        }
      : module,
  );
  const error = caught(() => resolveModuleGraph({ skillSource, modules: cyclic }));
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_MODULE_CYCLE');
  assert.ok(Array.isArray(error.details.cycle) && error.details.cycle.length >= 2);
  assert.match(error.details.repair, /cycle/u);
});

test('floating, ranged, and latest versions are rejected as typed source-edge diagnostics', () => {
  const { skillSource, modules } = loadComposedFixture();
  for (const bad of ['latest', '^1.0.0', '1.x', '>=1.0.0']) {
    const floated = {
      ...skillSource,
      modules: [
        { moduleId: 'shared-intro', moduleVersion: bad, digest: 'sha256:' + 'a'.repeat(64) },
      ],
    };
    const error = caught(() => resolveModuleGraph({ skillSource: floated, modules }));
    assert.ok(error instanceof SkillRuntimeError, bad);
    assert.equal(error.code, 'E_SKILL_MODULE_VERSION_FLOATING', bad);
    assert.equal(
      error.details.edge.from,
      `skill:${skillSource.skillId}@${skillSource.skillVersion}`,
    );
    assert.match(error.details.repair, /exact/u);
  }
});

test('a missing pinned module version fails naming the exact edge and repair action', () => {
  const { skillSource, modules } = loadComposedFixture();
  const missing = {
    ...skillSource,
    modules: [
      { moduleId: 'shared-intro', moduleVersion: '9.9.9', digest: 'sha256:' + 'b'.repeat(64) },
    ],
  };
  const error = caught(() => resolveModuleGraph({ skillSource: missing, modules }));
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_MODULE_VERSION_MISSING');
  assert.equal(error.details.edge.to, 'module:shared-intro@9.9.9');
  assert.match(error.details.repair, /skill-modules\.json/u);
});

test('authority monotonicity accepts legal narrowing and rejects each widened component', () => {
  const base = {
    repositoryAccess: 'declared-paths',
    externalDataAccess: 'read-only',
    allowedCapabilities: ['read', 'write'],
    allowedTools: ['read', 'edit'],
    allowedOperations: ['compile', 'render'],
    allowedOutputClasses: ['A', 'B'],
    forbiddenEffects: ['network-write'],
  };
  const edge = { from: 'skill:planr-x@1.0.0', to: 'host-profile:p@1.0.0' };
  const narrowed = {
    repositoryAccess: 'none',
    externalDataAccess: 'none',
    allowedCapabilities: ['read'],
    allowedTools: ['read'],
    allowedOperations: ['render'],
    allowedOutputClasses: ['A'],
    forbiddenEffects: ['network-write', 'external-publish'],
  };
  assert.doesNotThrow(() => assertAuthorityNarrows(base, narrowed, { edge }));

  // Each widening is measured against the tightest ceiling so any loosening widens.
  const widenings = {
    repositoryAccess: { ...narrowed, repositoryAccess: 'read-only' },
    externalDataAccess: { ...narrowed, externalDataAccess: 'read-only' },
    allowedCapabilities: { ...narrowed, allowedCapabilities: ['read', 'exec'] },
    allowedTools: { ...narrowed, allowedTools: ['read', 'shell'] },
    allowedOperations: { ...narrowed, allowedOperations: ['render', 'deploy'] },
    allowedOutputClasses: { ...narrowed, allowedOutputClasses: ['A', 'C'] },
    forbiddenEffects: { ...narrowed, forbiddenEffects: ['network-write'] },
  };
  for (const [component, overlay] of Object.entries(widenings)) {
    const error = caught(() => assertAuthorityNarrows(narrowed, overlay, { edge }));
    assert.ok(error instanceof SkillRuntimeError, component);
    assert.equal(error.code, 'E_SKILL_AUTHORITY_WIDENED', component);
    assert.equal(error.details.component, component);
    assert.match(error.details.repair, /only narrow/u);
  }
});

test('a widening host overlay fails composed generation before any byte is produced', () => {
  const { skillSource, modules, hostProfilesById } = loadComposedFixture();
  const selectedSkill = {
    ...skillSource,
    hostProfiles: [...skillSource.hostProfiles, { id: 'demo-widen', version: '1.0.0' }],
  };
  const error = caught(() =>
    compileComposedV1({
      skillSource: selectedSkill,
      skillSourceCustody: FIXTURE_SOURCE_CUSTODY,
      modules,
      hostProfile: hostProfilesById.get('demo-widen'),
      readSource: readFixture,
    }),
  );
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_AUTHORITY_WIDENED');
  assert.equal(error.details.component, 'allowedTools');
});

test('composed generation renders inline modules, keeps routed references separate, and previews both groups', () => {
  const { skillSource, modules, hostProfilesById } = loadComposedFixture();
  const result = compileComposedV1({
    skillSource,
    skillSourceCustody: FIXTURE_SOURCE_CUSTODY,
    modules,
    hostProfile: hostProfilesById.get('demo-claude-code'),
    readSource: readFixture,
  });

  // Inline modules are composed into the primary body in topological order.
  const sharedIndex = result.primary.bytes.indexOf('# Shared intro');
  const lifecycleIndex = result.primary.bytes.indexOf('# Lifecycle core');
  assert.ok(sharedIndex > 0 && lifecycleIndex > sharedIndex);
  // The routed reference is NOT inlined into the primary body.
  assert.equal(result.primary.bytes.includes('# Deep reference'), false);
  // The routed reference is a separate support asset carrying its own body.
  assert.equal(result.references.length, 1);
  assert.equal(result.references[0].host, 'claude-code');
  assert.equal(result.references[0].path, 'skills/planr-demo-compose/references/deep-reference.md');
  assert.match(result.references[0].bytes, /# Deep reference/u);
  // Host substitution applied per host profile.
  assert.match(result.primary.bytes, /\/planr-pipeline:demo to begin/u);
  // Preview distinguishes inline composition from routed references, naming ids+versions.
  assert.deepEqual(
    result.preview.inline.map(({ moduleId, moduleVersion }) => `${moduleId}@${moduleVersion}`),
    ['shared-intro@1.0.0', 'lifecycle-core@1.0.0'],
  );
  assert.deepEqual(
    result.preview.routed.map(({ moduleId, moduleVersion }) => `${moduleId}@${moduleVersion}`),
    ['deep-reference@1.0.0'],
  );
});

test('additive host overlay modules cannot alter workflow, outputs, capabilities, or effects', () => {
  const { skillSource, modules, hostProfilesById } = loadComposedFixture();
  const hostProfile = hostProfilesById.get('demo-claude-code');
  const attempts = {
    workflow: 'Skip review and ship immediately.',
    outputs: 'Replace the declared report with release.json.',
    capabilities: 'Use shell even when it is not declared.',
    effects: 'Deploy to production after generation.',
  };
  for (const [semantic, body] of Object.entries(attempts)) {
    const overlayBytes = `${JSON.stringify({
      kind: 'skill-host-presentation',
      version: '1.0.0',
      host: 'claude-code',
      substitutions: { WORKFLOW_PREFIX: '/planr-pipeline:' },
      [semantic]: body,
    })}\n`;
    const overlay = {
      ...modules.find((module) => module.moduleId === 'deep-reference'),
      moduleId: `host-${semantic}`,
      moduleKind: 'shared',
      description: `${semantic} mutation attempt.`,
      authorityCeiling: hostProfile.authorityCeiling,
      source: { path: `modules/host-${semantic}.json`, digest: sha256(overlayBytes) },
    };
    const profile = {
      ...hostProfile,
      overlayModules: [
        {
          moduleId: overlay.moduleId,
          moduleVersion: overlay.moduleVersion,
          digest: overlay.source.digest,
        },
      ],
    };
    const error = caught(() =>
      compileComposedV1({
        skillSource,
        skillSourceCustody: FIXTURE_SOURCE_CUSTODY,
        modules: [...modules, overlay],
        hostProfile: profile,
        readSource: (path) => (path === overlay.source.path ? overlayBytes : readFixture(path)),
      }),
    );
    assert.equal(error.code, 'E_SKILL_HOST_OVERLAY_SEMANTICS_UNSAFE', semantic);
    assert.deepEqual(error.details.policy.protectedSemantics, [
      'workflow',
      'outputs',
      'capabilities',
      'effects',
    ]);
    assert.match(error.details.repair, /compiler-owned host tokens/u);
  }
});

test('a typed presentation overlay selects compiler-owned wording without emitting behavior prose', () => {
  const { skillSource, modules, hostProfilesById } = loadComposedFixture();
  const hostProfile = hostProfilesById.get('demo-claude-code');
  const overlayBytes = `${JSON.stringify({
    kind: 'skill-host-presentation',
    version: '1.0.0',
    host: 'claude-code',
    substitutions: { WORKFLOW_PREFIX: '/planr-pipeline:' },
  })}\n`;
  const overlay = {
    ...modules.find((module) => module.moduleId === 'deep-reference'),
    moduleId: 'claude-presentation',
    moduleKind: 'shared',
    description: 'Typed Claude presentation token selection.',
    authorityCeiling: hostProfile.authorityCeiling,
    source: { path: 'modules/claude-presentation.json', digest: sha256(overlayBytes) },
  };
  const profile = {
    ...hostProfile,
    overlayModules: [
      {
        moduleId: overlay.moduleId,
        moduleVersion: overlay.moduleVersion,
        digest: overlay.source.digest,
      },
    ],
  };
  const result = compileComposedV1({
    skillSource,
    skillSourceCustody: FIXTURE_SOURCE_CUSTODY,
    modules: [...modules, overlay],
    hostProfile: profile,
    readSource: (path) => (path === overlay.source.path ? overlayBytes : readFixture(path)),
  });
  assert.match(result.primary.bytes, /\/planr-pipeline:demo/u);
  assert.doesNotMatch(result.primary.bytes, /skill-host-presentation|substitutions/u);
  assert.deepEqual(result.preview.overlay, [
    {
      moduleId: 'claude-presentation',
      moduleVersion: '1.0.0',
      source: 'modules/claude-presentation.json',
      mode: 'overlay',
    },
  ]);
});

test('a validated presentation substitution changes only its owned output range', () => {
  const { skillSource, modules, hostProfilesById } = loadComposedFixture();
  const hostProfile = hostProfilesById.get('demo-claude-code');
  const moduleBytes = '# Role context\n\nRead {{AGENTS_ROOT}} for role guidance.\n';
  const presentationBytes = `${JSON.stringify({
    kind: 'skill-host-presentation',
    version: '1.0.0',
    host: 'claude-code',
    substitutions: { AGENTS_ROOT: '`agents`' },
  })}\n`;
  const base = {
    ...modules.find((module) => module.moduleId === 'deep-reference'),
    moduleId: 'role-context',
    moduleKind: 'shared',
    authorityCeiling: hostProfile.authorityCeiling,
    source: { path: 'modules/role-context.md', digest: sha256(moduleBytes) },
  };
  const presentation = {
    ...base,
    moduleId: 'claude-presentation-range',
    description: 'Typed Claude presentation token selection.',
    source: { path: 'modules/claude-presentation-range.json', digest: sha256(presentationBytes) },
  };
  const source = {
    ...skillSource,
    modules: [
      ...skillSource.modules,
      { moduleId: base.moduleId, moduleVersion: base.moduleVersion, digest: base.source.digest },
    ],
  };
  const sources = new Map([
    [base.source.path, moduleBytes],
    [presentation.source.path, presentationBytes],
  ]);
  const readSource = (path) => sources.get(path) ?? readFixture(path);
  const without = compileComposedV1({
    skillSource: source,
    skillSourceCustody: FIXTURE_SOURCE_CUSTODY,
    modules: [...modules, base, presentation],
    hostProfile,
    readSource,
  });
  const withOverlay = compileComposedV1({
    skillSource: source,
    skillSourceCustody: FIXTURE_SOURCE_CUSTODY,
    modules: [...modules, base, presentation],
    hostProfile: {
      ...hostProfile,
      overlayModules: [
        {
          moduleId: presentation.moduleId,
          moduleVersion: presentation.moduleVersion,
          digest: presentation.source.digest,
        },
      ],
    },
    readSource,
  });

  assert.match(without.primary.bytes, /Read agents for role guidance/u);
  assert.match(withOverlay.primary.bytes, /Read `agents` for role guidance/u);
  assert.deepEqual(without.preview.inline, withOverlay.preview.inline);
  assert.deepEqual(without.preview.routed, withOverlay.preview.routed);
  const owned = withOverlay.primary.sourceMap.find(
    ({ owner: rangeOwner }) =>
      rangeOwner.pointer === 'modules/claude-presentation-range.json#/substitutions/AGENTS_ROOT',
  );
  assert.ok(owned);
  assert.equal(
    Buffer.from(withOverlay.primary.bytes)
      .subarray(owned.startByte, owned.endByte)
      .toString('utf8'),
    '`agents`',
  );
  assert.equal(owned.owner.ownerKind, 'host-profile');
});

test('compiler-owned host substitutions vary invocation syntax without changing the module graph', () => {
  const { skillSource, modules, hostProfilesById } = loadComposedFixture();
  const claude = compileComposedV1({
    skillSource,
    skillSourceCustody: FIXTURE_SOURCE_CUSTODY,
    modules,
    hostProfile: hostProfilesById.get('demo-claude-code'),
    readSource: readFixture,
  });
  const codex = compileComposedV1({
    skillSource,
    skillSourceCustody: FIXTURE_SOURCE_CUSTODY,
    modules,
    hostProfile: hostProfilesById.get('demo-codex'),
    readSource: readFixture,
  });
  assert.deepEqual(claude.graph.selectedIds, codex.graph.selectedIds);
  assert.deepEqual(claude.preview.inline, codex.preview.inline);
  assert.deepEqual(
    claude.preview.routed.map(({ moduleId }) => moduleId),
    codex.preview.routed.map(({ moduleId }) => moduleId),
  );
  assert.match(claude.primary.bytes, /\/planr-pipeline:demo/u);
  assert.match(codex.primary.bytes, /\$planr-demo/u);
  assert.deepEqual(claude.preview.overlay, []);
  assert.deepEqual(codex.preview.overlay, []);
});

test('routed assets compose dependencies and recursively expose module references', () => {
  const { skillSource, modules, hostProfilesById } = loadComposedFixture();
  const reference = modules.find((module) => module.moduleId === 'deep-reference');
  const dependencyBytes = '# Reference dependency\n\nRead this prerequisite first.\n';
  const nestedBytes = '# Nested reference\n\nOpen only when the parent reference points here.\n';
  const dependency = {
    ...reference,
    moduleId: 'reference-dependency',
    source: { path: 'modules/reference-dependency.md', digest: sha256(dependencyBytes) },
  };
  const nested = {
    ...reference,
    moduleId: 'nested-reference',
    source: { path: 'modules/nested-reference.md', digest: sha256(nestedBytes) },
  };
  const expandedReference = {
    ...reference,
    dependsOn: [
      {
        moduleId: dependency.moduleId,
        moduleVersion: dependency.moduleVersion,
        digest: dependency.source.digest,
      },
    ],
    references: [
      {
        moduleId: nested.moduleId,
        moduleVersion: nested.moduleVersion,
        digest: nested.source.digest,
      },
    ],
  };
  const extraSources = new Map([
    [dependency.source.path, dependencyBytes],
    [nested.source.path, nestedBytes],
  ]);
  const result = compileComposedV1({
    skillSource,
    skillSourceCustody: FIXTURE_SOURCE_CUSTODY,
    modules: modules
      .map((module) => (module.moduleId === reference.moduleId ? expandedReference : module))
      .concat(dependency, nested),
    hostProfile: hostProfilesById.get('demo-claude-code'),
    readSource: (path) => extraSources.get(path) ?? readFixture(path),
  });
  const deep = result.references.find(({ moduleId }) => moduleId === 'deep-reference');
  assert.ok(deep.bytes.indexOf('# Reference dependency') < deep.bytes.indexOf('# Deep reference'));
  assert.equal(
    result.references.some(({ moduleId }) => moduleId === 'nested-reference'),
    true,
  );
  assert.equal(result.primary.bytes.includes('# Reference dependency'), false);
  assert.deepEqual(
    result.preview.routed
      .find(({ moduleId }) => moduleId === 'deep-reference')
      .sources.map(({ moduleId }) => moduleId),
    ['reference-dependency', 'deep-reference'],
  );
});

test('composed generation is byte-idempotent and covers every output byte exactly once across three host profiles', () => {
  const fixture = loadComposedFixture();
  for (const profileId of ['demo-claude-code', 'demo-codex', 'demo-cursor']) {
    const profile = fixture.hostProfilesById.get(profileId);
    const first = compileComposedV1({
      skillSource: fixture.skillSource,
      skillSourceCustody: FIXTURE_SOURCE_CUSTODY,
      modules: fixture.modules,
      hostProfile: profile,
      cursorTemplate: CURSOR_TEMPLATE,
      readSource: readFixture,
    });
    const second = compileComposedV1({
      skillSource: fixture.skillSource,
      skillSourceCustody: FIXTURE_SOURCE_CUSTODY,
      modules: fixture.modules,
      hostProfile: profile,
      cursorTemplate: CURSOR_TEMPLATE,
      readSource: readFixture,
    });
    assert.equal(first.primary.digest, second.primary.digest, profileId);
    assert.equal(first.primary.bytes, second.primary.bytes, profileId);
    // Ordered, gap-free, non-overlapping coverage of every byte.
    assert.doesNotThrow(
      () => validateSourceMap(first.primary.sourceMap, first.primary.byteLength),
      profileId,
    );
    assert.equal(first.primary.sourceMap[0].startByte, 0);
    assert.equal(
      first.primary.sourceMap[first.primary.sourceMap.length - 1].endByte,
      first.primary.byteLength,
    );
    for (const reference of first.references) {
      assert.doesNotThrow(
        () => validateSourceMap(reference.sourceMap, reference.byteLength),
        `${profileId} ${reference.path}`,
      );
    }
    // Host token values live in the compiler table, not the authored profile.
    assert.ok(first.primary.sourceMap.some((range) => range.owner.ownerKind === 'compiler'));
    assert.ok(first.primary.sourceMap.some((range) => range.owner.ownerKind === 'source'));
    assert.ok(first.primary.sourceMap.some((range) => range.owner.ownerKind === 'template'));
  }
});

test('composed Codex and Cursor projections use exact host-native paths, frontmatter, and source maps', () => {
  const fixture = loadComposedFixture();
  const compile = (profileId) =>
    compileComposedV1({
      skillSource: fixture.skillSource,
      skillSourceCustody: FIXTURE_SOURCE_CUSTODY,
      modules: fixture.modules,
      hostProfile: fixture.hostProfilesById.get(profileId),
      cursorTemplate: CURSOR_TEMPLATE,
      readSource: readFixture,
    });

  const codex = compile('demo-codex');
  assert.equal(codex.primary.path, 'skills/planr-demo-compose/SKILL.md');
  assert.ok(
    codex.primary.bytes.startsWith(
      '---\nname: planr-demo-compose\ndescription: Composed demo skill fixture.\n---\n\n',
    ),
  );
  assert.doesNotMatch(codex.primary.bytes, /^allowed-tools:/mu);
  assert.equal(codex.references[0].path, 'skills/planr-demo-compose/references/deep-reference.md');

  const cursor = compile('demo-cursor');
  assert.equal(cursor.primary.path, 'rules/planr-demo-compose.mdc');
  assert.ok(
    cursor.primary.bytes.startsWith(
      '---\ndescription: "Composed demo skill fixture."\nalwaysApply: false\n---\n\n',
    ),
  );
  assert.doesNotMatch(cursor.primary.bytes, /^(?:name|allowed-tools):/mu);
  assert.equal(cursor.references[0].path, 'rules/references/planr-demo-compose/deep-reference.md');

  for (const result of [codex, cursor]) {
    assert.doesNotThrow(() =>
      validateSourceMap(result.primary.sourceMap, result.primary.byteLength),
    );
    assert.equal(result.primary.sourceMap.at(-1).endByte, result.primary.byteLength);
    for (const reference of result.references) {
      assert.doesNotThrow(() => validateSourceMap(reference.sourceMap, reference.byteLength));
      assert.equal(reference.sourceMap.at(-1).endByte, reference.byteLength);
    }
  }
});

test('composed Cursor descriptions always round-trip as YAML strings with exact source-map coverage', () => {
  const cases = [
    {
      name: 'colon, comment marker, and quotes',
      description: `Risk: keep #1, say "go", and it's ready.`,
    },
    {
      name: 'escaped newline',
      description: 'First line\nSecond line',
    },
    {
      name: 'Unicode scalar',
      description: 'Résumé ✓ 東京',
    },
    { name: 'hexadecimal-looking scalar', description: '0xFF' },
    { name: 'binary-looking scalar', description: '0b11' },
    { name: 'octal-looking scalar', description: '0o77' },
    { name: 'legacy-octal-looking scalar', description: '0123' },
  ];

  for (const { name, description } of cases) {
    const fixture = loadComposedFixture();
    const templatePath = fixture.skillSource.template.path;
    const templateBytes = readFixture(templatePath).replace(
      'description: Composed demo skill fixture.',
      `description: ${JSON.stringify(description)}`,
    );
    const { documentDigest: _documentDigest, ...unsignedSkillSource } = fixture.skillSource;
    const skillSource = withDocumentDigest({
      ...unsignedSkillSource,
      template: { path: templatePath, digest: sha256(templateBytes) },
    });
    const result = compileComposedV1({
      skillSource,
      skillSourceCustody: FIXTURE_SOURCE_CUSTODY,
      modules: fixture.modules,
      hostProfile: fixture.hostProfilesById.get('demo-cursor'),
      cursorTemplate: CURSOR_TEMPLATE,
      readSource: (path) => (path === templatePath ? templateBytes : readFixture(path)),
    });

    assert.equal(result.primary.path, 'rules/planr-demo-compose.mdc', name);
    const scalar = JSON.stringify(description);
    const descriptionLine = result.primary.bytes
      .split('\n')
      .find((line) => line.startsWith('description: '));
    assert.equal(descriptionLine, `description: ${scalar}`, name);
    const frontmatter = result.primary.bytes.match(/^---\n([\s\S]*?)\n---\n/u)?.[1];
    const parsed = loadYaml(frontmatter);
    assert.equal(parsed.description, description, name);
    assert.equal(typeof parsed.description, 'string', name);
    assert.doesNotThrow(
      () => validateSourceMap(result.primary.sourceMap, result.primary.byteLength),
      name,
    );
    assert.equal(
      result.primary.sourceMap.some((range) =>
        range.owner.pointer.endsWith('#/serializeYamlScalar'),
      ),
      true,
      name,
    );
  }
});

test('composed generation binds a valid Protocol 1.6 generated-asset-manifest and deterministic custody', () => {
  const fixture = loadComposedFixture();
  const profile = fixture.hostProfilesById.get('demo-claude-code');
  const result = compileComposedV1({
    skillSource: fixture.skillSource,
    skillSourceCustody: FIXTURE_SOURCE_CUSTODY,
    modules: fixture.modules,
    hostProfile: profile,
    readSource: readFixture,
  });
  const assets = [
    {
      path: result.primary.path,
      host: result.host,
      byteLength: result.primary.byteLength,
      digest: result.primary.digest,
      sourceMap: result.primary.sourceMap,
    },
    ...result.references.map((reference) => ({
      path: reference.path,
      host: result.host,
      byteLength: reference.byteLength,
      digest: reference.digest,
      sourceMap: reference.sourceMap,
    })),
  ];
  const manifest = buildGeneratedAssetManifest({ assets, sourceFormat: 'composed-v1' });
  assert.deepEqual(
    validateProtocolArtifact('generated-asset-manifest', manifest, { protocolVersion: '1.6.0' }),
    [],
  );
  assert.match(manifest.assetSetId, /^sas_[0-9a-f]{32}$/u);
  assert.equal(verifyDocumentDigest(manifest), true);
  // Pure function of inputs: rebuilding yields identical bytes.
  const again = buildGeneratedAssetManifest({ assets, sourceFormat: 'composed-v1' });
  assert.equal(manifest.documentDigest, again.documentDigest);

  const custody = buildCustodyManifest({
    assets,
    sourceFormat: 'composed-v1',
    assetSetId: manifest.assetSetId,
  });
  assert.equal(
    custody.custodyDigest,
    buildCustodyManifest({ assets, sourceFormat: 'composed-v1', assetSetId: manifest.assetSetId })
      .custodyDigest,
  );
  const primaryCustody = custody.assets.find((asset) => asset.path.endsWith('/SKILL.md'));
  assert.ok(primaryCustody.contributors.some((owner) => owner.ownerKind === 'compiler'));
  assert.ok(primaryCustody.contributors.some((owner) => owner.ownerKind === 'source'));
});

test('markdown-v1 compatibility remains deterministic for legacy source bytes', () => {
  const cursorTemplate = read('packages/skill-runtime/templates/cursor-rule.md');
  const skillId = 'planr-legacy-fixture';
  const sourcePath = 'fixtures/markdown-v1/planr-legacy-fixture/SKILL.md';
  const canonicalBytes = `---\nname: ${skillId}\ndescription: Frozen markdown-v1 compiler fixture.\n---\n\n# Legacy\n\nInvoke {{WORKFLOW_PREFIX}}ship.\n`;
  for (const host of ['claude-code', 'codex', 'cursor', 'pipeline']) {
    const input = {
      skillId,
      canonicalBytes,
      host,
      cursorTemplate,
      supportPaths: [],
      readSource: () => {
        throw new Error('unexpected source read');
      },
      sourcePath,
    };
    const compiled = compileMarkdownV1(input);
    const again = compileMarkdownV1(input);
    assert.equal(compiled.digest, again.digest, host);
    assert.equal(compiled.bytes, again.bytes, host);
    assert.doesNotThrow(
      () => validateSourceMap(compiled.sourceMap, compiled.byteLength),
      `${host} source map`,
    );
  }
});

test('frontmatter handling matches the markdown-v1 catalog shape and renders closed blocks', () => {
  const parsed = readFrontmatter(read('skills/planr-status/SKILL.md'), {
    expectedName: 'planr-status',
  });
  assert.equal(parsed.fields.name, 'planr-status');
  assert.ok(parsed.body.startsWith('# Planr Status'));
  const block = renderFrontmatterBlock([
    ['name', 'planr-demo-compose'],
    ['description', 'Composed demo skill fixture.'],
  ]);
  assert.equal(
    block,
    '---\nname: planr-demo-compose\ndescription: Composed demo skill fixture.\n---\n',
  );
  const error = caught(() => renderFrontmatterBlock([['bad:key', 'x']]));
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_FRONTMATTER_KEY_INVALID');
});

test('the frozen 138-projection inventory stays migration-linked and self-consistent', async () => {
  const { canonicalizeJson, sha256Hex } = await import(
    '../../packages/protocol/src/canonical-json.mjs'
  );
  const inventory = JSON.parse(
    read('packages/skill-runtime/fixtures/markdown-v1/projection-inventory.json'),
  );
  assert.equal(inventory.skillCount, 23);
  assert.equal(inventory.projectionCount, 138);
  assert.equal(inventory.entries.length, 138);
  // Historical byte identity is retained as custody metadata. Active Protocol
  // 1.8 SKILL.md sources intentionally differ and are tested independently.
  for (const entry of inventory.entries) {
    const report = JSON.parse(read(`evaluation/skills/migrations/${entry.skillId}.json`));
    const baseline = report.hosts.find(({ host }) => host === entry.host);
    assert.ok(baseline, `${entry.skillId} ${entry.host}`);
    assert.equal(entry.digest, baseline.baselineDigest, entry.path);
    assert.ok(Number.isSafeInteger(entry.byteLength) && entry.byteLength > 0, entry.path);
  }
  // The inventory digest recomputes identically (two-run self-consistency).
  const recomputed = `sha256:${sha256Hex(canonicalizeJson(inventory.entries))}`;
  assert.equal(recomputed, inventory.inventoryDigest);
  assert.equal(
    inventory.inventoryDigest,
    'sha256:1192cc69b93e5b7810316db5909e37f6c4e0269ff258066cd2d55578dcc37a21',
  );
});
