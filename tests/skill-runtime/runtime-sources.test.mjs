import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { createContext, Script } from 'node:vm';
import { renderArtifactStageRuntimeAsset } from '../../packages/artifact/scripts/generate-artifact-shell.mjs';
import { renderDesignStudioRuntimeAsset } from '../../packages/design/scripts/generate-design-studio.mjs';
import {
  assembleRuntimeSources,
  RUNTIME_SOURCE_UNIT_BYTES,
  splitRuntimeAssetSources,
  verifyRuntimeSourceUnit,
} from '../../scripts/skills/runtime-sources.mjs';

const root = resolve(import.meta.dirname, '../..');
const artifactRoot = resolve(root, 'packages/artifact');
const designRoot = resolve(root, 'packages/design');
const studio = renderDesignStudioRuntimeAsset({ projectRoot: designRoot });
const readableStage = renderArtifactStageRuntimeAsset({
  projectRoot: artifactRoot,
  compact: false,
});
const split = (asset, text, packageRoot) => {
  const { manifest, files } = splitRuntimeAssetSources({
    asset,
    text,
    packageRoot,
    repoRoot: root,
  });
  return { manifest: JSON.parse(manifest), files };
};

function assertUnits(asset, text, { manifest, files }) {
  assert.equal(manifest.asset, asset);
  assert.equal(manifest.bytes, Buffer.byteLength(text));
  const bytes = new Map(files.map(({ path, bytes: unit }) => [path, unit]));
  assert.deepEqual(
    [...bytes.keys()],
    manifest.sources.map(({ path }) => path),
  );
  assert.ok(
    assembleRuntimeSources(manifest, (path) => bytes.get(path)).equals(Buffer.from(text)),
    `${asset} reassembles byte for byte`,
  );
  for (const source of manifest.sources) {
    const unit = bytes.get(source.path);
    assert.ok(
      unit.length < RUNTIME_SOURCE_UNIT_BYTES + 1,
      `${source.path} is ${unit.length} bytes`,
    );
    assert.match(
      source.path,
      new RegExp(`^${asset.replaceAll('.', '\\.')}\\.sources/\\d{2}-[a-z0-9-]+\\.js$`, 'u'),
    );
    assert.doesNotThrow(() =>
      verifyRuntimeSourceUnit(manifest, source.path, unit.toString('utf8')),
    );
  }
}

test('Studio ships complete readable statement units that reassemble the canonical asset', () => {
  const units = split('studio.js', studio, designRoot);
  assertUnits('studio.js', studio, units);
  assert.deepEqual(
    units.manifest.scopes.map(({ id, parent }) => [id, parent]),
    [
      ['bundle', null],
      ['react-dom-client', 'bundle'],
    ],
  );
  assert.deepEqual(
    units.manifest.sources
      .filter(({ scope }) => scope === 'react-dom-client')
      .map(({ responsibility }) => responsibility.replace('react-dom-client-', '')),
    [
      'fiber-foundations',
      'reconciliation-hooks',
      'render-phases',
      'commit-effects',
      'work-loop-scheduling',
      'dom-events-properties-hydration',
      'public-roots',
    ],
  );
  const inputs = units.manifest.sources.flatMap(({ inputs: unitInputs }) => unitInputs);
  assert.ok(inputs.includes('packages/design/lib/design/ui/studio.mjs'));
  assert.ok(inputs.includes('node_modules/react-dom/cjs/react-dom-client.production.js'));
  assert.ok(inputs.every((path) => !path.startsWith('../') && !path.startsWith('/')));
  const joined = units.files.map(({ bytes }) => bytes.toString('utf8')).join('');
  for (const notice of [/@license React/u, /MIT/u])
    assert.match(joined, notice, 'inline license comments stay with their source');
  assert.deepEqual(split('studio.js', studio, designRoot), units, 'generation is deterministic');
});

test('the readable stage keeps the compact stage program and the same public behavior', () => {
  const units = split('artifact-review-stage.js', readableStage, artifactRoot);
  assertUnits('artifact-review-stage.js', readableStage, units);
  assert.deepEqual(
    units.manifest.scopes.map(({ id }) => id),
    ['bundle'],
  );
  assert.match(units.manifest.scopes[0].close, /return __toCommonJS\(stage_exports\);/u);
  for (const { bytes } of units.files)
    assert.doesNotThrow(() => new Script(bytes.toString('utf8')), 'a unit is a complete script');

  const compact = renderArtifactStageRuntimeAsset({ projectRoot: artifactRoot });
  assert.equal(
    compact,
    renderArtifactStageRuntimeAsset({ projectRoot: artifactRoot, compact: true }),
  );
  assert.ok(readableStage.length > compact.length);
  const load = (source) => {
    const context = createContext({
      queueMicrotask,
      structuredClone,
      TextEncoder,
      TextDecoder,
      URL,
    });
    new Script(source).runInContext(context);
    return new Script('OpenPlanrArtifactStage').runInContext(context);
  };
  const expected = load(compact);
  const actual = load(readableStage);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const key of Object.keys(expected))
    assert.equal(typeof actual[key], typeof expected[key], key);
  const outcome = (stage, call) => {
    try {
      return { value: JSON.parse(JSON.stringify(call(stage))) };
    } catch (error) {
      return { error: `${error.name}: ${error.message}` };
    }
  };
  const same = (call, label) =>
    assert.deepEqual(outcome(actual, call), outcome(expected, call), label);
  same((stage) => stage.ARTIFACT_STAGE_EVENTS, 'events');
  same((stage) => stage.ARTIFACT_STAGE_LIMITS, 'limits');
  const rect = { left: 10, top: 20, width: 400, height: 300 };
  for (const point of [
    { x: 10, y: 20 },
    { clientX: 210, clientY: 170 },
    { x: 999, y: -5 },
  ])
    same((stage) => stage.clientPointToNormalized(rect, point), 'client to normalized');
  same(
    (stage) => stage.normalizedPointToClient(rect, { x: 0.25, y: 0.75 }),
    'normalized to client',
  );
  same((stage) => stage.clientPointToNormalized({ ...rect, width: 0 }, { x: 1, y: 1 }), 'bounds');
  const payload = {
    artifacts: [
      { id: 'overview', title: 'Overview' },
      { id: 'detail', title: 'Detail' },
    ],
  };
  for (const actions of [
    [],
    [{ type: 'set-active', artifactId: 'detail' }],
    [{ type: 'set-active', artifactId: 'missing' }],
    [
      { type: 'set-view-mode', viewMode: 'split' },
      { type: 'set-active', artifactId: 'detail' },
    ],
    [{ type: 'unknown' }],
  ])
    same((stage) => {
      let state = stage.createArtifactStageState(payload);
      for (const action of actions) state = stage.reduceArtifactStageState(state, action);
      return { state, visible: stage.visibleArtifactIds(state) };
    }, JSON.stringify(actions));
  same((stage) => stage.createArtifactStagePayload(payload), 'payload');
});
