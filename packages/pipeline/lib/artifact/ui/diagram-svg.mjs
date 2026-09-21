import { parseFragment } from 'parse5';
import { escapeHtml } from '../internal/escape.mjs';

const TAGS = new Set(['svg', 'g', 'title', 'desc', 'defs', 'marker', 'path', 'rect', 'line', 'text', 'tspan', 'circle', 'ellipse', 'polyline', 'polygon']);
const ATTRS = new Set(['xmlns', 'id', 'role', 'aria-labelledby', 'aria-label', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'rx', 'ry', 'cx', 'cy', 'r', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'marker-end', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-anchor', 'dominant-baseline', 'fill-opacity', 'data-item-id', 'data-relation-id', 'data-phase-id', 'data-lifeline-id', 'data-annotation-id', 'data-target-id', 'data-group-id', 'data-lane-id', 'data-scene-id']);
const key = value => `diagram-content-${value}`;
const fail = () => { throw new Error('Diagram SVG contains unsupported or active markup. Rerender it with OpenPlanr.'); };
const attrs = node => Object.fromEntries((node.attrs ?? []).map(attr => [attr.name, attr.value]));
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(text).join(' ');
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

/** Rebuild a passive SVG allowlist before it enters the trusted parent DOM.
 * Use the verified output, so scene-owned edits and older renders keep their pixels. */
export function prepareDiagramSvg(bytes) {
  if (Buffer.byteLength(bytes, 'utf8') > 10 * 1024 * 1024) fail();
  const fragment = parseFragment(bytes);
  const roots = fragment.childNodes.filter(node => node.nodeName !== '#text' || node.value.trim());
  if (roots.length !== 1 || roots[0].tagName !== 'svg') fail();
  const root = roots[0], dimensions = attrs(root).viewBox?.trim().split(/\s+/).map(Number);
  if (dimensions?.length !== 4 || dimensions.some(value => !Number.isFinite(value)) || dimensions[0] !== 0 || dimensions[1] !== 0 || dimensions.slice(2).some(value => value <= 0 || value > 16384)) fail();
  const items = []; let nodes = 0;
  function serialize(node, depth = 0) {
    if (++nodes > 50000 || depth > 64) fail();
    if (node.nodeName === '#text') return escapeHtml(node.value);
    if (!TAGS.has(node.tagName) || node.namespaceURI !== 'http://www.w3.org/2000/svg') fail();
    const values = attrs(node);
    const fields = (node.attrs ?? []).map(attr => {
      if (!ATTRS.has(attr.name) || (attr.namespace && attr.name !== 'xmlns') || attr.prefix) fail();
      if (attr.name === 'xmlns' && attr.value !== 'http://www.w3.org/2000/svg') fail();
      let value = attr.value;
      if (attr.name === 'id') value = key(value);
      if (attr.name === 'aria-labelledby') value = value.split(/\s+/).map(key).join(' ');
      if (['fill', 'stroke', 'marker-end'].includes(attr.name) && /url\s*\(/i.test(value)) {
        const match = /^url\(#([A-Za-z0-9_.:-]+)\)$/.exec(value); if (!match) fail();
        value = `url(#${key(match[1])})`;
      }
      return `${attr.name}="${escapeHtml(value)}"`;
    });
    const identity = ['data-phase-id', 'data-group-id', 'data-lane-id', 'data-item-id', 'data-relation-id', 'data-annotation-id', 'data-scene-id'].find(name => values[name]);
    const label = text(node).trim().replace(/\s+/g, ' ') || (identity === 'data-relation-id' ? `Connection ${values[identity]}` : '');
    if (identity && label) {
      const shape = (node.childNodes ?? []).find(child => ['rect','line','path'].includes(child.tagName)) ?? node;
      const geometry = attrs(shape);
      const pathPoints = geometry.d?.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
      const x = shape.tagName === 'path' && pathPoints?.length >= 4 ? (pathPoints[0] + pathPoints[2]) / 2 : shape.tagName === 'line' ? (number(geometry.x1) + number(geometry.x2)) / 2 : number(geometry.x) + number(geometry.width) / 2;
      const y = shape.tagName === 'path' && pathPoints?.length >= 4 ? (pathPoints[1] + pathPoints[3]) / 2 : number(geometry.y ?? geometry.y1) + number(geometry.height) / 2;
      items.push({ id:values[identity], label, kind:identity === 'data-phase-id' ? 'Section' : identity === 'data-group-id' ? 'Group' : identity === 'data-lane-id' ? 'Lane' : identity === 'data-relation-id' ? 'Connection' : identity === 'data-annotation-id' ? 'Note' : 'Item', x, y });
    }
    return `<${node.tagName} ${fields.join(' ')}>${(node.childNodes ?? []).map(child => serialize(child, depth + 1)).join('')}</${node.tagName}>`;
  }
  const svg = serialize(root);
  const order = { Section: 0, Group: 1, Item: 2, Connection: 3, Note: 4 };
  items.sort((a, b) => order[a.kind] - order[b.kind]);
  return { svg, scene:{width:dimensions[2],height:dimensions[3]}, items };
}
