import { sha256Hex } from '@openplanr/protocol/canonical-json';
import { validateDiagramAuthoringArtifact } from '@openplanr/protocol/diagram-authoring-contracts';
import { clone, inspectPlainData, sealBundle, snapshot, validateAuthoringBundle } from './authoring/model.mjs';

const MAX_BYTES = 65_536;
const ID = /^[A-Za-z][A-Za-z0-9_-]*$/u;
const SAFE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const HEADER = /^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)$/iu;
const DIRECTIONS = { TB: 'top-down', TD: 'top-down', BT: 'bottom-up', LR: 'left-right', RL: 'right-left' };
const REVERSE_DIRECTIONS = { 'top-down': 'TB', 'bottom-up': 'BT', 'left-right': 'LR', 'right-left': 'RL' };
const UNSAFE_TEXT = /%%\{|<\s*(?:script|iframe|foreignObject)\b|javascript:|https?:\/\//iu;
const SEMANTIC_EDIT_LOSS = 'Semantic content changed after this source correspondence was captured.';
const ENCODER = new TextEncoder();
const meta = kind => ({ kind, schemaVersion: '1.0.0', protocolVersion: '1.13.0' });
const digest = text => `sha256:${sha256Hex(text)}`;
const idFor = sourceId => sourceId.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-+$/gu, '');
const issue = (code, severity, line, column, range, message, repair, elementIds = []) => ({ code, severity, line, column, range, message, repair, elementIds });
const failure = diagnostic => ({ ok: false, sourceModified: false, diagnostics: [diagnostic] });
const plain = (value, fallback) => value === undefined ? fallback : value.startsWith('"') ? JSON.parse(value) : value;

function sourceLines(text) {
  const lines = [];
  let cursor = 0, byte = 0, number = 1;
  while (cursor < text.length) {
    let end = cursor;
    while (end < text.length && text[end] !== '\r' && text[end] !== '\n') end++;
    const newline = text.slice(end, end + (text.slice(end, end + 2) === '\r\n' ? 2 : end < text.length ? 1 : 0));
    const raw = text.slice(cursor, end);
    const leading = raw.match(/^\s*/u)[0];
    const trailing = raw.match(/\s*$/u)[0];
    const range = { startByte: byte + ENCODER.encode(leading).length, endByte: byte + ENCODER.encode(raw.slice(0, raw.length - trailing.length)).length };
    lines.push({ raw, text: raw.trim(), number, column: [...leading].length + 1, range });
    byte += ENCODER.encode(raw + newline).length;
    cursor = end + newline.length;
    number++;
  }
  return lines;
}

function parseLabel(raw, fallback) {
  if (raw === undefined) return fallback;
  const value = raw.trim();
  if (!value) return '';
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) return null;
    try { return plain(value, fallback); } catch { return null; }
  }
  return value;
}

function nodeExpression(raw) {
  const match = raw.trim().match(/^([A-Za-z][A-Za-z0-9_-]*)(.*)$/u);
  if (!match) return null;
  const [, sourceId, rest] = match;
  if (!rest.trim()) return { sourceId, label: sourceId, kind: 'process', shape: 'rectangle', declared: false };
  const expression = rest.trim();
  let shape, label;
  if (expression.startsWith('[(') && expression.endsWith(')]')) { shape = 'cylinder'; label = expression.slice(2, -2); }
  else if (expression.startsWith('[') && expression.endsWith(']')) { shape = 'rectangle'; label = expression.slice(1, -1); }
  else if (expression.startsWith('(') && expression.endsWith(')')) { shape = 'rounded-rectangle'; label = expression.slice(1, -1); }
  else if (expression.startsWith('{') && expression.endsWith('}')) { shape = 'diamond'; label = expression.slice(1, -1); }
  else return null;
  label = parseLabel(label, sourceId);
  if (label === null || label.length > 4096 || /[\u0000-\u001f]/u.test(label)) return null;
  return { sourceId, label, kind: shape === 'diamond' ? 'decision' : shape === 'cylinder' ? 'data-store' : 'process', shape, declared: true };
}

function parseEdge(line) {
  const match = line.match(/^(.*?)\s*(<-->|-->|---)\s*(?:\|([^|]+)\|\s*)?(.*?)$/u);
  if (!match) return null;
  const from = nodeExpression(match[1]), to = nodeExpression(match[4]);
  if (!from || !to) return null;
  const label = match[3] === undefined ? null : parseLabel(match[3], '');
  if (match[3] !== undefined && (label === null || label.length > 4096 || /[\u0000-\u001f]/u.test(label))) return null;
  return { from, to, label, direction: match[2] === '<-->' ? 'both' : match[2] === '-->' ? 'forward' : 'none' };
}

function placement(elementId, shape, bounds, zIndex, previous) {
  const old = previous?.presentation.elements.find(item => item.elementId === elementId);
  if (old && old.appearance.shape === shape && Boolean(old.bounds) === Boolean(bounds)) return clone(old);
  return {
    elementId, bounds, route: bounds ? null : { mode: 'automatic', strategy: 'straight', from: { side: 'bottom', offset: 0.5 }, to: { side: 'top', offset: 0.5 }, points: [] },
    label: null, zIndex, appearance: { shape, fill: shape === 'container' || shape === 'connector' ? 'transparent' : 'surface', stroke: 'default', strokeWidth: 2, strokeStyle: 'solid', fontSize: shape === 'connector' ? 14 : 16, textAlign: 'center' },
    locks: { position: false, size: false, route: false },
  };
}

/** Pure, bounded preview. The previous bundle and source are never changed. */
export function previewMermaidCopy(source, options = {}) {
  if (inspectPlainData(options).length || !options || Array.isArray(options) || Object.keys(options).some(key => !['diagramId', 'title', 'previousBundle'].includes(key))) return failure(issue('invalid-options', 'error', 1, 1, null, 'Options must be inert, known data fields.', 'Supply diagramId, title or previousBundle only.'));
  const { diagramId = 'imported-flowchart', previousBundle = null } = options;
  const title = options.title ?? previousBundle?.document?.title ?? 'Imported flowchart';
  if (typeof source !== 'string' || !SAFE_ID.test(diagramId) || diagramId.length > 128 || typeof title !== 'string' || title.length > 4096) return failure(issue('invalid-input', 'error', 1, 1, null, 'Provide bounded Mermaid text and a valid diagram ID.', 'Correct the input.'));
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(source)) return failure(issue('invalid-utf8', 'error', 1, 1, null, 'Unpaired UTF-16 surrogates cannot be retained as exact UTF-8.', 'Replace malformed characters.'));
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(source)) return failure(issue('invalid-control', 'error', 1, 1, null, 'Control characters are not certified Mermaid text.', 'Remove binary control characters.'));
  const byteLength = ENCODER.encode(source).length;
  if (byteLength > MAX_BYTES) return failure(issue('source-too-large', 'error', 1, 1, null, `Mermaid source exceeds ${MAX_BYTES} UTF-8 bytes.`, 'Use a smaller source.'));
  if (previousBundle) {
    const checked = validateAuthoringBundle(previousBundle);
    if (!checked.ok || previousBundle.diagramId !== diagramId) return failure(issue('invalid-previous-bundle', 'error', 1, 1, null, 'Previous correspondence must belong to this valid diagram.', 'Choose its current bundle.'));
  }
  const lines = sourceLines(source), diagnostics = [], entries = [], nodes = new Map(), groups = new Map(), edges = new Map(), stack = [];
  const previous = previousBundle && previousBundle.diagramId === diagramId ? previousBundle : null;
  const previousIds = new Map((previousBundle?.sourceMap?.entries ?? []).filter(entry => entry.sourceId && entry.elementIds.length === 1 && (entry.confidence === 'exact' || entry.losses.length > 0 && entry.losses.every(loss => loss === SEMANTIC_EDIT_LOSS))).map(entry => [entry.sourceId, entry.elementIds[0]]));
  const priorSemanticIds = new Set([...(previous?.document.nodes ?? []), ...(previous?.document.groups ?? [])].map(item => item.id));
  const used = new Map();
  let header = null;
  const reject = (code, line, message, repair, elementIds = []) => diagnostics.push(issue(code, 'error', line.number, line.column, line.range, message, repair, elementIds));
  const partial = (line, construct, message) => {
    diagnostics.push(issue(construct, 'warning', line.number, line.column, line.range, message, 'Remove this construct or keep the original source in the bundle.'));
    entries.push({ sourceId: null, elementIds: [], range: line.range, construct, confidence: 'ambiguous', losses: [message] });
  };
  const identity = (raw, line, type) => {
    if (!ID.test(raw) || raw.length > 128) { reject('invalid-source-id', line, 'Source ID is not a bounded explicit identifier.', 'Use a letter followed by letters, numbers, underscores or hyphens.'); return null; }
    const id = previousIds.get(raw) ?? idFor(raw);
    if (previousIds.has(raw) && previous && !(type === 'node' ? previous.document.nodes : previous.document.groups).some(item => item.id === id)) {
      reject('changed-source-role', line, `Source ID ${raw} changed from a node to a container or the reverse.`, 'Resolve this role change explicitly in the editor.'); return null;
    }
    if (!previousIds.has(raw) && priorSemanticIds.has(id)) {
      reject('unverified-identity', line, `New source ID ${raw} would silently reuse an existing diagram identity.`, 'Restore the original source ID or resolve the identity explicitly.'); return null;
    }
    if (!SAFE_ID.test(id) || id.length > 128 || (used.has(id) && used.get(id) !== raw)) {
      reject('source-id-collision', line, `Source ID ${raw} collides with another semantic identity.`, 'Rename one explicit source ID.'); return null;
    }
    used.set(id, raw);
    return id;
  };
  const addMember = (id, line) => {
    if (!stack.length) return;
    const parent = groups.get(stack.at(-1));
    if (!parent.members.includes(id)) parent.members.push(id);
    for (const group of groups.values()) if (group.id !== parent.id && group.members.includes(id)) reject('multiple-parents', line, 'One element occurs in multiple containers.', 'Give the element one parent.', [id]);
  };
  const addNode = (node, line) => {
    const id = identity(node.sourceId, line, 'node');
    if (!id) return null;
    if (groups.has(id)) { reject('source-id-collision', line, 'Node and subgraph share an identity.', 'Rename one source ID.', [id]); return null; }
    const current = nodes.get(id);
    if (current && node.declared && current.declared && (current.label !== node.label || current.shape !== node.shape)) reject('conflicting-node', line, 'Repeated node declaration changes its shape or label.', 'Use one declaration per explicit ID.', [id]);
    if (!current || (node.declared && !current.declared)) nodes.set(id, { ...node, id, line });
    addMember(id, line);
    if (!current) entries.push({ sourceId: node.sourceId, elementIds: [id], range: line.range, construct: node.shape === 'diamond' ? 'decision-node' : node.shape === 'cylinder' ? 'cylinder-node' : node.shape === 'rounded-rectangle' ? 'rounded-node' : 'rectangle-node', confidence: 'exact', losses: [] });
    else if (node.declared && !current.declared) {
      const entry = entries.find(item => item.sourceId === node.sourceId);
      entry.range = line.range;
      entry.construct = node.shape === 'diamond' ? 'decision-node' : node.shape === 'cylinder' ? 'cylinder-node' : node.shape === 'rounded-rectangle' ? 'rounded-node' : 'rectangle-node';
    }
    return id;
  };
  for (const line of lines) {
    if (/%%\{|<\s*(?:script|iframe|foreignObject)\b|javascript:|https?:\/\/|(?:^|\s)(?:click|href)\s+/iu.test(line.text)) { reject('unsafe-construct', line, 'Executable directives or external resources are not accepted.', 'Remove scripts, directives, callbacks and remote links.'); continue; }
    if (!line.text || line.text.startsWith('%%')) continue;
    if (!header) {
      const match = line.text.match(HEADER);
      if (!match) { reject('invalid-header', line, 'A certified flowchart must start with a direction header.', 'Start with flowchart TB, BT, LR or RL.'); continue; }
      header = DIRECTIONS[match[1].toUpperCase()];
      continue;
    }
    if (/^subgraph\s+/iu.test(line.text)) {
      const match = line.text.match(/^subgraph\s+([A-Za-z][A-Za-z0-9_-]*)(?:\s*\[(.*)\])?$/iu);
      if (!match) { reject('invalid-subgraph', line, 'Subgraph needs an explicit bounded ID and plain label.', 'Use subgraph ID[Label].'); continue; }
      const id = identity(match[1], line, 'group');
      if (!id) continue;
      if (nodes.has(id) || groups.has(id)) { reject('source-id-collision', line, 'Subgraph ID is already used.', 'Choose a unique ID.', [id]); continue; }
      const label = parseLabel(match[2], match[1]);
      if (label === null || label.length > 4096 || /[\u0000-\u001f]/u.test(label)) { reject('invalid-label', line, 'Subgraph label is invalid.', 'Use a bounded plain-text label.'); continue; }
      groups.set(id, { id, label, members: [], line });
      addMember(id, line);
      entries.push({ sourceId: match[1], elementIds: [id], range: line.range, construct: 'subgraph', confidence: 'exact', losses: [] });
      stack.push(id);
      continue;
    }
    if (/^end$/iu.test(line.text)) { if (!stack.length) reject('unmatched-end', line, 'Unmatched subgraph end.', 'Remove end or add a subgraph.'); else stack.pop(); continue; }
    const edge = parseEdge(line.text);
    if (edge) {
      const from = addNode(edge.from, line), to = addNode(edge.to, line);
      if (!from || !to) continue;
      const signature = JSON.stringify([from, to, edge.direction, edge.label]);
      const continuing = previous?.document.relations.filter(item => item.from === from && item.to === to && item.direction === edge.direction) ?? [];
      const sameLabel = continuing.filter(item => item.label === edge.label);
      const matches = sameLabel.length ? sameLabel : continuing;
      if (matches.length > 1) { reject('ambiguous-edge', line, 'Previous relations have indistinguishable endpoints and direction.', 'Resolve the relation identity in the editor.', matches.map(item => item.id)); continue; }
      const id = matches[0]?.id ?? `edge-${sha256Hex(signature).slice(0, 16)}`;
      if (edges.has(id) || used.has(id)) { reject('ambiguous-edge', line, 'Repeated or colliding edge has no stable distinct identity.', 'Remove the duplicate edge or model it explicitly in the editor.', [id]); continue; }
      used.set(id, `edge:${signature}`);
      edges.set(id, { id, from, to, label: edge.label, kind: edge.direction === 'none' ? 'association' : 'flow', direction: edge.direction, weight: null });
      entries.push({ sourceId: null, elementIds: [id], range: line.range, construct: edge.direction === 'both' ? 'bidirectional-edge' : edge.direction === 'none' ? 'undirected-edge' : 'directed-edge', confidence: 'exact', losses: [] });
      continue;
    }
    const node = nodeExpression(line.text);
    if (node) { addNode(node, line); continue; }
    if (/^(?:classDef|class|style|linkStyle|direction|%%\{|click|href)\b/iu.test(line.text)) partial(line, 'styles-and-directives', 'Unsupported Mermaid styling or directive.');
    else reject('malformed-statement', line, 'Statement is not valid certified Mermaid syntax.', 'Correct its node, edge or subgraph syntax.');
  }
  if (!header) diagnostics.push(issue('missing-header', 'error', 1, 1, null, 'No certified flowchart header was found.', 'Start with flowchart TB.'));
  if (stack.length) diagnostics.push(issue('unclosed-subgraph', 'error', lines.at(-1)?.number ?? 1, 1, null, 'A subgraph has no end.', 'Close every subgraph with end.'));
  if (!nodes.size) diagnostics.push(issue('empty-flowchart', 'error', 1, 1, null, 'No nodes can be adopted.', 'Add at least one supported node.'));
  const semanticIds = new Set([...nodes.keys(), ...groups.keys(), ...edges.keys()]);
  for (const annotation of previous?.document.annotations ?? []) {
    if (semanticIds.has(annotation.id) || annotation.targetId && !semanticIds.has(annotation.targetId)) diagnostics.push(issue('orphaned-authoring', 'error', 1, 1, null, `Authored annotation ${annotation.id} would be lost or collide with source.`, 'Resolve the annotation before importing.', [annotation.id]));
    else semanticIds.add(annotation.id);
  }
  for (const emphasis of previous?.document.emphasis ?? []) if (!semanticIds.has(emphasis.targetId)) diagnostics.push(issue('orphaned-authoring', 'error', 1, 1, null, `Authored emphasis on ${emphasis.targetId} would be lost.`, 'Resolve the emphasis before importing.', [emphasis.targetId]));
  if (diagnostics.some(item => item.severity === 'error')) return { ok: false, sourceModified: false, diagnostics };
  for (const group of groups.values()) {
    const prior = previous?.document.groups.find(item => item.id === group.id);
    for (const member of prior?.members ?? []) if (previous.document.annotations.some(item => item.id === member)) group.members.push(member);
  }
  const sourceDigest = digest(source);
  const document = {
    ...meta('planr-diagram'), diagramId, title, summary: previous?.document.summary ?? '', audience: previous?.document.audience ?? 'mixed', grammar: { id: 'flowchart', version: '1.0.0' },
    nodes: [...nodes.values()].map(({ id, label, kind }) => ({ id, label, kind, description: previous?.document.nodes.find(item => item.id === id)?.description ?? null })), relations: [...edges.values()],
    groups: [...groups.values()].map(({ id, label, members }) => ({ id, label, members })), lanes: [], events: [], series: [], axes: [], sets: [], annotations: [], emphasis: [], laneOrder: [],
    accessibility: { title, description: previous?.document.accessibility.description ?? '', readingOrder: [...nodes.keys()] }, documentDigest: '',
  };
  document.annotations = clone(previous?.document.annotations ?? []);
  document.emphasis = clone(previous?.document.emphasis ?? []);
  const groupElements = [...groups.keys()].map((id, i) => placement(id, 'container', { x: 24 + i * 24, y: 24 + i * 24, width: 720, height: 480 }, 0, previous));
  const nodeElements = [...nodes.values()].map((node, i) => placement(node.id, node.shape, { x: 80 + (i % 4) * 180, y: 80 + Math.floor(i / 4) * 120, width: 144, height: 72 }, 2, previous));
  const edgeElements = [...edges.keys()].map(id => placement(id, 'connector', null, 1, previous));
  const noteElements = document.annotations.map((annotation, i) => previous.presentation.elements.find(item => item.elementId === annotation.id) ?? placement(annotation.id, 'text', { x: 80 + i * 180, y: 560, width: 144, height: 72 }, 3));
  const presentation = { ...meta('diagram-presentation'), diagramId, semanticDigest: '', coordinateSystem: 'global-canvas', layout: { direction: header, detailTier: previous?.presentation.layout.detailTier ?? 'balanced' }, theme: clone(previous?.presentation.theme ?? { themeId: 'paper', mode: 'light' }), elements: [...groupElements, ...edgeElements, ...nodeElements, ...noteElements], presentationDigest: '' };
  const bundle = sealBundle({ ...meta('diagram-authoring-bundle'), diagramId, document, presentation, originalSource: { format: 'mermaid', text: source, sourceDigest }, sourceMap: { ...meta('diagram-source-map'), diagramId, semanticDigest: '', sourceDigest, sourceByteLength: byteLength, encoding: 'utf-8', parser: { id: 'openplanr-mermaid-copy', version: '1.0.0' }, certificationVersion: 'flowchart-copy-v1', entries }, bundleDigest: '' });
  const checked = validateAuthoringBundle(bundle);
  if (!checked.ok) return { ok: false, sourceModified: false, diagnostics: checked.diagnostics.map(item => issue(item.rule, 'error', 1, 1, null, item.detail, 'Correct the source or previous bundle.')) };
  const losses = diagnostics.filter(item => item.severity === 'warning').map(item => ({ dimension: 'semantic', code: item.code, elementIds: item.elementIds, message: item.message.slice(0, 512) }));
  const layoutMessage = 'Mermaid does not encode source coordinates; OpenPlanr generated or reused editable layout.';
  losses.push({ dimension: 'presentation', code: 'generated-layout', elementIds: [], message: layoutMessage });
  diagnostics.push(issue('generated-layout', 'warning', 1, 1, null, layoutMessage, 'Review the proposed layout before saving.'));
  const fidelity = { ...meta('diagram-fidelity-report'), diagramId, basis: snapshot(bundle), sourceDigest, sourceFormat: 'mermaid', targetFormat: 'planr-diagram-bundle', semantic: losses.some(item => item.dimension === 'semantic') ? 'partial' : 'lossless', presentation: 'partial', sourceText: 'lossless', losses };
  const reportIssues = validateDiagramAuthoringArtifact('diagram-fidelity-report', fidelity, { bundle });
  if (reportIssues.length) return { ok: false, sourceModified: false, diagnostics: reportIssues.map(item => issue(item.rule, 'error', 1, 1, null, item.detail, 'Correct the source or previous bundle.')) };
  const acknowledgement = losses.length ? digest(JSON.stringify({ bundleDigest: bundle.bundleDigest, losses })) : null;
  return { ok: true, bundle, fidelity, diagnostics, requiresAcknowledgement: Boolean(acknowledgement), acknowledgement, sourceModified: false };
}

/** Acknowledgement is bound to this exact preview, not to the source name or a prior attempt. */
export function adoptMermaidCopy(preview, acknowledgement = null) {
  if (inspectPlainData(preview).length) return failure(issue('invalid-preview', 'error', 1, 1, null, 'Preview must be inert data.', 'Preview the source again.'));
  if (!preview?.ok || !preview.bundle || !validateAuthoringBundle(preview.bundle).ok) return failure(issue('invalid-preview', 'error', 1, 1, null, 'A valid preview is required.', 'Preview the source again.'));
  if (validateDiagramAuthoringArtifact('diagram-fidelity-report', preview.fidelity, { bundle: preview.bundle }).length) return failure(issue('invalid-fidelity', 'error', 1, 1, null, 'The preview fidelity report changed.', 'Preview the source again.'));
  const expected = preview.fidelity.losses.length ? digest(JSON.stringify({ bundleDigest: preview.bundle.bundleDigest, losses: preview.fidelity.losses })) : null;
  if (expected !== preview.acknowledgement || expected !== acknowledgement) return failure(issue('acknowledgement-required', 'error', 1, 1, null, 'Acknowledge the exact losses in this preview.', 'Review the fidelity report and confirm this preview.'));
  return { ok: true, bundle: clone(preview.bundle), sourceModified: false };
}

function sourceIds(bundle) {
  const ids = new Map();
  for (const entry of bundle.sourceMap?.entries ?? []) if (entry.sourceId && entry.elementIds.length === 1 && ID.test(entry.sourceId)) ids.set(entry.elementIds[0], entry.sourceId);
  return ids;
}

/** Canonical Mermaid copy; the complete bundle remains the editable source of truth. */
export function exportMermaidCopy(bundle) {
  const checked = validateAuthoringBundle(bundle);
  if (!checked.ok) return { ok: false, diagnostics: checked.diagnostics.map(item => issue(item.rule, 'error', 1, 1, null, item.detail, 'Use a valid editable bundle.')) };
  if (bundle.document.grammar.id !== 'flowchart') return failure(issue('unsupported-grammar', 'error', 1, 1, null, 'Only flowchart copy export is certified.', 'Export the editable bundle instead.'));
  const ids = sourceIds(bundle), diagnostics = [], losses = [];
  const lost = (dimension, code, elementIds, message) => { losses.push({ dimension, code, elementIds, message }); diagnostics.push(issue(code, 'warning', 1, 1, null, message, 'Keep the editable bundle for complete fidelity.', elementIds)); };
  const names = new Map(), occupied = new Set();
  for (const entry of [...bundle.document.nodes, ...bundle.document.groups]) {
    const name = ids.get(entry.id) ?? entry.id.replace(/-/gu, '_');
    if (!ID.test(name) || occupied.has(name)) return failure(issue('unrepresentable-id', 'error', 1, 1, null, `Element ${entry.id} has no unique Mermaid ID.`, 'Rename the source ID or use the editable bundle.', [entry.id]));
    names.set(entry.id, name); occupied.add(name);
  }
  const byParent = new Map();
  for (const group of bundle.document.groups) for (const member of group.members) byParent.set(member, group.id);
  const placements = new Map(bundle.presentation.elements.map(item => [item.elementId, item]));
  const safeLabel = (value, id) => {
    if (!UNSAFE_TEXT.test(value)) return JSON.stringify(value);
    lost('semantic', 'unsafe-label', [id], `Element ${id} has text that cannot safely be emitted as certified Mermaid.`);
    return JSON.stringify('Label omitted in Mermaid copy');
  };
  const nodeText = node => {
    const shape = placements.get(node.id)?.appearance.shape;
    const label = safeLabel(node.label, node.id);
    if (node.kind === 'process' && shape === 'rectangle') return `${names.get(node.id)}[${label}]`;
    if (node.kind === 'process' && shape === 'rounded-rectangle') return `${names.get(node.id)}(${label})`;
    if (node.kind === 'decision' && shape === 'diamond') return `${names.get(node.id)}{${label}}`;
    if (node.kind === 'data-store' && shape === 'cylinder') return `${names.get(node.id)}[(${label})]`;
    lost('semantic', 'unsupported-node-shape', [node.id], `Node ${node.id} has a role or shape outside certified Mermaid flowchart copy.`);
    return `${names.get(node.id)}[${label}]`;
  };
  const lines = [`flowchart ${REVERSE_DIRECTIONS[bundle.presentation.layout.direction]}`];
  const append = (parent, depth) => {
    for (const group of bundle.document.groups.filter(item => (byParent.get(item.id) ?? null) === parent)) {
      lines.push(`${'  '.repeat(depth)}subgraph ${names.get(group.id)}[${safeLabel(group.label, group.id)}]`);
      append(group.id, depth + 1);
      lines.push(`${'  '.repeat(depth)}end`);
    }
    for (const node of bundle.document.nodes.filter(item => (byParent.get(item.id) ?? null) === parent)) lines.push(`${'  '.repeat(depth)}${nodeText(node)}`);
  };
  append(null, 1);
  for (const edge of bundle.document.relations) {
    const op = edge.kind === 'flow' && edge.direction === 'forward' ? '-->' : edge.kind === 'flow' && edge.direction === 'both' ? '<-->' : edge.kind === 'association' && edge.direction === 'none' ? '---' : null;
    if (!op) { lost('semantic', 'unsupported-relation', [edge.id], `Relation ${edge.id} has a role or direction outside certified Mermaid flowchart copy.`); continue; }
    if (edge.label?.includes('|') || edge.label && UNSAFE_TEXT.test(edge.label)) lost('semantic', 'unsupported-edge-label', [edge.id], `Relation ${edge.id} has text that certified Mermaid edge labels cannot represent safely.`);
    const label = edge.label === null || edge.label.includes('|') || UNSAFE_TEXT.test(edge.label) ? '' : `|${JSON.stringify(edge.label)}|`;
    lines.push(`  ${names.get(edge.from)} ${op}${label} ${names.get(edge.to)}`);
  }
  if (bundle.document.lanes.length) lost('semantic', 'lanes', bundle.document.lanes.map(item => item.id), 'Mermaid subgraphs do not preserve lane semantics or order.');
  if (bundle.document.annotations.length) lost('semantic', 'annotations', bundle.document.annotations.map(item => item.id), 'Mermaid flowcharts do not preserve OpenPlanr annotations.');
  if (bundle.document.emphasis.length) lost('semantic', 'emphasis', bundle.document.emphasis.map(item => item.targetId), 'Mermaid flowcharts do not preserve OpenPlanr emphasis.');
  if (bundle.presentation.elements.length) lost('presentation', 'manual-geometry', [], 'Mermaid copy does not preserve coordinates, routes, attachment points, stacking or locks.');
  lost('sourceText', 'canonical-copy', [], 'Canonical Mermaid formatting differs from the retained original source bytes.');
  const fidelity = { ...meta('diagram-fidelity-report'), diagramId: bundle.diagramId, basis: snapshot(bundle), sourceDigest: bundle.originalSource?.sourceDigest ?? null, sourceFormat: 'planr-diagram-bundle', targetFormat: 'mermaid', semantic: losses.some(item => item.dimension === 'semantic') ? 'partial' : 'lossless', presentation: 'partial', sourceText: 'partial', losses };
  const reportIssues = validateDiagramAuthoringArtifact('diagram-fidelity-report', fidelity, { bundle });
  if (reportIssues.length) return { ok: false, diagnostics: reportIssues.map(item => issue(item.rule, 'error', 1, 1, null, item.detail, 'Use a valid editable bundle.')) };
  return { ok: true, text: `${lines.join('\n')}\n`, fidelity, diagnostics, bundleUnchanged: true };
}
