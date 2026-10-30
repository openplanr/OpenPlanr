import { DIAGRAM_ERROR_CODES, diagramFail } from '../../errors.mjs';
import { measureDiagramText } from '../text.mjs';

const TAU = 2 * Math.PI;
const point = (cx, cy, radius, angle) => [
  cx + radius * Math.cos(angle),
  cy + radius * Math.sin(angle),
];

/** Sector endpoints and extrema, including its zero centre. */
export function sectorBoundsPoints({ cx, cy, radius, startAngle, endAngle }) {
  const angles = [startAngle, endAngle];
  const first = Math.ceil(startAngle / (Math.PI / 2));
  for (let offset = 0; offset < 4; offset += 1) {
    const angle = (first + offset) * (Math.PI / 2);
    if (angle < endAngle) angles.push(angle);
  }
  return [[cx, cy], ...angles.map((angle) => point(cx, cy, radius, angle))];
}

function bounds(points) {
  const xs = points.map(([x]) => x),
    ys = points.map(([, y]) => y);
  return {
    x: Math.min(...xs) - 2,
    y: Math.min(...ys) - 2,
    width: Math.max(...xs) - Math.min(...xs) + 4,
    height: Math.max(...ys) - Math.min(...ys) + 4,
  };
}

/** Radial spokes follow the first appearance of value keys across series. */
export function layoutRadialChart(document, { wrapDiagramLabel }) {
  const invalid = (message, details = {}) =>
    diagramFail(DIAGRAM_ERROR_CODES.RENDER_FAILED, `${document.grammar.id} chart: ${message}`, {
      ...details,
      repair:
        'Declare category and linear scale axes, unique keys and finite non-negative values. Radar series must each include every spoke.',
    });
  if (document.axes.length !== 2) invalid(`Expected two axes, received ${document.axes.length}.`);
  if (
    !['categorical', 'ordinal', 'linear'].includes(document.axes[0].scale) ||
    document.axes[1].scale !== 'linear'
  )
    invalid(
      `Unsupported radial axis scales: ${document.axes.map(({ scale }) => scale).join(', ')}.`,
    );
  const count = document.series.reduce((total, { values }) => total + values.length, 0);
  if (count > 10_000)
    diagramFail(DIAGRAM_ERROR_CODES.RESOURCE_BUDGET_EXCEEDED, 'Chart exceeds 10000 data marks.', {
      count,
    });
  const keys = [...new Set(document.series.flatMap(({ values }) => values.map(({ key }) => key)))];
  if (keys.length === 0) invalid('No value keys were declared.');
  const radar = document.grammar.id === 'radar';
  for (const series of document.series) {
    if (new Set(series.values.map(({ key }) => key)).size !== series.values.length)
      invalid(`Duplicate keys in series ${series.id}.`, { seriesId: series.id });
    for (const { key, value } of series.values)
      if (!Number.isFinite(value) || value < 0)
        invalid(`Invalid value ${value} for key ${JSON.stringify(key)} in series ${series.id}.`, {
          seriesId: series.id,
          key,
          value,
        });
    if (radar && series.values.length !== keys.length)
      invalid(`Series ${series.id} is missing radar spokes.`, { seriesId: series.id });
  }
  const style = { size: 13, glyph: 7 };
  const label = (id, text, x, y, anchor = 'start') => {
    const lines = wrapDiagramLabel(text, 24, style);
    const width = Math.max(1, ...lines.map((line) => measureDiagramText(line, style)));
    return {
      id,
      lines: Object.freeze(lines),
      x: x - (anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0),
      y,
      width,
      height: lines.length * 18,
    };
  };
  const sizes = keys.map((key) => label('', key, 0, 0));
  const radius = 200;
  const cx = radius + Math.max(...sizes.map(({ width }) => width)) + 64;
  const cy = radius + Math.max(...sizes.map(({ height }) => height)) + 100;
  const sidebar = cx + radius + Math.max(...sizes.map(({ width }) => width)) + 80;
  const angle = (index) => -Math.PI / 2 + (index * TAU) / keys.length;
  const spokes = keys.map((_, index) => point(cx, cy, radius, angle(index)));
  const maximum = document.series.reduce(
    (high, { values }) => values.reduce((next, { value }) => Math.max(next, value), high),
    0,
  );
  const radial = (value) => (maximum === 0 ? 0 : radius * (value / maximum));
  const emphasis = (id) => document.emphasis.find(({ targetId }) => targetId === id)?.level ?? null;
  const labelBounds = [];
  const axes = document.axes.map((axis, index) => {
    const ticks =
      index === 0
        ? keys.map((key, keyIndex) => {
            const a = angle(keyIndex + (radar ? 0 : 0.5));
            const [x, y] = point(cx, cy, radius + 28, a);
            const text = label(
              `${axis.id}-tick-${keyIndex}`,
              key,
              x,
              y - sizes[keyIndex].height / 2,
              Math.abs(Math.cos(a)) < 0.01 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end',
            );
            return { x, y, text };
          })
        : Array.from({ length: 5 }, (_, tickIndex) => {
            const value = maximum * (tickIndex / 4);
            const rounded = Number(value.toPrecision(4));
            const text = label(
              `${axis.id}-tick-${tickIndex}`,
              String(Number.isFinite(rounded) ? rounded : value),
              sidebar,
              110 + tickIndex * 28,
            );
            return { x: sidebar, y: text.y, text };
          });
    const text = label(axis.id, axis.label, index === 0 ? 32 : sidebar, 32);
    labelBounds.push(text, ...ticks.map(({ text }) => text));
    return {
      ...axis,
      radial: true,
      ...bounds([
        [cx - radius, cy - radius],
        [cx + radius, cy + radius],
      ]),
      x1: cx,
      y1: cy,
      x2: cx,
      y2: cy - radius,
      ticks: Object.freeze(ticks.map(Object.freeze)),
      text,
      emphasis: emphasis(axis.id),
      ...(index === 1
        ? {
            grid: Object.freeze({
              cx,
              cy,
              radius,
              polygon: radar,
              spokes: Object.freeze(spokes.map(Object.freeze)),
              rings: Object.freeze([0.25, 0.5, 0.75, 1]),
            }),
          }
        : {}),
    };
  });
  const marks = [];
  for (const [seriesIndex, series] of document.series.entries()) {
    const common = {
      id: series.id,
      label: series.label,
      seriesIndex,
      emphasis: emphasis(series.id),
    };
    if (radar) {
      const values = new Map(series.values.map(({ key, value }) => [key, value]));
      const points = keys.map((key, index) => point(cx, cy, radial(values.get(key)), angle(index)));
      marks.push({
        ...common,
        kind: 'polygon',
        points: Object.freeze(points.map(Object.freeze)),
        ...bounds(points),
      });
    } else {
      for (const { key, value } of series.values) {
        const startAngle = angle(keys.indexOf(key) + seriesIndex / document.series.length);
        const endAngle = startAngle + TAU / keys.length / document.series.length;
        const sector = { cx, cy, radius: radial(value), startAngle, endAngle };
        marks.push({
          ...common,
          kind: 'arc',
          key,
          value,
          ...sector,
          ...bounds(sectorBoundsPoints(sector)),
        });
      }
    }
  }
  let legendY = cy + radius + Math.max(...sizes.map(({ height }) => height)) + 72;
  const legend = document.series.map((series, seriesIndex) => {
    const text = label(series.id, series.label, 64, legendY);
    legendY += text.height + 16;
    labelBounds.push(text);
    return { ...text, seriesIndex };
  });
  return {
    kind: 'chart',
    width: Math.ceil(Math.max(sidebar + 160, ...labelBounds.map(({ x, width }) => x + width + 32))),
    height: Math.ceil(legendY + 48),
    axes,
    marks,
    legend,
    labelBounds,
    boxes: [],
    edges: [],
    groups: [],
    lanes: [],
    phases: [],
    lifelines: [],
    notes: [],
  };
}
