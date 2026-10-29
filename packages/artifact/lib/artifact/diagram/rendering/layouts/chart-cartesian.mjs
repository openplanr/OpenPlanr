import { DIAGRAM_ERROR_CODES, diagramFail } from '../../errors.mjs';
import { measureDiagramText } from '../text.mjs';

function invalid(document, message, details = {}) {
  diagramFail(DIAGRAM_ERROR_CODES.RENDER_FAILED, `${document.grammar.id} chart: ${message}`, {
    ...details,
    repair: 'Use two axes in horizontal, vertical order and values compatible with their scales.',
  });
}

function numberLabel(value, precision) {
  const rounded = Number(value.toPrecision(precision));
  return String(Number.isFinite(rounded) ? rounded : value);
}

function numericKey(document, key, scale) {
  const value = scale === 'temporal' ? Date.parse(key) : key.trim() ? Number(key) : Number.NaN;
  if (!Number.isFinite(value))
    invalid(document, `Invalid ${scale} horizontal value: ${key}`, { key, scale });
  return value;
}

function domainScale(document, values, scale, zero) {
  if (!['linear', 'logarithmic', 'temporal'].includes(scale))
    invalid(document, `Unsupported numeric axis scale: ${scale}`, { scale });
  if (values.some((value) => !Number.isFinite(value) || (scale === 'logarithmic' && value <= 0)))
    invalid(
      document,
      `Values must be finite${scale === 'logarithmic' ? ' and positive' : ''} for ${scale} axes.`,
      { scale },
    );
  const transformed = scale === 'logarithmic' ? values.map(Math.log10) : values;
  let minimum = transformed.reduce((low, value) => Math.min(low, value), zero ? 0 : Infinity);
  let maximum = transformed.reduce((high, value) => Math.max(high, value), zero ? 0 : -Infinity);
  if (minimum === maximum) {
    const padding =
      scale === 'temporal'
        ? 60_000
        : scale === 'logarithmic'
          ? 1
          : Math.max(1, Math.abs(minimum) * 0.1);
    const limit = scale === 'temporal' ? 8.64e15 : Number.MAX_VALUE;
    minimum = Math.max(-limit, minimum - padding);
    maximum = Math.min(limit, maximum + padding);
  }
  const unit = Math.max(1, Math.abs(minimum), Math.abs(maximum));
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const fraction = index / 4;
    const value = minimum * (1 - fraction) + maximum * fraction;
    return {
      fraction,
      value:
        scale === 'logarithmic'
          ? Math.max(Number.MIN_VALUE, Math.min(Number.MAX_VALUE, 10 ** value))
          : value,
    };
  });
  const spansZero = scale === 'linear' && minimum < 0 && maximum > 0;
  if (zero && spansZero && !ticks.some(({ value }) => value === 0)) {
    const fraction = -(minimum / unit) / (maximum / unit - minimum / unit);
    const nearest = Math.round(fraction * 4);
    ticks[nearest] = { fraction, value: 0 };
  }
  let precision = 4;
  while (
    precision < 17 &&
    new Set(ticks.map(({ value }) => numberLabel(value, precision))).size < ticks.length
  )
    precision += 1;
  return {
    spansZero,
    position(value) {
      const transformedValue = scale === 'logarithmic' ? Math.log10(value) : value;
      return (transformedValue / unit - minimum / unit) / (maximum / unit - minimum / unit);
    },
    ticks: ticks.map(({ fraction, value }) => {
      return {
        fraction,
        label:
          scale === 'temporal'
            ? maximum - minimum < 86_400_000
              ? new Date(value).toISOString().replace('T', '\n')
              : new Date(value).toISOString().slice(0, 10)
            : numberLabel(value, precision),
      };
    }),
  };
}

function mergeOrdinalKeys(document, keys) {
  const following = new Map(keys.map((key) => [key, new Set()]));
  const preceding = new Map(keys.map((key) => [key, new Map()]));
  for (const series of document.series) {
    for (let index = 1; index < series.values.length; index += 1) {
      const before = series.values[index - 1].key;
      const after = series.values[index].key;
      following.get(before).add(after);
      preceding.get(after).set(before, series.id);
    }
  }
  const remaining = new Map(keys.map((key) => [key, preceding.get(key).size]));
  const ordered = [];
  while (ordered.length < keys.length) {
    const next = keys.find((key) => remaining.get(key) === 0);
    if (next === undefined) break;
    ordered.push(next);
    remaining.delete(next);
    for (const key of following.get(next)) remaining.set(key, remaining.get(key) - 1);
  }
  if (ordered.length !== keys.length) {
    let key = keys.find((candidate) => remaining.get(candidate) > 0);
    const visited = new Map();
    while (!visited.has(key)) {
      const [before, seriesId] = [...preceding.get(key)].find(
        ([candidate]) => remaining.get(candidate) > 0,
      );
      visited.set(key, { before, after: key, seriesId });
      key = before;
    }
    const { before, after, seriesId } = visited.get(key);
    invalid(
      document,
      `Conflicting ordinal key order in series ${seriesId}: ${JSON.stringify(before)} precedes ${JSON.stringify(after)}, but the series orders form a cycle. Use consistent key order across series.`,
      { seriesId, keys: [before, after] },
    );
  }
  return ordered;
}

/** Cartesian axes use declaration order; numeric scatter x values come from series keys. */
export function layoutCartesianChart(document, { wrapDiagramLabel }) {
  const kind = document.grammar.id;
  if (document.axes.length !== 2)
    invalid(document, `Expected two axes, received ${document.axes.length}.`);
  const [horizontal, vertical] = document.axes;
  if (!['linear', 'logarithmic'].includes(vertical.scale))
    invalid(document, `Unsupported vertical scale: ${vertical.scale}`, { axisId: vertical.id });
  if (kind === 'bar' && vertical.scale === 'logarithmic')
    invalid(document, 'Bar charts require a linear vertical scale to preserve the zero baseline.');
  const categorical = ['categorical', 'ordinal'].includes(horizontal.scale);
  if ((kind === 'bar' && !categorical) || (kind === 'scatter' && categorical))
    invalid(document, `Unsupported horizontal scale: ${horizontal.scale}`, {
      axisId: horizontal.id,
    });
  const count = document.series.reduce((total, series) => total + series.values.length, 0);
  if (count + document.nodes.length > 10_000)
    diagramFail(DIAGRAM_ERROR_CODES.RESOURCE_BUDGET_EXCEEDED, 'Chart exceeds 10000 data marks.', {
      count,
    });
  for (const series of document.series) {
    if (
      ['bar', 'line'].includes(kind) &&
      new Set(series.values.map(({ key }) => key)).size !== series.values.length
    )
      invalid(document, `Duplicate keys in series ${series.id}.`, { seriesId: series.id });
  }
  const firstAppearance = [
    ...new Set(document.series.flatMap(({ values }) => values.map(({ key }) => key))),
  ];
  const keys =
    horizontal.scale === 'ordinal' ? mergeOrdinalKeys(document, firstAppearance) : firstAppearance;
  const categories = new Map(keys.map((key, index) => [key, index]));
  const data = document.series.map((series) =>
    series.values.map(({ key, value }) => ({
      key,
      value,
      horizontal: categorical ? categories.get(key) : numericKey(document, key, horizontal.scale),
    })),
  );
  const yScale = domainScale(
    document,
    data.flat().map(({ value }) => value),
    vertical.scale,
    vertical.scale === 'linear',
  );
  const xScale = categorical
    ? null
    : domainScale(
        document,
        data.flat().map((item) => item.horizontal),
        horizontal.scale,
        false,
      );
  const style = { size: 13, glyph: 7 };
  const label = (id, text, x, y, anchor = 'middle') => {
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
  const xTicks = categorical
    ? keys.map((key, index) => ({ label: key, fraction: (index + 0.5) / keys.length }))
    : xScale.ticks;
  const widestCategory = Math.max(
    60,
    ...xTicks.map(({ label: text }) => label('', text, 0, 0).width),
  );
  const left = Math.ceil(
    110 + Math.max(...yScale.ticks.map(({ label: text }) => measureDiagramText(text, style))),
  );
  const top = 64;
  const plotWidth = Math.max(720, categorical ? keys.length * (widestCategory + 24) : 720);
  const plotHeight = 400;
  const bottom = top + plotHeight;
  const right = left + plotWidth;
  const x = (value) =>
    left +
    12 +
    (categorical ? (value + 0.5) / keys.length : xScale.position(value)) * (plotWidth - 24);
  const y = (value) => top + 12 + (1 - yScale.position(value)) * (plotHeight - 24);
  const emphasis = (id) => document.emphasis.find(({ targetId }) => targetId === id)?.level ?? null;
  const labelBounds = [];
  const axes = document.axes.map((axis, index) => {
    const ticks = (index === 0 ? xTicks : yScale.ticks).map((tick, tickIndex) => {
      const tx = index === 0 ? left + 12 + tick.fraction * (plotWidth - 24) : left;
      const ty = index === 0 ? bottom : top + 12 + (1 - tick.fraction) * (plotHeight - 24);
      const text = label(
        `${axis.id}-tick-${tickIndex}`,
        tick.label,
        index === 0 ? tx : tx - 14,
        index === 0 ? ty + 14 : ty - 9,
        index === 0 ? 'middle' : 'end',
      );
      labelBounds.push(text);
      return { x: tx, y: ty, text };
    });
    const tickHeight = Math.max(...ticks.map(({ text }) => text.height));
    const text = label(
      axis.id,
      axis.label,
      index === 0 ? (left + right) / 2 : 32,
      index === 0 ? bottom + tickHeight + 38 : 12,
      index === 0 ? 'middle' : 'start',
    );
    labelBounds.push(text);
    return {
      ...axis,
      x: index === 0 ? left : left - 1,
      y: top,
      width: index === 0 ? plotWidth : 1,
      height: plotHeight,
      x1: left,
      y1: index === 0 && yScale.spansZero ? y(0) : bottom,
      x2: index === 0 ? right : left,
      y2: index === 0 ? (yScale.spansZero ? y(0) : bottom) : top,
      ticks: Object.freeze(ticks.map(Object.freeze)),
      text,
      emphasis: emphasis(axis.id),
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
    if (kind === 'line') {
      const points = data[seriesIndex].map((item) => [x(item.horizontal), y(item.value)]);
      points.sort(([leftX], [rightX]) => leftX - rightX);
      const xs = points.map(([px]) => px),
        ys = points.map(([, py]) => py);
      marks.push({
        ...common,
        kind: 'polyline',
        points: Object.freeze(points.map(Object.freeze)),
        x: Math.min(...xs) - 3,
        y: Math.min(...ys) - 3,
        width: Math.max(...xs) - Math.min(...xs) + 6,
        height: Math.max(...ys) - Math.min(...ys) + 6,
      });
      continue;
    }
    for (const item of data[seriesIndex]) {
      const px = x(item.horizontal),
        py = y(item.value);
      if (kind === 'bar') {
        const slot = (plotWidth - 24) / keys.length;
        const seriesSlot = (slot * 0.7) / document.series.length;
        const width = seriesSlot * 0.9;
        const baseline = y(0);
        marks.push({
          ...common,
          kind: 'bar',
          key: item.key,
          value: item.value,
          x: px - slot * 0.35 + seriesIndex * seriesSlot + (seriesSlot - width) / 2,
          y: Math.min(py, baseline),
          width,
          height: Math.abs(baseline - py),
        });
      } else
        marks.push({
          ...common,
          kind: 'point',
          key: item.key,
          value: item.value,
          x: px - 5,
          y: py - 5,
          width: 10,
          height: 10,
        });
    }
  }
  if (kind === 'scatter')
    for (const node of document.nodes) {
      if (!node.semanticPosition) continue;
      const { horizontal: hx, vertical: vy } = node.semanticPosition;
      marks.push({
        id: node.id,
        label: node.label,
        kind: 'point',
        seriesIndex: document.series.length,
        emphasis: emphasis(node.id),
        x: left + 12 + hx * (plotWidth - 24) - 5,
        y: top + 12 + (1 - vy) * (plotHeight - 24) - 5,
        width: 10,
        height: 10,
      });
    }
  let legendY = Math.max(bottom + 100, ...labelBounds.map((text) => text.y + text.height + 24));
  const legend = document.series.map((series, seriesIndex) => {
    const text = label(series.id, series.label, left + 28, legendY, 'start');
    legendY += text.height + 16;
    labelBounds.push(text);
    return { ...text, seriesIndex };
  });
  return {
    kind: 'chart',
    width: Math.ceil(Math.max(right + 64, ...labelBounds.map((text) => text.x + text.width + 32))),
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
