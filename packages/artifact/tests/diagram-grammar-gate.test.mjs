import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { DIAGRAM_GRAMMARS, renderDiagramOutputs } from '../lib/artifact/diagram/index.mjs';

const fixtureRoot = resolve(import.meta.dirname, '..', 'fixtures', 'diagram', 'grammars');
const FIXTURE_SUFFIX = '.planr-diagram.json';

// Grammars whose fixture renders invalid, with the exact failing checks.
// Remove an entry in the change that makes that grammar render valid.
const KNOWN_FAILURES = Object.freeze({
  polar: ['semantic-coverage'],
  quadrant: ['semantic-coverage'],
  radar: ['semantic-coverage'],
  sankey: ['semantic-coverage'],
  'user-journey': ['semantic-coverage'],
  venn: ['semantic-coverage'],
  wardley: ['semantic-coverage'],
});

// Grammars drawn with generic boxes, frames and arrows instead of their own geometry.
// Remove an entry in the change that gives that grammar its own geometry.
const GENERIC_GEOMETRY = Object.freeze(
  new Set([
    ...Object.keys(KNOWN_FAILURES),
    'database-schema',
    'er-data-model',
    'fishbone',
    'gantt',
    'kanban',
    'layer-stack',
    'loop-flywheel',
    'medallion',
    'pyramid-funnel',
    'timeline',
    'treemap',
    'uml-class',
  ]),
);

// Families whose own geometry is the shared box, frame and lane layout.
const SHARED_LAYOUT_FAMILIES = Object.freeze(
  new Set(['graph', 'lanes', 'hierarchy', 'containment']),
);
const layoutFamilyOf = new Map(
  DIAGRAM_GRAMMARS.map(({ grammarId, layoutFamily }) => [grammarId, layoutFamily]),
);

const fixtureIds = readdirSync(fixtureRoot)
  .filter((name) => name.endsWith(FIXTURE_SUFFIX))
  .map((name) => name.slice(0, -FIXTURE_SUFFIX.length))
  .sort();

/** True when the scene uses only the shared graph primitives: boxes, edges, groups and lanes. */
function isGenericScene(scene) {
  return scene.kind === 'graph' && scene.axes.length === 0 && (scene.marks ?? []).length === 0;
}

function failedChecks(quality) {
  return quality.checks.filter(({ status }) => status === 'fail').map(({ id }) => id);
}

test('every registered grammar has exactly one fixture and the ratchets name only registered grammars', () => {
  const grammarIds = DIAGRAM_GRAMMARS.map(({ grammarId }) => grammarId).sort();
  assert.deepEqual(fixtureIds, grammarIds);
  for (const grammarId of [...Object.keys(KNOWN_FAILURES), ...GENERIC_GEOMETRY])
    assert.ok(grammarIds.includes(grammarId), `${grammarId} is not a registered grammar`);
});

for (const grammarId of fixtureIds) {
  test(`${grammarId} fixture renders with the expected quality and geometry`, () => {
    const document = JSON.parse(
      readFileSync(join(fixtureRoot, `${grammarId}${FIXTURE_SUFFIX}`), 'utf8'),
    );
    assert.equal(document.grammar.id, grammarId);
    const { quality, scene } = renderDiagramOutputs(document);
    if (['bar', 'line', 'scatter'].includes(grammarId)) {
      assert.equal(scene.kind, 'chart');
      assert.equal(scene.axes.length, 2);
      assert.equal(scene.boxes.length, 0);
      const markKind = { bar: 'bar', line: 'polyline', scatter: 'point' }[grammarId];
      for (const series of document.series) {
        const marks = scene.marks.filter(({ id }) => id === series.id);
        assert.equal(marks.length, grammarId === 'line' ? 1 : series.values.length);
        assert.ok(marks.every(({ kind }) => kind === markKind));
        if (grammarId === 'line') assert.equal(marks[0].points.length, series.values.length);
      }
    }
    const failed = failedChecks(quality);
    if (Object.hasOwn(KNOWN_FAILURES, grammarId)) {
      assert.equal(
        quality.status,
        'invalid',
        `${grammarId} now renders ${quality.status}; remove it from KNOWN_FAILURES`,
      );
      assert.deepEqual(failed, KNOWN_FAILURES[grammarId], `${grammarId} failing checks changed`);
    } else {
      assert.notEqual(
        quality.status,
        'invalid',
        `${grammarId} renders invalid: ${quality.checks
          .filter(({ status }) => status === 'fail')
          .map(({ id, message }) => `${id}: ${message}`)
          .join(' ')}`,
      );
    }
    if (GENERIC_GEOMETRY.has(grammarId))
      assert.ok(
        isGenericScene(scene),
        `${grammarId} now draws its own geometry; remove it from GENERIC_GEOMETRY`,
      );
    else if (!SHARED_LAYOUT_FAMILIES.has(layoutFamilyOf.get(grammarId)))
      assert.ok(
        !isGenericScene(scene),
        `${grammarId} (${layoutFamilyOf.get(grammarId)} family) regressed to generic boxes`,
      );
  });
}
