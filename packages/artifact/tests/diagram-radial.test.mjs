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
import {
  diagramSeriesColors,
  resolveDiagramTheme,
} from '../lib/artifact/diagram/rendering/theme.mjs';
import { contrastRatio } from '../lib/artifact/internal/contrast.mjs';

function chart(kind, changes = {}) {
  const fixture = JSON.parse(
    readFileSync(
      new URL(`../fixtures/diagram/grammars/${kind}.planr-diagram.json`, import.meta.url),
    ),
  );
  const input = { ...fixture, ...changes };
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
const status = (quality, id) => quality.checks.find((check) => check.id === id).status;
/** Every check passes, except a radar ring label crossing, which warns. */
function assertClean(quality) {
  const crossing = quality.checks.some(
    ({ id, status }) => id === 'scale-label-crossing' && status === 'warning',
  );
  assert.equal(quality.status, crossing ? 'warning' : 'pass');
  for (const check of quality.checks)
    if (check.id !== 'scale-label-crossing')
      assert.equal(check.status, 'pass', `${check.id}: ${check.message}`);
}
const report = (document, scene) =>
  createRenderQualityReport(document, {
    scene,
    png: { width: 1, height: 1, byteLength: 1 },
    svgValidation: { ok: true },
  });

function polygonHitsTile({ points }, text) {
  const left = text.x - 2,
    right = text.x + text.width + 2,
    top = text.y,
    bottom = text.y + text.height;
  const inside = ([x, y]) => x > left && x < right && y > top && y < bottom;
  return points.some((start, index) => {
    const end = points[(index + 1) % points.length];
    if (inside(start) || inside(end)) return true;
    const [x, y] = start,
      dx = end[0] - x,
      dy = end[1] - y;
    return [
      ...[left, right].map((edge) => [edge, x, dx, y, dy, top, bottom]),
      ...[top, bottom].map((edge) => [edge, y, dy, x, dx, left, right]),
    ].some(([edge, origin, delta, other, otherDelta, low, high]) => {
      if (delta === 0) return false;
      const fraction = (edge - origin) / delta;
      const crossing = other + fraction * otherDelta;
      return fraction >= 0 && fraction <= 1 && crossing > low && crossing < high;
    });
  });
}

for (const kind of ['radar', 'polar']) {
  test(`${kind} renders its grid, labels, marks and explicit editable fallback`, () => {
    const document = chart(kind);
    const { scene, svg, png, quality } = renderDiagramOutputs(document);
    assertClean(quality);
    assert.equal(status(quality, 'semantic-coverage'), 'pass');
    assert.equal(scene.axes.length, 2);
    assert.equal(scene.axes[1].grid.spokes.length, 6);
    assert.equal(scene.axes[1].grid.rings.length, 4);
    assert.equal(scene.boxes.length, 0);
    assert.match(svg, /data-radial-grid="scale"/u);
    assert.equal((svg.match(/data-mark-kind=/gu) ?? []).length, kind === 'radar' ? 2 : 6);
    assert.equal(png.bytes.readUInt32BE(16), png.width);
    assert.equal(png.bytes.readUInt32BE(20), png.height);
    const projection = exportDiagramExcalidraw(document);
    assert.equal(projection.scene, null);
    assert.equal(projection.report.status, 'unsupported');
    assert.match(projection.report.omitted[0].reason, /Radial grids, polygons and sectors/u);
    assert.equal(
      previewLegacyDiagramDocument(document).diagnostics[0].code,
      'unsupported-legacy-content',
    );
  });

  test(`${kind} labels scale values beside the top spoke and checks label collisions`, () => {
    const document = chart(kind);
    const { scene, svg, quality } = renderDiagramOutputs(document);
    assertClean(quality);
    const scale = scene.axes[1];
    const { cx, cy, radius } = scale.grid;
    const maximum = Math.max(
      ...document.series.flatMap(({ values }) => values.map(({ value }) => value)),
    );
    assert.deepEqual(
      scale.ticks.map(({ text }) => text.lines.join('')),
      Array.from({ length: 5 }, (_, index) =>
        String(Number((maximum * (index / 4)).toPrecision(4))),
      ),
    );
    for (const [index, tick] of scale.ticks.entries()) {
      assert.equal(tick.x, cx);
      assert.equal(tick.y, cy - radius * (index / 4));
      assert.equal(tick.text.x, cx + 6);
      assert.equal(tick.text.y + tick.text.height, tick.y);
      assert.ok(scene.labelBounds.includes(tick.text));
      const overlay = `<g data-scale-tick-id="${tick.text.id}">`;
      assert.ok(svg.indexOf(overlay) > svg.lastIndexOf('data-mark-kind='));
      if (kind === 'polar') {
        const theme = resolveDiagramTheme(document.theme);
        assert.ok(
          svg.includes(
            `${overlay}<rect x="${tick.text.x - 2}" y="${tick.text.y}" width="${tick.text.width + 4}" height="${tick.text.height}" fill="${theme.background}"/>`,
          ),
        );
      }
    }
    assert.ok(scene.labelBounds.includes(scale.text));
    assert.ok(scale.text.x >= cx);
    assert.ok(scale.text.y + scale.text.height < scale.ticks.at(-1).text.y);
    assert.equal(
      scene.width,
      Math.ceil(
        Math.max(cx + radius + 32, ...scene.labelBounds.map((text) => text.x + text.width + 32)),
      ),
    );
    for (const text of scene.labelBounds) {
      assert.ok(text.x >= 0 && text.y >= 0);
      assert.ok(text.x + text.width <= scene.width && text.y + text.height <= scene.height);
    }
    const obstacle = { ...scale.ticks[2].text, id: 'overlapping-label' };
    const collision = report(document, { ...scene, labelBounds: [...scene.labelBounds, obstacle] });
    assert.equal(status(collision, 'label-overlap'), 'fail');
  });

  test(`${kind} legend swatches match its data marks`, () => {
    const base = chart(kind);
    const document = chart(kind, {
      series: [base.series[0], { ...base.series[0], id: 'second' }],
    });
    const { scene, svg } = renderDiagramOutputs(document);
    const colors = diagramSeriesColors(resolveDiagramTheme(document.theme));
    for (const text of scene.legend) {
      const color = colors[text.seriesIndex];
      if (kind === 'polar')
        assert.ok(
          svg.includes(
            `<g><rect x="${text.x - 24}" y="${text.y + 2}" width="12" height="12" fill="${color}"/>`,
          ),
        );
      else
        assert.ok(
          svg.includes(
            `<g><line x1="${text.x - 28}" y1="${text.y + 8}" x2="${text.x - 8}" y2="${text.y + 8}" stroke="${color}" stroke-width="3"${text.seriesIndex % 2 ? ' stroke-dasharray="8 5"' : ''}/>`,
          ),
        );
    }
  });

  test(`${kind} rejects negative values and duplicate keys`, () => {
    const base = chart(kind);
    const negative = structuredClone(base.series);
    negative[0].values[0].value = -1;
    assert.throws(
      () => layoutDiagram(chart(kind, { series: negative })),
      /Invalid value -1.*series-main/u,
    );
    const duplicate = structuredClone(base.series);
    duplicate[0].values[1].key = duplicate[0].values[0].key;
    assert.throws(
      () => layoutDiagram(chart(kind, { series: duplicate })),
      /Duplicate keys in series series-main/u,
    );
    const axes = structuredClone(base.axes);
    axes[1].scale = 'logarithmic';
    assert.throws(() => layoutDiagram(chart(kind, { axes })), /Unsupported radial axis scales/u);
  });

  test(`${kind} keeps all-zero data at the centre`, () => {
    const base = chart(kind);
    const samples = base.series.map((item) => ({
      ...item,
      values: item.values.map((value) => ({ ...value, value: 0 })),
    }));
    const { scene, quality, svg } = renderDiagramOutputs(chart(kind, { series: samples }));
    assertClean(quality);
    const { cx, cy } = scene.axes[1].grid;
    for (const mark of scene.marks) {
      if (kind === 'radar') assert.ok(mark.points.every(([x, y]) => x === cx && y === cy));
      else assert.equal(mark.radius, 0);
    }
    assert.doesNotMatch(svg, /NaN|Infinity/u);
  });

  test(`${kind} includes annotations on series and axes in semantic coverage`, () => {
    const base = chart(kind);
    const document = chart(kind, {
      annotations: [base.series[0], ...base.axes].map(({ id }, index) => ({
        id: `note-${index}`,
        text: `Details for ${id}`,
        targetId: id,
      })),
    });
    const { scene, quality } = renderDiagramOutputs(document);
    assertClean(quality);
    assert.equal(scene.notes.length, 3);
    assert.equal(status(quality, 'semantic-coverage'), 'pass');
  });

  for (const themeId of ['openplanr-default', 'openplanr'])
    for (const mode of ['light', 'dark', 'auto'])
      test(`${kind} preserves palette contrast in ${themeId} ${mode}`, () => {
        const base = chart(kind);
        const document = chart(kind, {
          theme: { themeId, mode },
          series: Array.from({ length: 6 }, (_, index) => ({
            ...base.series[0],
            id: `series-${index}`,
          })),
        });
        const { svg, quality } = renderDiagramOutputs(document);
        assertClean(quality);
        const theme = resolveDiagramTheme(document.theme);
        if (kind === 'polar') {
          const sectors = [
            ...svg.matchAll(/data-mark-kind="arc"[^>]*><title>[^<]*<\/title>(<path[^>]*>)/gu),
          ];
          assert.equal(
            sectors.length,
            document.series.reduce((count, { values }) => count + values.length, 0),
          );
          for (const [, path] of sectors)
            assert.ok(path.includes(`stroke="${theme.background}" stroke-width="1.5"`));
        }
        for (const palette of [theme, ...(theme.dark ? [theme.dark] : [])])
          for (const color of diagramSeriesColors(palette)) {
            assert.ok(contrastRatio(color, palette.background) >= 3);
            if (palette === theme) assert.ok(svg.includes(color));
          }
        if (theme.dark) {
          assert.ok(
            svg.includes(`[stroke="${theme.background}"]{stroke:${theme.dark.background}}`),
          );
          for (const [index, color] of diagramSeriesColors(theme).entries()) {
            const dark = diagramSeriesColors(theme.dark)[index];
            assert.ok(svg.includes(`[fill="${color}"]{fill:${dark}}`));
            assert.ok(svg.includes(`[stroke="${color}"]{stroke:${dark}}`));
          }
        }
      });
}

// The report pads ring labels by 2 px and ignores 1 px grazes, as segmentEntersBox does.
const inset = (text) => ({
  ...text,
  x: text.x + 1,
  y: text.y + 1,
  width: text.width - 2,
  height: text.height - 2,
});

function seededRadar(spokes, seed) {
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  return chart('radar', {
    series: ['first', 'second'].map((id) =>
      series(
        Array.from({ length: spokes }, (_, index) => [
          `Axis ${index + 1}`,
          Math.round(next() * 10),
        ]),
        id,
      ),
    ),
  });
}
const seededRadars = [5, 6, 8].flatMap((spokes) =>
  Array.from({ length: 4 }, (_, index) => ({
    name: `${spokes} spokes, seed ${index}`,
    document: seededRadar(spokes, spokes * 100 + index),
  })),
);

function ringTopAt({ cx, spokes }, fraction, x) {
  const ring = spokes.map(([sx, sy]) => [
    cx + (sx - cx) * fraction,
    spokes.cy + (sy - spokes.cy) * fraction,
  ]);
  return Math.min(
    ...ring.flatMap((start, index) => {
      const end = ring[(index + 1) % ring.length];
      if (x < Math.min(start[0], end[0]) || x > Math.max(start[0], end[0]) || start[0] === end[0])
        return [];
      return [start[1] + ((x - start[0]) / (end[0] - start[0])) * (end[1] - start[1])];
    }),
  );
}

test('radar ring values sit nearest their own ring along the top spoke', () => {
  for (const { name, document } of [
    { name: 'fixture', document: chart('radar') },
    ...seededRadars,
  ]) {
    const { grid, ticks } = layoutDiagram(document).axes[1];
    const shape = { cx: grid.cx, spokes: Object.assign([...grid.spokes], { cy: grid.cy }) };
    for (const [index, { text }] of ticks.entries()) {
      if (index === 0) continue;
      const baseline = text.y + 13;
      const x = text.x + text.width / 2;
      const nearest = grid.rings.reduce((best, fraction) =>
        Math.abs(ringTopAt(shape, fraction, x) - baseline) <
        Math.abs(ringTopAt(shape, best, x) - baseline)
          ? fraction
          : best,
      );
      assert.equal(nearest, index / 4, `${name}: ${text.lines.join('')} reads as ring ${nearest}`);
    }
  }
});

test('radar ring labels crossing series lines warn by name and never invalidate', () => {
  let crossings = 0;
  for (const { name, document } of [
    { name: 'fixture', document: chart('radar') },
    ...seededRadars,
  ]) {
    const { scene, quality } = renderDiagramOutputs(document);
    assert.notEqual(quality.status, 'invalid', `${name} renders invalid`);
    assert.equal(status(quality, 'mark-overlap'), 'pass', name);
    const expected = scene.axes[1].ticks
      .slice(1)
      .flatMap(({ text }) =>
        scene.marks
          .filter((mark) => polygonHitsTile(mark, inset(text)))
          .map((mark) => `"${text.lines.join('')}" crosses series "${mark.label}"`),
      );
    crossings += expected.length;
    const check = quality.checks.find(({ id }) => id === 'scale-label-crossing');
    assert.equal(check.status, expected.length ? 'warning' : 'pass', name);
    for (const crossing of expected)
      assert.ok(check.message.includes(crossing), `${name}: ${crossing}`);
  }
  assert.ok(crossings > 0, 'seeded radars exercise at least one crossing');
});

test('radar ring labels draw a background text halo without tiles', () => {
  const document = chart('radar', { theme: { themeId: 'openplanr', mode: 'auto' } });
  const { scene, svg } = renderDiagramOutputs(document);
  const theme = resolveDiagramTheme(document.theme);
  for (const { text } of scene.axes[1].ticks) {
    const group = svg.slice(svg.indexOf(`<g data-scale-tick-id="${text.id}">`)).split('</g>')[0];
    assert.match(
      group,
      new RegExp(
        `^<g data-scale-tick-id="${text.id}"><text [^>]*stroke="${theme.background}" stroke-width="3" stroke-linejoin="round" paint-order="stroke">`,
        'u',
      ),
    );
    assert.doesNotMatch(group, /<rect/u);
  }
  assert.ok(svg.includes(`[stroke="${theme.background}"]{stroke:${theme.dark.background}}`));
});

test('radar checks the closing polygon edge against non-centre scale labels', () => {
  const document = chart('radar');
  const scene = layoutDiagram(document);
  const mark = scene.marks[0];
  const start = mark.points.at(-1),
    end = mark.points[0];
  const text = {
    ...scene.axes[1].ticks[2].text,
    x: (start[0] + end[0]) / 2 - 4,
    y: (start[1] + end[1]) / 2 - 4,
    width: 8,
    height: 8,
  };
  const quality = report(document, { ...scene, labelBounds: [text] });
  assert.equal(status(quality, 'scale-label-crossing'), 'warning');
  assert.equal(status(quality, 'mark-overlap'), 'pass');
});

test('radar vertices follow first appearance regardless of later series order', () => {
  const document = chart('radar', {
    series: [
      series([
        ['C', 3],
        ['A', 0],
        ['B', 6],
      ]),
      series(
        [
          ['B', 3],
          ['C', 6],
          ['A', 6],
        ],
        'second',
      ),
    ],
  });
  const { scene, quality, svg } = renderDiagramOutputs(document);
  assertClean(quality);
  assert.deepEqual(
    scene.axes[0].ticks.map(({ text }) => text.lines.join('')),
    ['C', 'A', 'B'],
  );
  const { cx, cy, radius } = scene.axes[1].grid;
  assert.deepEqual(scene.marks[0].points[0], [cx, cy - radius / 2]);
  assert.deepEqual(scene.marks[0].points[1], [cx, cy]);
  assert.deepEqual(scene.marks[1].points[0], [cx, cy - radius]);
  assert.equal(scene.marks.length, 2);
  assert.match(svg, /data-mark-kind="polygon"[\s\S]*?<polygon/u);
  assert.equal(status(quality, 'mark-overlap'), 'pass');
});

test('radar rejects missing spokes', () => {
  assert.throws(
    () =>
      layoutDiagram(
        chart('radar', {
          series: [
            series([
              ['A', 1],
              ['B', 2],
              ['C', 3],
            ]),
            series([['A', 1]], 'second'),
          ],
        }),
      ),
    /Series second is missing radar spokes/u,
  );
});

for (const count of [1, 2])
  test(`radar rejects ${count} spokes with a named error and repair hint`, () => {
    assert.throws(
      () =>
        layoutDiagram(
          chart('radar', {
            series: [
              series(
                [
                  ['A', 1],
                  ['B', 2],
                ].slice(0, count),
              ),
            ],
          }),
        ),
      (error) => {
        assert.equal(error.code, 'E_DIAGRAM_RENDER_FAILED');
        assert.equal(
          error.message,
          `radar chart: Expected at least 3 radar spokes, received ${count}.`,
        );
        assert.equal(error.details.spokeCount, count);
        assert.match(error.details.repair, /Radar charts require at least 3 spokes/u);
        return true;
      },
    );
  });

test('legacy radial category axes keep one vertex per key', () => {
  for (const kind of ['radar', 'polar']) {
    const base = chart(kind);
    const { scene, quality } = renderDiagramOutputs(
      chart(kind, {
        axes: [{ ...base.axes[0], scale: 'linear' }, base.axes[1]],
        series: [
          series([
            ['A', 3],
            ['B', 5],
            ['C', 4],
          ]),
        ],
      }),
    );
    assertClean(quality);
    assert.equal(scene.marks.length, kind === 'radar' ? 1 : 3);
    if (kind === 'radar') assert.equal(scene.marks[0].points.length, 3);
  }
});

test('polar divides each first-appearance category angle into stable series slots', () => {
  const { scene, quality } = renderDiagramOutputs(
    chart('polar', {
      series: [
        series([
          ['B', 4],
          ['A', 2],
        ]),
        series(
          [
            ['A', 4],
            ['C', 0],
          ],
          'second',
        ),
      ],
    }),
  );
  assertClean(quality);
  assert.deepEqual(
    scene.axes[0].ticks.map(({ text }) => text.lines.join('')),
    ['B', 'A', 'C'],
  );
  const [b, a, secondA, c] = scene.marks;
  for (const mark of scene.marks)
    assert.ok(Math.abs(mark.endAngle - mark.startAngle - Math.PI / 3) < 1e-10);
  assert.ok(Math.abs(a.endAngle - secondA.startAngle) < 1e-10);
  assert.equal(b.radius, 2 * a.radius);
  assert.equal(c.radius, 0);
});

test('one polar value renders a full circle with two arcs', () => {
  const { scene, svg, quality } = renderDiagramOutputs(
    chart('polar', { series: [series([['All traffic', 10]])] }),
  );
  assertClean(quality);
  const [mark] = scene.marks;
  assert.ok(Math.abs(mark.endAngle - mark.startAngle - 2 * Math.PI) < 1e-10);
  assert.equal((svg.match(/ A /gu) ?? []).length, 2);
  assert.equal(mark.width, mark.radius * 2 + 4);
  assert.equal(mark.height, mark.radius * 2 + 4);
});

test('polar sector paths sweep clockwise through two half-arcs', () => {
  const { scene, svg, quality } = renderDiagramOutputs(
    chart('polar', {
      series: [
        series([
          ['A', 1],
          ['B', 1],
        ]),
      ],
    }),
  );
  assertClean(quality);
  const { cx, cy, radius } = scene.axes[1].grid;
  const path = `M ${cx} ${cy} L ${cx} ${cy - radius} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx} ${cy + radius} Z`;
  assert.ok(svg.includes(`<path d="${path}"`));
});

for (const kind of ['radar', 'polar'])
  test(`${kind} reports obstacle intersections and clipping from actual geometry`, () => {
    const document = chart(kind);
    const scene = layoutDiagram(document);
    const { cx, cy } = scene.axes[1].grid;
    const mark = scene.marks[0];
    const [x, y] =
      kind === 'radar'
        ? [
            (mark.points.at(-1)[0] + mark.points[0][0]) / 2,
            (mark.points.at(-1)[1] + mark.points[0][1]) / 2,
          ]
        : [
            cx + (mark.radius / 2) * Math.cos((mark.startAngle + mark.endAngle) / 2),
            cy + (mark.radius / 2) * Math.sin((mark.startAngle + mark.endAngle) / 2),
          ];
    const obstacle = { id: 'test-label', x: x - 4, y: y - 4, width: 8, height: 8 };
    assert.equal(
      status(
        report(document, { ...scene, labelBounds: [...scene.labelBounds, obstacle] }),
        'mark-overlap',
      ),
      'fail',
    );
    const outside =
      kind === 'radar'
        ? { ...scene.marks[0], points: [[-50, -50], ...scene.marks[0].points.slice(1)] }
        : { ...scene.marks[0], radius: scene.width * 2 };
    assert.equal(
      status(report(document, { ...scene, marks: [outside] }), 'rendered-clipping'),
      'fail',
    );
  });

test('radial collision checks ignore empty corners of polygon and sector bounds', () => {
  for (const kind of ['radar', 'polar']) {
    const document = chart(kind);
    const scene = layoutDiagram(document);
    const mark = scene.marks[0];
    const obstacle = { id: 'empty-corner', x: mark.x, y: mark.y, width: 1, height: 1 };
    assert.equal(
      status(
        report(document, { ...scene, marks: [mark], labelBounds: [obstacle] }),
        'mark-overlap',
      ),
      'pass',
    );
  }
});

test('unfilled radar polygon interiors do not obstruct labels', () => {
  const document = chart('radar');
  const scene = layoutDiagram(document);
  const { cx, cy } = scene.axes[1].grid;
  assert.equal(
    status(
      report(document, {
        ...scene,
        labelBounds: [{ id: 'centre', x: cx - 2, y: cy - 2, width: 4, height: 4 }],
      }),
      'mark-overlap',
    ),
    'pass',
  );
});

test('radial scales remain finite for the largest and smallest finite values', () => {
  for (const kind of ['radar', 'polar']) {
    const { svg, quality } = renderDiagramOutputs(
      chart(kind, {
        series: [
          series([
            ['A', Number.MAX_VALUE],
            ['B', Number.MIN_VALUE],
            ['C', 0],
          ]),
        ],
      }),
    );
    assertClean(quality);
    assert.doesNotMatch(svg, /NaN|Infinity/u);
  }
});
