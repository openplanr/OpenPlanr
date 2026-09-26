import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveModuleGraph,
  SkillRuntimeError,
  sha256,
} from '../../packages/skill-runtime/src/index.mjs';

function caught(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new assert.AssertionError({ message: 'Expected function to throw.' });
}

// Component ceilings ordered widest -> narrowest so tests can compose graphs.
const CEILING = {
  root: {
    repositoryAccess: 'declared-paths',
    externalDataAccess: 'read-only',
    allowedCapabilities: ['read', 'write'],
    allowedTools: ['read', 'edit'],
    allowedOperations: ['compile', 'render'],
    allowedOutputClasses: ['A', 'B'],
    forbiddenEffects: ['network-write'],
  },
  mid: {
    repositoryAccess: 'read-only',
    externalDataAccess: 'read-only',
    allowedCapabilities: ['read', 'write'],
    allowedTools: ['read', 'edit'],
    allowedOperations: ['compile', 'render'],
    allowedOutputClasses: ['A', 'B'],
    forbiddenEffects: ['network-write'],
  },
  narrow: {
    repositoryAccess: 'read-only',
    externalDataAccess: 'none',
    allowedCapabilities: ['read'],
    allowedTools: ['read'],
    allowedOperations: ['render'],
    allowedOutputClasses: ['A'],
    forbiddenEffects: ['network-write', 'external-publish'],
  },
};

const digestFor = (id) => sha256(`# ${id}\n`);

function module(id, ceiling, { dependsOn = [], references = [] } = {}) {
  return {
    moduleId: id,
    moduleVersion: '1.0.0',
    moduleKind: 'shared',
    description: `${id} module`,
    authorityCeiling: ceiling,
    source: { path: `modules/${id}.md`, digest: digestFor(id) },
    appliesWhen: 'always',
    dependsOn: dependsOn.map((dep) => ({
      moduleId: dep,
      moduleVersion: '1.0.0',
      digest: digestFor(dep),
    })),
    references: references.map((reference) => ({
      moduleId: reference,
      moduleVersion: '1.0.0',
      digest: digestFor(reference),
    })),
  };
}

function skill({ modules = [], references = [] } = {}) {
  return {
    skillId: 'planr-graph',
    skillVersion: '1.0.0',
    sourceFormat: 'composed-v1',
    authorityCeiling: CEILING.root,
    modules: modules.map((id) => ({ moduleId: id, moduleVersion: '1.0.0', digest: digestFor(id) })),
    references: references.map((id) => ({
      module: { moduleId: id, moduleVersion: '1.0.0', digest: digestFor(id) },
      routed: true,
    })),
  };
}

function hostProfile(overlayIds = [], ceiling = CEILING.narrow) {
  return {
    hostProfileId: 'graph-host',
    hostProfileVersion: '1.0.0',
    host: 'claude-code',
    description: 'graph host',
    authorityCeiling: ceiling,
    source: { path: 'profiles/host.md', digest: digestFor('host') },
    overlayModules: overlayIds.map((id) => ({
      moduleId: id,
      moduleVersion: '1.0.0',
      digest: digestFor(id),
    })),
  };
}

test('a routed reference pointing at an unregistered moduleId@version names the exact edge', () => {
  const modules = [module('present', CEILING.narrow)];
  const skillSource = skill({ references: ['absent'] });
  const error = caught(() => resolveModuleGraph({ skillSource, modules }));
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_MODULE_VERSION_MISSING');
  assert.equal(error.details.edge.field, 'references');
  assert.equal(error.details.edge.to, 'module:absent@1.0.0');
  assert.equal(error.details.edge.from, 'skill:planr-graph@1.0.0');
});

test('a host profile overlay module absent from the registry names the exact host-profile edge', () => {
  const modules = [module('present', CEILING.narrow)];
  const skillSource = skill({ modules: ['present'] });
  const error = caught(() =>
    resolveModuleGraph({ skillSource, modules, hostProfile: hostProfile(['missing-overlay']) }),
  );
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_MODULE_VERSION_MISSING');
  assert.equal(error.details.edge.field, 'overlayModules');
  assert.equal(error.details.edge.to, 'module:missing-overlay@1.0.0');
  assert.equal(error.details.edge.from, 'host-profile:graph-host@1.0.0');
});

test('a cycle reachable only through a routed reference dependsOn chain is detected', () => {
  // The routed reference r-a depends on r-b, which depends back on r-a. No inline
  // seed reaches this cycle, so it is only found because routed references have
  // their own dependsOn graph resolved.
  const modules = [
    module('r-a', CEILING.narrow, { dependsOn: ['r-b'] }),
    module('r-b', CEILING.narrow, { dependsOn: ['r-a'] }),
  ];
  const skillSource = skill({ references: ['r-a'] });
  const error = caught(() => resolveModuleGraph({ skillSource, modules }));
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_MODULE_CYCLE');
  assert.ok(Array.isArray(error.details.cycle) && error.details.cycle.length >= 2);
});

test('module references start routed groups whose dependency closure renders in topological order', () => {
  const modules = [
    module('inline', CEILING.mid, { references: ['reference-root'] }),
    module('reference-root', CEILING.narrow, {
      dependsOn: ['reference-dependency'],
      references: ['nested-reference'],
    }),
    module('reference-dependency', CEILING.narrow),
    module('nested-reference', CEILING.narrow),
  ];
  const graph = resolveModuleGraph({ skillSource: skill({ modules: ['inline'] }), modules });
  assert.deepEqual(graph.inlineOrder, ['inline@1.0.0']);
  assert.deepEqual(
    graph.routedReferences.map(({ ref }) => ref.moduleId),
    ['nested-reference', 'reference-root'],
  );
  const routed = graph.routedReferences.find(({ ref }) => ref.moduleId === 'reference-root');
  assert.deepEqual(
    routed.modules.map(({ ref }) => ref.moduleId),
    ['reference-dependency', 'reference-root'],
  );
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.from === 'module:inline@1.0.0' &&
        edge.to === 'module:reference-root@1.0.0' &&
        edge.field === 'references',
    ),
  );
});

test('a cycle crossing dependsOn and module references is detected', () => {
  const modules = [
    module('inline', CEILING.mid, { references: ['reference'] }),
    module('reference', CEILING.narrow, { dependsOn: ['inline'] }),
  ];
  const error = caught(() =>
    resolveModuleGraph({ skillSource: skill({ modules: ['inline'] }), modules }),
  );
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_MODULE_CYCLE');
  assert.match(error.message, /inline@1\.0\.0/u);
  assert.match(error.message, /reference@1\.0\.0/u);
});

test('edge-wise authority also applies to module references', () => {
  const modules = [
    module('parent', CEILING.narrow, { references: ['wider-reference'] }),
    module('wider-reference', CEILING.mid),
  ];
  const error = caught(() =>
    resolveModuleGraph({ skillSource: skill({ modules: ['parent'] }), modules }),
  );
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_AUTHORITY_WIDENED');
  assert.equal(error.details.edge.from, 'module:parent@1.0.0');
  assert.equal(error.details.edge.to, 'module:wider-reference@1.0.0');
  assert.equal(error.details.edge.field, 'references');
});

test('edge-wise authority: a dependsOn child wider than its actual parent (yet narrower than root) fails', () => {
  // parent (narrow) depends on child (mid). mid is narrower than root but WIDER
  // than the parent that actually includes it. The old root-only check passed this;
  // the edge-wise check must fail, naming the real parent->child edge.
  const modules = [
    module('parent', CEILING.narrow, { dependsOn: ['child'] }),
    module('child', CEILING.mid),
  ];
  const skillSource = skill({ modules: ['parent'] });
  const error = caught(() => resolveModuleGraph({ skillSource, modules }));
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_AUTHORITY_WIDENED');
  assert.equal(error.details.edge.from, 'module:parent@1.0.0');
  assert.equal(error.details.edge.to, 'module:child@1.0.0');
  assert.equal(error.details.edge.field, 'dependsOn');
});

test('a dependsOn child that genuinely narrows relative to its parent resolves cleanly', () => {
  const modules = [
    module('parent', CEILING.mid, { dependsOn: ['child'] }),
    module('child', CEILING.narrow),
  ];
  const skillSource = skill({ modules: ['parent'] });
  assert.doesNotThrow(() => resolveModuleGraph({ skillSource, modules }));
});

test('an overlay module wider than its owning host profile still fails on the profile edge', () => {
  // Overlay narrows relative to root but WIDENS relative to the host profile that
  // owns it. The check must measure against the profile, not the root skill.
  const modules = [module('base', CEILING.narrow), module('overlay-wide', CEILING.mid)];
  const skillSource = skill({ modules: ['base'] });
  const profile = hostProfile(['overlay-wide'], CEILING.narrow);
  const error = caught(() => resolveModuleGraph({ skillSource, modules, hostProfile: profile }));
  assert.ok(error instanceof SkillRuntimeError);
  assert.equal(error.code, 'E_SKILL_AUTHORITY_WIDENED');
  assert.equal(error.details.edge.from, 'host-profile:graph-host@1.0.0');
  assert.equal(error.details.edge.to, 'module:overlay-wide@1.0.0');
  assert.equal(error.details.edge.field, 'overlayModules');
});

test('a structurally typed presentation overlay resolves and remains separate', () => {
  const modules = [module('base', CEILING.narrow), module('overlay-ok', CEILING.narrow)];
  const skillSource = skill({ modules: ['base'] });
  modules[1] = {
    ...modules[1],
    authorityCeiling: CEILING.mid,
    source: { ...modules[1].source, path: 'modules/overlay-ok.json' },
  };
  const graph = resolveModuleGraph({
    skillSource,
    modules,
    hostProfile: hostProfile(['overlay-ok'], CEILING.mid),
  });
  assert.deepEqual(
    graph.overlayModules.map(({ ref }) => `${ref.moduleId}@${ref.moduleVersion}`),
    ['overlay-ok@1.0.0'],
  );
  assert.deepEqual(graph.inlineOrder, ['base@1.0.0']);
});
