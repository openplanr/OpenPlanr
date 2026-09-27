import { parseFragment } from 'parse5';
import { DIAGRAM_ADAPTIVE_STYLE_PATTERN } from '../diagram/rendering/theme.mjs';
import { escapeHtml } from '../internal/escape.mjs';

/** The parse5 node fields the sanitizer reads; text and element nodes carry different ones. */
interface MarkupNode {
  nodeName: string;
  tagName?: string;
  namespaceURI?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string; namespace?: string; prefix?: string }>;
  childNodes?: MarkupNode[];
}
/** A labelled drawing element the studio lists and focuses. */
export interface DiagramSvgItem {
  id: string;
  label: string;
  kind: 'Section' | 'Group' | 'Lane' | 'Connection' | 'Note' | 'Item';
  x: number;
  y: number;
}

const TAGS = new Set([
  'svg',
  'g',
  'title',
  'desc',
  'defs',
  'marker',
  'path',
  'rect',
  'line',
  'text',
  'tspan',
  'circle',
  'ellipse',
  'polyline',
  'polygon',
]);
const ATTRS = new Set([
  'xmlns',
  'id',
  'role',
  'aria-labelledby',
  'aria-label',
  'viewBox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'rx',
  'ry',
  'cx',
  'cy',
  'r',
  'd',
  'points',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'opacity',
  'marker-end',
  'markerWidth',
  'markerHeight',
  'refX',
  'refY',
  'orient',
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'fill-opacity',
  'data-item-id',
  'data-relation-id',
  'data-phase-id',
  'data-lifeline-id',
  'data-annotation-id',
  'data-target-id',
  'data-group-id',
  'data-lane-id',
  'data-scene-id',
]);
const key = (value: string) => `diagram-content-${value}`;
const fail: () => never = () => {
  throw new Error('Diagram SVG contains unsupported or active markup. Rerender it with OpenPlanr.');
};
const attrs = (node: MarkupNode) =>
  Object.fromEntries((node.attrs ?? []).map((attr) => [attr.name, attr.value]));
// A text node always carries its value.
const text = (node: MarkupNode): string =>
  node.nodeName === '#text' ? (node.value as string) : (node.childNodes ?? []).map(text).join(' ');
// biome-ignore format: bundles keep this one-line arrow; wrapping would change their bytes.
const number = (value: unknown, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/** Rebuild a passive SVG allowlist before it enters the trusted parent DOM.
 * Use the verified output, so scene-owned edits and older renders keep their pixels. */
export function prepareDiagramSvg(bytes: string) {
  if (Buffer.byteLength(bytes, 'utf8') > 10 * 1024 * 1024) fail();
  const fragment = parseFragment(bytes);
  const roots: MarkupNode[] = fragment.childNodes.filter(
    (node: MarkupNode) => node.nodeName !== '#text' || (node.value as string).trim(),
  );
  if (roots.length !== 1 || roots[0].tagName !== 'svg') fail();
  const root = roots[0],
    dimensions = attrs(root).viewBox?.trim().split(/\s+/).map(Number);
  if (
    dimensions?.length !== 4 ||
    dimensions.some((value) => !Number.isFinite(value)) ||
    dimensions[0] !== 0 ||
    dimensions[1] !== 0 ||
    dimensions.slice(2).some((value) => value <= 0 || value > 16384)
  )
    fail();
  const items: DiagramSvgItem[] = [];
  let nodes = 0;
  function serialize(node: MarkupNode, depth = 0): string {
    if (++nodes > 50000 || depth > 64) fail();
    if (node.nodeName === '#text') return escapeHtml(node.value);
    // Only the renderer's own dark-scheme remap is passive. A stylesheet inside
    // inline SVG would reach the host document, and the presentation attributes
    // already carry the light rendering, so even that one is dropped.
    if (node.tagName === 'style') {
      if (
        node.namespaceURI !== 'http://www.w3.org/2000/svg' ||
        (node.attrs ?? []).length > 0 ||
        !DIAGRAM_ADAPTIVE_STYLE_PATTERN.test(text(node))
      )
        fail();
      return '';
    }
    // Set.has accepts only its element type; a text node has no tag and fails the check.
    // biome-ignore format: bundles keep this one-line statement; wrapping would change their bytes.
    if (!TAGS.has(node.tagName as string) || node.namespaceURI !== 'http://www.w3.org/2000/svg') fail();
    const values = attrs(node);
    const fields = (node.attrs ?? []).map((attr) => {
      if (!ATTRS.has(attr.name) || (attr.namespace && attr.name !== 'xmlns') || attr.prefix) fail();
      if (attr.name === 'xmlns' && attr.value !== 'http://www.w3.org/2000/svg') fail();
      let value = attr.value;
      if (attr.name === 'id') value = key(value);
      if (attr.name === 'aria-labelledby') value = value.split(/\s+/).map(key).join(' ');
      if (['fill', 'stroke', 'marker-end'].includes(attr.name) && /url\s*\(/i.test(value)) {
        const match = /^url\(#([A-Za-z0-9_.:-]+)\)$/.exec(value);
        if (!match) fail();
        value = `url(#${key(match[1])})`;
      }
      return `${attr.name}="${escapeHtml(value)}"`;
    });
    const identity = [
      'data-phase-id',
      'data-group-id',
      'data-lane-id',
      'data-item-id',
      'data-relation-id',
      'data-annotation-id',
      'data-scene-id',
    ].find((name) => values[name]);
    const label =
      text(node).trim().replace(/\s+/g, ' ') ||
      (identity === 'data-relation-id' ? `Connection ${values[identity]}` : '');
    if (identity && label) {
      // includes accepts only its element type; a child without a tag simply does not match.
      // biome-ignore format: bundles keep this one-line call; wrapping would change their bytes.
      const shape =
        (node.childNodes ?? []).find((child) => ['rect', 'line', 'path'].includes(child.tagName as string)) ??
        node;
      const geometry = attrs(shape);
      // The `?.length` checks below also handle a missing path; TypeScript rejects comparing
      // undefined with a number, which JavaScript evaluates to false.
      const pathPoints = geometry.d?.match(/-?\d+(?:\.\d+)?/g)?.map(Number) as number[];
      const x =
        shape.tagName === 'path' && pathPoints?.length >= 4
          ? (pathPoints[0] + pathPoints[2]) / 2
          : shape.tagName === 'line'
            ? (number(geometry.x1) + number(geometry.x2)) / 2
            : number(geometry.x) + number(geometry.width) / 2;
      const y =
        shape.tagName === 'path' && pathPoints?.length >= 4
          ? (pathPoints[1] + pathPoints[3]) / 2
          : number(geometry.y ?? geometry.y1) + number(geometry.height) / 2;
      items.push({
        id: values[identity],
        label,
        kind:
          identity === 'data-phase-id'
            ? 'Section'
            : identity === 'data-group-id'
              ? 'Group'
              : identity === 'data-lane-id'
                ? 'Lane'
                : identity === 'data-relation-id'
                  ? 'Connection'
                  : identity === 'data-annotation-id'
                    ? 'Note'
                    : 'Item',
        x,
        y,
      });
    }
    return `<${node.tagName} ${fields.join(' ')}>${(node.childNodes ?? []).map((child) => serialize(child, depth + 1)).join('')}</${node.tagName}>`;
  }
  const svg = serialize(root);
  const order: Record<string, number> = { Section: 0, Group: 1, Item: 2, Connection: 3, Note: 4 };
  items.sort((a, b) => order[a.kind] - order[b.kind]);
  return { svg, scene: { width: dimensions[2], height: dimensions[3] }, items };
}
