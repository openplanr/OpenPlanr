import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { previewLegacyDiagramDocument } from '../lib/artifact/diagram/authoring/migration.mjs';
import {
  createDiagramDocument,
  exportDiagramExcalidraw,
  layoutDiagram,
  renderDiagramOutputs,
} from '../lib/artifact/diagram/index.mjs';
import { createRenderQualityReport } from '../lib/artifact/diagram/rendering/reports.mjs';

function chart(kind, changes = {}) {
  const base = JSON.parse(
    readFileSync(
      new URL(`../fixtures/diagram/grammars/${kind}.planr-diagram.json`, import.meta.url),
    ),
  );
  const input = { ...base, ...changes };
  return createDiagramDocument({
    ...input,
    accessibility: {
      ...input.accessibility,
      readingOrder: [...input.nodes, ...input.series].map(({ id }) => id),
    },
  });
}
const series = (values, id = 'series-main') => ({
  id,
  label: id,
  values: values.map(([key, value]) => ({ key, value })),
});
const coverage = (quality) => quality.checks.find(({ id }) => id === 'semantic-coverage');
const report = (document, scene) =>
  createRenderQualityReport(document, {
    scene,
    png: { width: 1, height: 1, byteLength: 1 },
    svgValidation: { ok: true },
  });

for (const kind of ['bar', 'line', 'scatter'])
  test(`${kind} renders axes, data and explicit editable fallbacks`, () => {
    const document = chart(kind);
    const output = renderDiagramOutputs(document);
    assert.equal(output.quality.status, 'pass');
    assert.equal(coverage(output.quality).status, 'pass');
    assert.equal((output.svg.match(/data-axis-id=/gu) ?? []).length, 2);
    assert.equal((output.svg.match(/data-mark-id=/gu) ?? []).length, output.scene.marks.length);
    assert.ok(output.png.width > 0 && output.png.height > 0);
    assert.equal(output.png.bytes.readUInt32BE(16), output.png.width);
    assert.equal(output.png.bytes.readUInt32BE(20), output.png.height);
    const editable = exportDiagramExcalidraw(document);
    assert.equal(editable.scene, null);
    assert.equal(editable.report.status, 'unsupported');
    assert.match(editable.report.omitted[0].reason, /Cartesian axes and data marks/u);
    const migration = previewLegacyDiagramDocument(document);
    assert.equal(migration.ok, false);
    assert.equal(migration.diagnostics[0].code, 'unsupported-legacy-content');
  });

test('grouped bars share category slots and preserve negative, positive and zero values', () => {
  const document = chart('bar', {
    series: [
      series([
        ['A', -10],
        ['B', 0],
        ['C', 20],
      ]),
      series(
        [
          ['C', 10],
          ['A', 5],
        ],
        'series-secondary',
      ),
    ],
  });
  const { scene, quality } = renderDiagramOutputs(document);
  assert.equal(quality.status, 'pass');
  const [negative, zero, positive, secondC, secondA] = scene.marks;
  assert.equal(negative.y, zero.y);
  assert.equal(zero.height, 0);
  assert.ok(positive.y < zero.y);
  assert.ok(Math.abs(positive.height / negative.height - 2) < 1e-8);
  assert.ok(secondC.x > positive.x && secondC.x < positive.x + 2 * positive.width);
  assert.ok(secondA.x > negative.x && secondA.x < negative.x + 2 * negative.width);
});

for (const values of [
  [['A', 0]],
  [
    ['A', -3],
    ['B', -3],
  ],
  [
    ['A', 8],
    ['B', 8],
  ],
])
  test(`constant bar domain ${JSON.stringify(values)} stays finite`, () => {
    const { scene, quality } = renderDiagramOutputs(chart('bar', { series: [series(values)] }));
    assert.equal(quality.status, 'pass');
    for (const mark of scene.marks)
      for (const field of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(mark[field]));
  });

test('numeric scatter preserves uneven x spacing and node positions without dropping series', () => {
  const document = chart('scatter', {
    series: [
      series([
        ['-2', 2],
        ['0', 4],
        ['8', 6],
      ]),
    ],
    nodes: [
      {
        id: 'target',
        label: 'Target',
        kind: 'point',
        semanticPosition: { horizontal: 0.5, vertical: 0.5, meaning: 'Midpoint of the plot' },
      },
    ],
    annotations: [{ id: 'note', targetId: 'series-main', text: 'Measured throughput' }],
    emphasis: [
      { targetId: 'series-main', level: 'primary' },
      { targetId: 'axis-horizontal', level: 'primary' },
      { targetId: 'target', level: 'muted' },
    ],
  });
  const { scene, quality } = renderDiagramOutputs(document);
  assert.equal(quality.status, 'pass');
  const [first, second, third, target] = scene.marks;
  assert.equal(target.id, 'target');
  assert.ok(Math.abs((third.x - second.x) / (second.x - first.x) - 4) < 1e-8);
  assert.ok(target.x > second.x && target.x < third.x);
  assert.equal(scene.notes[0].targetId, 'series-main');
  assert.equal(scene.boxes.length, 0);
});

test('supporting chart nodes and annotations retain semantic coverage', () => {
  const document = chart('line', {
    nodes: [{ id: 'context', label: 'Context', kind: 'note' }],
    annotations: [{ id: 'note', targetId: 'context', text: 'Supporting context' }],
  });
  const { scene, quality } = renderDiagramOutputs(document);
  assert.equal(quality.status, 'pass');
  assert.equal(scene.boxes[0].id, 'context');
  assert.equal(scene.marks.length, document.series.length);
});

test('numeric lines sort samples by x and retain a visible singleton', () => {
  const base = chart('line');
  const document = chart('line', {
    axes: [{ ...base.axes[0], scale: 'linear' }, base.axes[1]],
    series: [
      series([
        ['10', 10],
        ['0', 0],
        ['2', 4],
      ]),
      series([['2', 3]], 'series-secondary'),
    ],
  });
  const { scene, quality, svg } = renderDiagramOutputs(document);
  assert.equal(quality.status, 'pass');
  const [first, second, third] = scene.marks[0].points;
  assert.ok(first[0] < second[0] && second[0] < third[0]);
  assert.ok(Math.abs((third[0] - second[0]) / (second[0] - first[0]) - 4) < 1e-8);
  assert.equal(scene.marks[1].points.length, 1);
  assert.match(svg, /<circle/u);
});

test('temporal and logarithmic numeric axes preserve their scale', () => {
  const base = chart('line');
  const document = chart('line', {
    axes: [
      { ...base.axes[0], scale: 'temporal' },
      { ...base.axes[1], scale: 'logarithmic' },
    ],
    series: [
      series([
        ['2026-01-01', 1],
        ['2026-01-02', 10],
        ['2026-01-05', 100],
      ]),
    ],
  });
  const { scene, quality } = renderDiagramOutputs(document);
  assert.equal(quality.status, 'pass');
  const [first, second, third] = scene.marks[0].points;
  assert.ok(Math.abs((third[0] - second[0]) / (second[0] - first[0]) - 3) < 1e-8);
  assert.ok(Math.abs(first[1] - second[1] - (second[1] - third[1])) < 1e-8);
});

test('invalid chart mappings fail explicitly with input diagnostics', () => {
  const base = chart('scatter');
  for (const changes of [
    { series: [series([['not-a-number', 1]])] },
    { series: [series([['Infinity', 1]])] },
    { axes: [base.axes[0]] },
    { axes: [...base.axes, { id: 'extra-axis', label: 'Extra', scale: 'linear' }] },
    { axes: [{ ...base.axes[0], scale: 'categorical' }, base.axes[1]] },
    {
      axes: [base.axes[0], { ...base.axes[1], scale: 'logarithmic' }],
      series: [series([['1', 0]])],
    },
  ])
    assert.throws(() => layoutDiagram(chart('scatter', changes)), {
      code: 'E_DIAGRAM_RENDER_FAILED',
    });
});

test('quality detects missing marks, clipped marks and chart collisions', () => {
  const document = chart('bar');
  const scene = layoutDiagram(document);
  assert.equal(coverage(report(document, { ...scene, marks: [] })).status, 'fail');
  const clipped = { ...scene.marks[0], x: -5 };
  assert.equal(
    report(document, { ...scene, marks: [clipped, ...scene.marks.slice(1)] }).checks.find(
      ({ id }) => id === 'rendered-clipping',
    ).status,
    'fail',
  );
  const overlap = {
    ...scene.marks[1],
    ...Object.fromEntries(
      ['x', 'y', 'width', 'height'].map((field) => [field, scene.marks[0][field]]),
    ),
  };
  assert.equal(
    report(document, { ...scene, marks: [scene.marks[0], overlap] }).checks.find(
      ({ id }) => id === 'mark-overlap',
    ).status,
    'fail',
  );
});

test('axis labels distinguish narrow numeric and intraday ranges', () => {
  const base = chart('scatter');
  for (const [scale, keys] of [
    ['linear', ['1000000', '1000003']],
    ['temporal', ['2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z']],
  ]) {
    const scene = layoutDiagram(
      chart('scatter', {
        axes: [{ ...base.axes[0], scale }, base.axes[1]],
        series: [series(keys.map((key, index) => [key, index]))],
      }),
    );
    assert.equal(new Set(scene.axes[0].ticks.map(({ text }) => text.lines.join(' '))).size, 5);
  }
});

test('extreme finite domains keep finite labels and geometry', () => {
  const base = chart('scatter');
  for (const [scale, key] of [
    ['linear', String(Number.MAX_VALUE)],
    ['temporal', '+275760-09-13T00:00:00.000Z'],
  ]) {
    const scene = layoutDiagram(
      chart('scatter', {
        axes: [{ ...base.axes[0], scale }, base.axes[1]],
        series: [series([[key, 1]])],
      }),
    );
    assert.ok(scene.axes[0].ticks.every(({ text }) => !text.lines.join(' ').includes('Infinity')));
    assert.ok(scene.marks.every((mark) => Number.isFinite(mark.x)));
  }
});

test('scatter keeps repeated x values and bars reject duplicate categories', () => {
  const values = [
    ['1', 1],
    ['1', 2],
  ];
  const { scene, quality } = renderDiagramOutputs(chart('scatter', { series: [series(values)] }));
  assert.equal(quality.status, 'pass');
  assert.equal(scene.marks[0].x, scene.marks[1].x);
  assert.notEqual(scene.marks[0].y, scene.marks[1].y);
  assert.throws(
    () => layoutDiagram(chart('bar', { series: [series(values)] })),
    /Duplicate keys in series series-main/u,
  );
});
