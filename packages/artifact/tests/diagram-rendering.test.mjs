import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Resvg } from '@resvg/resvg-js';

import { assertProtocolArtifact } from '@openplanr/protocol/contracts';

import {
  checkDiagram,
  DIAGRAM_ERROR_CODES,
  createDiagramDocument,
  exportDiagramExcalidraw,
  exportDiagramMermaid,
  importMermaid,
  inspectDiagram,
  inspectDiagramPng,
  layoutDiagram,
  MAX_DIAGRAM_SCENE_EXTENT,
  planDiagramQuality,
  renderDiagram,
  renderDiagramOutputs,
  renderDiagramSvg,
  rerenderDiagram,
  validateDiagramSvg,
} from '../lib/artifact/diagram/index.mjs';
import { prepareDiagramSvg } from '../lib/artifact/ui/diagram-svg.mjs';
import {
  cleanupAbandonedDiagramStages,
  recoverInterruptedDiagramPromotion,
} from '../lib/artifact/diagram/custody/index.mjs';
import { createRenderQualityReport } from '../lib/artifact/diagram/rendering/reports.mjs';
import { renderExcalidrawSceneSvg } from '../lib/artifact/diagram/projection/excalidraw.mjs';

const packageRoot = resolve(import.meta.dirname, '..');
const fixture = (grammarId) => JSON.parse(readFileSync(
  join(packageRoot, 'fixtures', 'diagram', 'grammars', `${grammarId}.planr-diagram.json`),
  'utf8',
));

async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'openplanr-diagram-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function diagramDirectory(root, slug) {
  return join(root, 'diagrams', slug);
}

async function readManifest(root, slug) {
  return JSON.parse(await readFile(join(await diagramDirectory(root, slug), `${slug}.manifest.json`), 'utf8'));
}

async function snapshotDirectory(directory) {
  const result = new Map();
  for (const name of (await readdir(directory)).sort()) result.set(name, await readFile(join(directory, name)));
  return result;
}

function connectedFlowchart(diagramId = 'connected-flowchart') {
  return importMermaid(
    'flowchart LR\nintake[Capture request] --> review{Ready to render?}\nreview -->|yes| publish[Publish offline assets]',
    {
      diagramId,
      title: 'Connected flowchart',
      summary: 'A complete source-to-render vertical slice with semantic edges.',
    },
  ).document;
}

function dependencyFlowchart(direction) {
  const base = connectedFlowchart('dependency-flowchart');
  const definitions = [
    ['observe', 'Observe release'], ['backend', 'Backend change'], ['request', 'Change request'],
    ['deploy', 'Deploy'], ['docs', 'Documentation'], ['schema', 'Protocol schema'],
    ['release', 'Release'], ['frontend', 'Frontend change'], ['approve', 'Approve'],
    ['tests', 'Verification'], ['auth', 'Authorization'], ['review', 'Engineering review'],
  ];
  const nodes = definitions.map(([id, label]) => ({ id, label, kind: 'step', description: null, semanticPosition: null }));
  const paths = [
    ['request', 'schema'], ['request', 'auth'], ['request', 'frontend'], ['request', 'docs'],
    ['schema', 'backend'], ['auth', 'backend'], ['schema', 'tests'], ['frontend', 'tests'],
    ['backend', 'tests'], ['docs', 'review'], ['tests', 'review'], ['request', 'review'],
    ['review', 'approve'], ['approve', 'deploy'], ['deploy', 'release'], ['release', 'observe'],
  ];
  const relations = paths.map(([from, to], index) => ({ id: `dependency-${index + 1}`, from, to,
    kind: 'dependency', label: `${from} to ${to}`, weight: null }));
  return createDiagramDocument({
    ...base,
    diagramId: `dependency-flowchart-${direction}`,
    title: 'Engineering change dependency flow',
    summary: 'Branches, fan-in, and skip dependencies retain their topology.',
    layout: { ...base.layout, direction },
    nodes,
    relations,
    accessibility: {
      title: 'Engineering change dependency flow',
      description: 'A change request progresses through parallel engineering work, review, deployment, and observation.',
      readingOrder: [...nodes.map(({ id }) => id), ...relations.map(({ id }) => id)],
    },
  });
}

function directedRing(size, direction = 'left-right') {
  const nodes = Array.from({ length: size }, (_, index) => ({
    id: `node-${index + 1}`, label: `Step ${index + 1}`, kind: 'step', description: null, semanticPosition: null,
  }));
  const relations = nodes.map((node, index) => ({
    id: `rel-${index + 1}`, from: node.id, to: nodes[(index + 1) % size].id, kind: 'flow', label: `to ${(index + 1) % size + 1}`, weight: null,
  }));
  return createDiagramDocument({
    diagramId: `ring-${size}-${direction}`,
    title: `Ring of ${size}`,
    summary: 'One strongly connected component containing every node.',
    audience: 'mixed',
    grammar: { id: 'flowchart', version: '1.0.0' },
    layout: { direction, detailTier: 'balanced' },
    theme: { themeId: 'openplanr-default', mode: 'auto' },
    source: { format: 'english', path: null, digest: null },
    nodes,
    relations,
    accessibility: {
      title: `Ring of ${size}`,
      description: 'Each step flows to the next and the last step returns to the first.',
      readingOrder: [...nodes.map(({ id }) => id), ...relations.map(({ id }) => id)],
    },
  });
}

function muviSequence(diagramId = 'muvi-apply-crm-flow') {
  const participants = [
    ['applicant', 'Applicant'],
    ['muvi-apply', 'MUVi Apply'],
    ['crm', 'CRM'],
    ['apply-ops', 'Apply operations'],
  ].map(([id, label]) => ({
    id,
    label,
    kind: 'participant',
    description: null,
    semanticPosition: null,
  }));
  const messages = [
    ['open', 'applicant', 'muvi-apply', 'Open application'],
    ['verify', 'applicant', 'muvi-apply', 'Verify email'],
    ['complete', 'applicant', 'muvi-apply', 'Complete application details'],
    ['create-lead', 'muvi-apply', 'crm', 'Create applicant lead'],
    ['sync-details', 'muvi-apply', 'crm', 'Sync programme and citizenship details'],
    ['submit', 'applicant', 'muvi-apply', 'Submit application'],
    ['create-application', 'muvi-apply', 'crm', 'Create application record'],
    ['notify', 'crm', 'apply-ops', 'Notify admissions operations'],
    ['confirm', 'muvi-apply', 'applicant', 'Show submission confirmation'],
  ].map(([id, from, to, label]) => ({ id, from, to, kind: 'message', label, weight: null }));
  const events = [
    ['sign-up', 'Sign up'],
    ['application', 'Application details'],
    ['submission', 'Submission'],
    ['follow-up', 'Admissions follow-up'],
  ].map(([id, label], order) => ({ id, label, order, at: null }));
  return createDiagramDocument({
    diagramId,
    title: 'MUVi Apply to CRM flow',
    summary: 'How an applicant journey becomes an actionable CRM record.',
    audience: 'mixed',
    grammar: { id: 'sequence', version: '1.0.0' },
    layout: { direction: 'left-right', detailTier: 'balanced' },
    theme: { themeId: 'openplanr-default', mode: 'auto' },
    source: { format: 'english', path: null, digest: null },
    nodes: participants,
    relations: messages,
    events,
    annotations: [
      { id: 'submission-note', text: 'Submission is the ownership boundary.', targetId: 'create-application' },
      { id: 'ops-note', text: 'Admissions continues from the CRM work queue.', targetId: 'apply-ops' },
    ],
    emphasis: [
      { targetId: 'muvi-apply', level: 'primary' },
      { targetId: 'create-application', level: 'primary' },
    ],
    accessibility: {
      title: 'MUVi Apply to CRM flow',
      description: 'A time-ordered sequence from applicant sign-up through admissions follow-up.',
      readingOrder: [
        'applicant', 'muvi-apply', 'crm', 'apply-ops',
        'sign-up', 'open', 'verify',
        'application', 'complete', 'create-lead', 'sync-details',
        'submission', 'submit', 'create-application', 'confirm',
        'follow-up', 'notify',
      ],
    },
  });
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(target));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(target);
  }
  return files;
}

function assertSnapshotEqual(left, right) {
  assert.deepEqual([...right.keys()], [...left.keys()]);
  for (const [name, bytes] of left) assert.ok(bytes.equals(right.get(name)), name);
}

test('offline flowchart rendering produces validated HTML, SVG, high-resolution PNG, reports, and manifest', async (t) => {
  const root = await temporaryRoot(t);
  const document = connectedFlowchart();
  const result = await renderDiagram(document, { outputRoot: root });
  assert.equal(result.status, 'created');
  assert.equal(result.outputCount, 11);
  const directory = await diagramDirectory(root, document.diagramId);
  const svg = await readFile(join(directory, `${document.diagramId}.svg`), 'utf8');
  const html = await readFile(join(directory, `${document.diagramId}.html`), 'utf8');
  const png = await readFile(join(directory, `${document.diagramId}.png`));
  assert.match(svg, /^<svg[^>]+role="img"/u);
  assert.doesNotMatch(svg, /<script\b|(?:href|src)=["']https?:/iu);
  assert.match(html, /Content-Security-Policy/u);
  assert.doesNotMatch(html, /<script\b|(?:href|src)=["']https?:/iu);
  const image = inspectDiagramPng(png);
  assert.ok(Math.min(image.width, image.height) >= 320);
  assert.ok(Math.max(image.width, image.height) >= 640);
  const manifest = await readManifest(root, document.diagramId);
  assertProtocolArtifact('diagram-manifest', manifest, { protocolVersion: '1.6.0' });
  assert.equal(manifest.outputs.length, 10);
  assert.equal(manifest.source.path, `diagrams/${document.diagramId}/${document.diagramId}.planr-diagram.json`);
  const scene = JSON.parse(await readFile(join(directory, `${document.diagramId}.excalidraw`), 'utf8'));
  assert.equal(scene.elements.filter(({ type }) => type === 'arrow').length, 2);
});

test('sequence rendering preserves chronology, prevents label collisions, and emits editable projections', () => {
  const document = muviSequence();
  const rendered = renderDiagramOutputs(document);
  assert.equal(rendered.scene.kind, 'sequence');
  assert.equal(rendered.scene.boxes.length, 4);
  assert.equal(rendered.scene.lifelines.length, 4);
  assert.equal(rendered.scene.phases.length, 4);
  assert.equal(rendered.scene.edges.length, 9);
  assert.equal(rendered.scene.notes.length, 2);
  assert.equal(new Set(rendered.scene.edges.map(({ y1 }) => y1)).size, 9);
  assert.equal(rendered.quality.status, 'pass');
  assert.match(
    rendered.quality.checks.find(({ id }) => id === 'label-overlap').message,
    /do not overlap/u,
  );
  assert.equal((rendered.svg.match(/data-lifeline-id=/gu) ?? []).length, 4);
  assert.equal((rendered.svg.match(/data-phase-id=/gu) ?? []).length, 4);
  assert.equal((rendered.svg.match(/data-relation-id=/gu) ?? []).length, 9);
  assert.equal((rendered.svg.match(/data-annotation-id=/gu) ?? []).length, 2);
  assert.match(rendered.html, /data-planr-diagram-studio="1"/u);

  const mermaid = exportDiagramMermaid(document);
  assert.equal(mermaid.report.status, 'partial');
  assert.match(mermaid.source, /^sequenceDiagram/mu);
  assert.equal((mermaid.source.match(/(?:-->>|->>)/gu) ?? []).length, 9);
  const imported = importMermaid(mermaid.source, {
    diagramId: 'muvi-sequence-round-trip',
    title: document.title,
    summary: document.summary,
  });
  assert.equal(imported.document.grammar.id, 'sequence');
  assert.equal(imported.document.nodes.length, 4);
  assert.equal(imported.document.relations.length, 9);
  assert.equal(imported.document.events.length, 4);

  const excalidraw = exportDiagramExcalidraw(document);
  assert.equal(excalidraw.report.status, 'editable');
  assert.equal(excalidraw.scene.elements.filter(({ id }) => id.startsWith('arrow-')).length, 9);
  assert.equal(excalidraw.scene.elements.filter(({ id }) => id.startsWith('lifeline-')).length, 4);
  assert.equal(excalidraw.scene.elements.filter(({ id }) => id.startsWith('phase-text-')).length, 4);
  assert.equal(excalidraw.scene.elements.filter(({ id }) => id.startsWith('note-') && !id.startsWith('note-text-')).length, 2);
});

test('graph rendering preserves semantic groups, annotations, and emphasis in the native studio surface', () => {
  const base = connectedFlowchart('grouped-flowchart');
  const document = createDiagramDocument({
    ...base,
    groups: [{ id: 'delivery-group', label: 'Delivery path', members: ['intake', 'review', 'publish'] }],
    annotations: [{ id: 'decision-note', text: 'A reviewer confirms readiness before publication.', targetId: 'review' }],
    emphasis: [
      { targetId: 'delivery-group', level: 'secondary' },
      { targetId: 'decision-note', level: 'primary' },
    ],
  });

  const rendered = renderDiagramOutputs(document);
  assert.equal(rendered.scene.groups.length, 1);
  assert.equal(rendered.scene.notes.length, 1);
  assert.equal(rendered.scene.groups[0].emphasis, 'secondary');
  assert.equal(rendered.scene.notes[0].emphasis, 'primary');
  assert.equal(rendered.quality.status, 'pass');
  assert.match(rendered.svg, /data-group-id="delivery-group"/u);
  assert.match(rendered.svg, /data-annotation-id="decision-note"/u);
  assert.match(rendered.svg, /data-target-id="review"/u);
});

test('quality reports fail clipped or missing semantic content and disclose unmeasured labels', () => {
  const document=muviSequence();
  const rendered=renderDiagramOutputs(document);
  const report=scene=>createRenderQualityReport(document,{scene,png:{width:100,height:100,byteLength:100},svgValidation:{ok:true,contrastRatio:21}});
  const clipped=report({...rendered.scene,boxes:rendered.scene.boxes.map((box,i)=>i===0?{...box,x:-20}:box)});
  assert.equal(clipped.status,'invalid');
  assert.equal(clipped.checks.find(check=>check.id==='rendered-clipping').status,'fail');
  const missing=report({...rendered.scene,phases:[],notes:[]});
  assert.equal(missing.status,'invalid');
  assert.match(missing.checks.find(check=>check.id==='semantic-coverage').message,/sign-up/);
  const unmeasured=report({...rendered.scene,labelBounds:[]});
  assert.equal(unmeasured.status,'warning');
  assert.equal(unmeasured.checks.find(check=>check.id==='label-overlap').status,'warning');
  const overlapping=report({...rendered.scene,labelBounds:[rendered.scene.labelBounds[0],{...rendered.scene.labelBounds[0],id:'collision'}]});
  assert.equal(overlapping.status,'invalid');
  assert.equal(overlapping.checks.find(check=>check.id==='label-overlap').status,'fail');
});

test('parallel and opposing graph connections retain distinct labels, routes, arrow directions, and editable geometry', () => {
  const fixtureDocument = JSON.parse(readFileSync(join(packageRoot, 'fixtures/diagram/regressions/parallel-opposing.planr-diagram.json'), 'utf8'));
  for (const direction of ['left-right', 'right-left', 'top-down', 'bottom-up']) {
    const document = createDiagramDocument({ ...fixtureDocument, layout: { ...fixtureDocument.layout, direction } });
    const rendered = renderDiagramOutputs(document);
    const { scene } = rendered;
    assert.equal(rendered.quality.status, 'pass', direction);
    assert.equal(scene.edges.length, document.relations.length);
    assert.equal(scene.labelBounds.length, document.relations.length);
    assert.equal(new Set(scene.edges.map(edge => JSON.stringify(edge.routePoints))).size, 4);
    assert.equal(new Set(scene.labelBounds.map(({ x, y }) => `${x},${y}`)).size, 4);
    assert.ok(scene.edges.every(edge => edge.labelLines.length > 1));
    const service = scene.boxes.find(box => box.id === 'service');
    const store = scene.boxes.find(box => box.id === 'store');
    assert.ok(direction === 'left-right' ? service.x < store.x
      : direction === 'right-left' ? service.x > store.x
        : direction === 'top-down' ? service.y < store.y : service.y > store.y, direction);
    const editable = exportDiagramExcalidraw(document).scene;
    const projectedSvg = renderExcalidrawSceneSvg(editable).svg;
    for (const svg of [rendered.svg, projectedSvg]) {
      const raster = new Resvg(svg).render();
      const pixels = raster.pixels;
      for (const edge of scene.edges) {
        assert.match(rendered.svg, new RegExp(`data-relation-id="${edge.id}"`));
        const points = edge.routePoints;
        const [endX, endY] = points.at(-1);
        const [previousX, previousY] = points.at(-2);
        const length = Math.hypot(endX - previousX, endY - previousY);
        const dx = (endX - previousX) / length;
        const dy = (endY - previousY) / length;
        // Sample off the line, inside the arrowhead immediately before the
        // target port. A fixed/right-facing marker fails reverse/up/down here.
        const x = Math.round(endX - dx * 8 - dy * 3);
        const y = Math.round(endY - dy * 8 + dx * 3);
        assert.ok(pixels[(y * raster.width + x) * 4] < 160, `${direction}: ${edge.id} arrow reaches its semantic target`);
      }
    }
    for (const edge of scene.edges) {
      const projected = editable.elements.find(({ id }) => id === `arrow-${edge.id}`);
      assert.deepEqual(projected.points.map(([x, y]) => [x + projected.x, y + projected.y]), edge.routePoints);
      assert.equal(projected.startBinding.elementId, `box-${edge.from}`);
      assert.equal(projected.endBinding.elementId, `box-${edge.to}`);
      const label = editable.elements.find(({ id }) => id === `label-${edge.id}`);
      assert.equal(label.text, edge.labelLines.join('\n'));
      assert.equal(label.x, edge.labelBounds.x);
      assert.equal(label.y, edge.labelBounds.y);
    }
  }
});

test('dependency graphs use topology-aware layers and route branches, fan-in, and skip edges without collisions', () => {
  for (const direction of ['left-right', 'right-left', 'top-down', 'bottom-up']) {
    const document = dependencyFlowchart(direction);
    const rendered = renderDiagramOutputs(document);
    assert.equal(rendered.quality.status, 'pass', direction);
    assert.equal(rendered.quality.checks.find(({ id }) => id === 'node-overlap').status, 'pass');
    assert.equal(rendered.quality.checks.find(({ id }) => id === 'edge-node-overlap').status, 'pass');
    assert.equal(rendered.quality.checks.find(({ id }) => id === 'label-overlap').status, 'pass');
    const boxes = new Map(rendered.scene.boxes.map((box) => [box.id, box]));
    for (const relation of document.relations) {
      const source = boxes.get(relation.from);
      const target = boxes.get(relation.to);
      const forward = direction === 'left-right' ? source.x < target.x
        : direction === 'right-left' ? source.x > target.x
          : direction === 'top-down' ? source.y < target.y : source.y > target.y;
      assert.equal(forward, true, `${direction}: ${relation.from} precedes ${relation.to}`);
    }
  }
});

test('a 500-node directed ring wraps into bands inside the viewport boundary with every node and relation intact', () => {
  for (const direction of ['left-right', 'top-down']) {
    const document = directedRing(500, direction);
    const { svg, scene } = renderDiagramSvg(document);
    assert.equal(renderDiagramSvg(document).svg, svg, `${direction}: deterministic bytes`);
    assert.ok(scene.width <= MAX_DIAGRAM_SCENE_EXTENT && scene.height <= MAX_DIAGRAM_SCENE_EXTENT, `${direction}: ${scene.width}x${scene.height}`);
    assert.ok(Math.max(scene.width, scene.height) / Math.min(scene.width, scene.height) < 1.5, `${direction}: balanced bands`);
    assert.equal(scene.boxes.length, 500);
    assert.equal(scene.edges.length, 500);
    assert.deepEqual(scene.boxes.map(({ label }) => label), document.nodes.map(({ label }) => label));
    assert.deepEqual(scene.edges.map(({ id, from, to }) => [id, from, to]), document.relations.map(({ id, from, to }) => [id, from, to]));
    assert.deepEqual(scene.edges.map(({ labelLines }) => labelLines.join(' ')), document.relations.map(({ label }) => label));
    const boxes = new Map(scene.boxes.map((box) => [box.id, box]));
    const onBorder = ([x, y], box) => (Math.abs(x - box.x) < 0.5 || Math.abs(x - box.x - box.width) < 0.5)
      ? y >= box.y && y <= box.y + box.height
      : (Math.abs(y - box.y) < 0.5 || Math.abs(y - box.y - box.height) < 0.5) && x >= box.x && x <= box.x + box.width;
    for (const edge of scene.edges) {
      assert.ok(onBorder(edge.routePoints[0], boxes.get(edge.from)), `${direction}: ${edge.id} leaves its source`);
      assert.ok(onBorder(edge.routePoints.at(-1), boxes.get(edge.to)), `${direction}: ${edge.id} reaches its target`);
    }
    const quality = createRenderQualityReport(document, {
      scene, png: { width: scene.width, height: scene.height, byteLength: 1 }, svgValidation: validateDiagramSvg(svg),
    });
    for (const id of ['svg-validated', 'node-overlap', 'label-overlap', 'label-node-overlap', 'edge-node-overlap', 'rendered-clipping', 'semantic-coverage']) {
      assert.equal(quality.checks.find((check) => check.id === id).status, 'pass', `${direction}: ${id}`);
    }
    const prepared = prepareDiagramSvg(svg);
    assert.deepEqual(prepared.scene, { width: scene.width, height: scene.height });
    assert.equal(prepared.items.filter(({ kind }) => kind === 'Item').length, 500);
    assert.equal(prepared.items.filter(({ kind }) => kind === 'Connection').length, 500);
  }
});

test('a small cycle keeps its single-band layout and layered graphs that cannot fit refuse with the budget error', () => {
  const rendered = renderDiagramOutputs(directedRing(8));
  assert.equal(rendered.quality.status, 'pass');
  assert.equal(rendered.scene.width, 2504);
  assert.equal(rendered.scene.height, 448);
  assert.equal(new Set(rendered.scene.boxes.map(({ y }) => y)).size, 1);
  const leaves = Array.from({ length: 120 }, (_, index) => ({
    id: `leaf-${index + 1}`, label: `Leaf ${index + 1}`, kind: 'step', description: null, semanticPosition: null,
  }));
  const base = directedRing(8);
  const star = createDiagramDocument({
    ...base,
    documentDigest: undefined,
    diagramId: 'wide-star',
    nodes: [{ id: 'hub', label: 'Hub', kind: 'step', description: null, semanticPosition: null }, ...leaves],
    relations: leaves.map((leaf, index) => ({ id: `spoke-${index + 1}`, from: 'hub', to: leaf.id, kind: 'flow', label: null, weight: null })),
    accessibility: { ...base.accessibility, readingOrder: ['hub', ...leaves.map(({ id }) => id)] },
  });
  assert.throws(() => layoutDiagram(star), (error) => error?.code === DIAGRAM_ERROR_CODES.RESOURCE_BUDGET_EXCEEDED
    && error.details.maximum === MAX_DIAGRAM_SCENE_EXTENT && error.details.height > MAX_DIAGRAM_SCENE_EXTENT);
  assert.throws(() => renderDiagramSvg(star), (error) => error?.code === DIAGRAM_ERROR_CODES.RESOURCE_BUDGET_EXCEEDED);
});

test('large split plans stay within the Protocol panel bounds and keep every primary item exactly once', () => {
  const document = directedRing(500);
  const report = planDiagramQuality(document);
  assertProtocolArtifact('diagram-quality-report', report, { protocolVersion: '1.6.0' });
  assert.equal(report.status, 'split-required');
  assert.deepEqual(planDiagramQuality(document).splitPlan, report.splitPlan);
  const { panels } = report.splitPlan;
  assert.ok(panels.length >= 2 && panels.length <= 32, `${panels.length} panels`);
  assert.ok(panels.every(({ itemIds }) => itemIds.length >= 1 && itemIds.length <= 256));
  assert.deepEqual(panels.flatMap(({ itemIds }) => itemIds), document.nodes.map(({ id }) => id));
  assert.equal(new Set(panels.map(({ id }) => id)).size, panels.length);
  const rendered = renderDiagramOutputs(directedRing(40));
  assert.equal(rendered.quality.status, 'split-required');
  assert.equal(rendered.quality.splitPlan.panels.length, 4);
});

test('graph quality rejects clipped route bends, partial label measurements, and labels or paths through nodes', () => {
  const document = connectedFlowchart();
  const rendered = renderDiagramOutputs(document);
  const report = scene => createRenderQualityReport(document, { scene, png: rendered.png, svgValidation: { ok: true, contrastRatio: 21 } });
  const bendOutside = report({ ...rendered.scene, edges: rendered.scene.edges.map((edge, index) => index ? edge : {
    ...edge, routePoints: [edge.routePoints[0], [-10, -10], edge.routePoints.at(-1)],
  }) });
  assert.equal(bendOutside.checks.find(check => check.id === 'rendered-clipping').status, 'fail');
  const box = rendered.scene.boxes[0];
  const onNode = report({ ...rendered.scene, labelBounds: rendered.scene.labelBounds.map(label => ({ ...label, x: box.x, y: box.y })) });
  assert.equal(onNode.status, 'invalid');
  assert.equal(onNode.checks.find(check => check.id === 'label-node-overlap').status, 'fail');
  const throughNode = report({ ...rendered.scene, edges: [{ ...rendered.scene.edges[0],
    routePoints: [[box.x - 20, box.y + box.height / 2], [box.x + box.width + 20, box.y + box.height / 2]],
  }] });
  assert.equal(throughNode.checks.find(check => check.id === 'edge-node-overlap').status, 'fail');
  const collidingNodes = report({ ...rendered.scene, boxes: rendered.scene.boxes.map((value, index) => index === 1
    ? { ...value, x: box.x, y: box.y } : value) });
  assert.equal(collidingNodes.checks.find(check => check.id === 'node-overlap').status, 'fail');
  const sequence = muviSequence();
  const sequenceRender = renderDiagramOutputs(sequence);
  const partial = createRenderQualityReport(sequence, { scene: { ...sequenceRender.scene, labelBounds: sequenceRender.scene.labelBounds.slice(0, 1) },
    png: sequenceRender.png, svgValidation: { ok: true, contrastRatio: 21 } });
  assert.equal(partial.checks.find(check => check.id === 'label-overlap').status, 'warning');
});

test('self connections form visible loops and skip edges route around graph obstacles', () => {
  const base = connectedFlowchart();
  const self = createDiagramDocument({ ...base, relations: [{ id: 'retry', from: 'intake', to: 'intake', label: 'Retry locally', kind: 'flow', weight: null }],
    accessibility: { ...base.accessibility, readingOrder: [...base.nodes.map(({ id }) => id), 'retry'] } });
  const rendered = renderDiagramOutputs(self);
  assert.equal(rendered.quality.status, 'pass');
  assert.ok(rendered.scene.edges[0].routePoints.length >= 4);
  assert.ok(rendered.scene.edges[0].routePoints.some(([, y]) => y < rendered.scene.boxes[0].y));
  const obstructed = createDiagramDocument({ ...base, relations: [{ id: 'bypass', from: 'intake', to: 'publish', label: 'Bypass review', kind: 'flow', weight: null }],
    accessibility: { ...base.accessibility, readingOrder: [...base.nodes.map(({ id }) => id), 'bypass'] } });
  const dense = renderDiagramOutputs(obstructed);
  assert.equal(dense.quality.status, 'pass');
  assert.equal(dense.quality.checks.find(check => check.id === 'edge-node-overlap').status, 'pass');
  assert.ok(dense.scene.edges[0].routePoints.length >= 4);
});

test('schema failures name the invalid field in structured diagnostics', () => {
  const document = connectedFlowchart();
  assert.throws(
    () => createDiagramDocument({ ...document, highlight: { targetId: 'review' } }),
    (error) => error.code === DIAGRAM_ERROR_CODES.SCHEMA_INVALID
      && error.details.diagnostics.some(({ detail }) => /unknown property 'highlight'/u.test(detail)),
  );
});

test('three identical renders are byte-stable and converge to unchanged', async (t) => {
  const root = await temporaryRoot(t);
  const document = fixture('flowchart');
  const statuses = [];
  const manifests = [];
  for (let index = 0; index < 3; index += 1) {
    statuses.push((await renderDiagram(document, { outputRoot: root })).status);
    manifests.push(await readFile(join(await diagramDirectory(root, document.diagramId), `${document.diagramId}.manifest.json`)));
  }
  assert.deepEqual(statuses, ['created', 'unchanged', 'unchanged']);
  assert.ok(manifests[0].equals(manifests[1]));
  assert.ok(manifests[1].equals(manifests[2]));
});

test('editable fidelity is explicit for flowchart and unsupported grammars omit the scene honestly', async (t) => {
  const flowchart = exportDiagramExcalidraw(fixture('flowchart'));
  assert.equal(flowchart.report.status, 'editable');
  assert.equal(flowchart.scene.type, 'excalidraw');

  const root = await temporaryRoot(t);
  const architecture = fixture('architecture');
  const unsupported = exportDiagramExcalidraw(architecture);
  assert.equal(unsupported.scene, null);
  assert.equal(unsupported.report.status, 'unsupported');
  await renderDiagram(architecture, { outputRoot: root });
  const names = await readdir(await diagramDirectory(root, architecture.diagramId));
  assert.equal(names.includes(`${architecture.diagramId}.excalidraw`), false);
  assert.ok(names.includes(`${architecture.diagramId}.svg`));
  assert.ok(names.includes(`${architecture.diagramId}.png`));
});

test('an edited Excalidraw scene owns rerendered pixels without rewriting IR or Mermaid', async (t) => {
  const root = await temporaryRoot(t);
  const document = fixture('flowchart');
  await renderDiagram(document, { outputRoot: root });
  const directory = await diagramDirectory(root, document.diagramId);
  const irPath = join(directory, `${document.diagramId}.planr-diagram.json`);
  const mermaidPath = join(directory, `${document.diagramId}.mmd`);
  const scenePath = join(directory, `${document.diagramId}.excalidraw`);
  const beforeIr = await readFile(irPath);
  const beforeMermaid = await readFile(mermaidPath);
  const beforeSvg = await readFile(join(directory, `${document.diagramId}.svg`));
  const scene = JSON.parse(await readFile(scenePath, 'utf8'));
  scene.elements.find(({ type }) => type === 'text').text = 'Edited scene text';
  scene.elements.find(({ type }) => type === 'text').originalText = 'Edited scene text';
  await writeFile(scenePath, `${JSON.stringify(scene, null, 2)}\n`);

  const result = await rerenderDiagram({ outputRoot: root, slug: document.diagramId });
  assert.equal(result.status, 'replaced');
  assert.match(result.manifest.source.path, /\.excalidraw$/u);
  assert.ok(beforeIr.equals(await readFile(irPath)));
  assert.ok(beforeMermaid.equals(await readFile(mermaidPath)));
  assert.equal(beforeSvg.equals(await readFile(join(directory, `${document.diagramId}.svg`))), false);
});

test('UTF-8 and hostile-looking labels remain inert and render through the packaged font', async (t) => {
  const root = await temporaryRoot(t);
  const base = fixture('flowchart');
  const label = '<script>alert("x")</script> `tick` ${value}\nمرحبا — 東京 — 😀';
  const document = createDiagramDocument({
    ...base,
    documentDigest: undefined,
    diagramId: 'hostile-text',
    title: 'Hostile text',
    nodes: base.nodes.map((node, index) => ({ ...node, label: index === 0 ? label : node.label })),
    accessibility: { ...base.accessibility, title: 'Hostile text' },
  });
  const rendered = renderDiagramOutputs(document);
  assert.match(rendered.svg, /&lt;script&gt;/u);
  assert.match(rendered.svg, /مرحبا — 東京 — 😀/u);
  assert.doesNotMatch(rendered.svg, /<script\b/iu);
  await renderDiagram(document, { outputRoot: root });
  assert.ok(rendered.png.byteLength > 100);

  const oversized = createDiagramDocument({
    ...base,
    documentDigest: undefined,
    diagramId: 'oversized-label',
    nodes: base.nodes.map((node, index) => ({
      ...node,
      label: index === 0 ? 'x'.repeat(2_049) : node.label,
    })),
    accessibility: { ...base.accessibility, title: 'Oversized label' },
  });
  assert.throws(
    () => renderDiagramOutputs(oversized),
    (error) => error?.code === DIAGRAM_ERROR_CODES.RESOURCE_BUDGET_EXCEEDED,
  );
});

test('generated-output drift returns E_DIAGRAM_OUTPUT_CONFLICT and preserves every final byte', async (t) => {
  const root = await temporaryRoot(t);
  const document = fixture('flowchart');
  await renderDiagram(document, { outputRoot: root });
  const directory = await diagramDirectory(root, document.diagramId);
  const svgPath = join(directory, `${document.diagramId}.svg`);
  await writeFile(svgPath, '<svg>owner edit</svg>\n');
  const before = await snapshotDirectory(directory);
  await assert.rejects(
    rerenderDiagram({ outputRoot: root, slug: document.diagramId }),
    (error) => error?.code === DIAGRAM_ERROR_CODES.OUTPUT_CONFLICT,
  );
  assertSnapshotEqual(before, await snapshotDirectory(directory));
});

test('inspection reports drift and check enforces the same manifest boundary', async (t) => {
  const root = await temporaryRoot(t);
  const document = fixture('flowchart');
  await renderDiagram(document, { outputRoot: root });
  const clean = await checkDiagram({ outputRoot: root, slug: document.diagramId });
  assert.equal(clean.validation, 'passed');
  assert.deepEqual(clean.sourceChanges, []);
  assert.deepEqual(clean.generatedChanges, []);

  const svgPath = join(await diagramDirectory(root, document.diagramId), `${document.diagramId}.svg`);
  await writeFile(svgPath, '<svg>changed</svg>\n');
  const changed = await inspectDiagram({ outputRoot: root, slug: document.diagramId });
  assert.equal(changed.validation, 'changed');
  assert.equal(changed.generatedChanges[0].reason, 'digest-mismatch');
  await assert.rejects(
    checkDiagram({ outputRoot: root, slug: document.diagramId }),
    (error) => error?.code === DIAGRAM_ERROR_CODES.OUTPUT_CONFLICT,
  );
});

test('an unowned same-slug file blocks promotion without changing final bytes', async (t) => {
  const root = await temporaryRoot(t);
  const document = fixture('flowchart');
  await renderDiagram(document, { outputRoot: root });
  const directory = await diagramDirectory(root, document.diagramId);
  await writeFile(join(directory, 'maintainer-note.txt'), 'keep me\n');
  const before = await snapshotDirectory(directory);
  await assert.rejects(
    renderDiagram(document, { outputRoot: root }),
    (error) => error?.code === DIAGRAM_ERROR_CODES.OUTPUT_CONFLICT,
  );
  assertSnapshotEqual(before, await snapshotDirectory(directory));
});

test('two changed source branches return E_DIAGRAM_SOURCE_CONFLICT and preserve both', async (t) => {
  const root = await temporaryRoot(t);
  const document = fixture('flowchart');
  await renderDiagram(document, { outputRoot: root });
  const directory = await diagramDirectory(root, document.diagramId);
  const irPath = join(directory, `${document.diagramId}.planr-diagram.json`);
  const scenePath = join(directory, `${document.diagramId}.excalidraw`);
  const changedDocument = createDiagramDocument({
    ...document,
    documentDigest: undefined,
    summary: 'Locally edited semantic source.',
  });
  await writeFile(irPath, `${JSON.stringify(changedDocument, null, 2)}\n`);
  const scene = JSON.parse(await readFile(scenePath, 'utf8'));
  scene.elements.find(({ type }) => type === 'text').text = 'Divergent scene';
  await writeFile(scenePath, `${JSON.stringify(scene, null, 2)}\n`);
  const before = await snapshotDirectory(directory);
  await assert.rejects(
    rerenderDiagram({ outputRoot: root, slug: document.diagramId }),
    (error) => error?.code === DIAGRAM_ERROR_CODES.SOURCE_CONFLICT,
  );
  assertSnapshotEqual(before, await snapshotDirectory(directory));

  const resolved = await rerenderDiagram({
    outputRoot: root,
    slug: document.diagramId,
    acceptSource: 'accept-excalidraw',
  });
  assert.equal(resolved.status, 'replaced');
  assert.match(resolved.manifest.source.path, /\.excalidraw$/u);
  assert.ok((await readFile(irPath)).equals(before.get(`${document.diagramId}.planr-diagram.json`)));
});

test('production diagram runtime has no network or browser dependency path', async () => {
  const files = await sourceFiles(join(packageRoot, 'lib', 'artifact', 'diagram'));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /from\s+['"]node:(?:http|https|dns|net|tls)['"]/u, file);
    assert.doesNotMatch(source, /\bfetch\s*\(/u, file);
    assert.doesNotMatch(source, /\b(?:playwright|puppeteer|chromium)\b/iu, file);
  }
});

test('parallel same-slug renders cannot mix sessions', async (t) => {
  const root = await temporaryRoot(t);
  const document = fixture('flowchart');
  const results = await Promise.allSettled([
    renderDiagram(document, { outputRoot: root }),
    renderDiagram(document, { outputRoot: root }),
  ]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  const rejected = results.find(({ status }) => status === 'rejected');
  assert.equal(rejected.reason.code, DIAGRAM_ERROR_CODES.OUTPUT_LOCKED);
  assertProtocolArtifact('diagram-manifest', await readManifest(root, document.diagramId), { protocolVersion: '1.6.0' });
});

test('runtime roots reject symlink escape and recovery restores one complete backup', async (t) => {
  const root = await temporaryRoot(t);
  await assert.rejects(
    renderDiagram(fixture('flowchart'), { outputRoot: root, slug: '../escape' }),
    (error) => error?.code === DIAGRAM_ERROR_CODES.OUTPUT_ESCAPE,
  );
  const external = await temporaryRoot(t);
  await symlink(external, join(root, '.openplanr-diagram-locks'));
  await assert.rejects(
    renderDiagram(fixture('flowchart'), { outputRoot: root }),
    (error) => error?.code === DIAGRAM_ERROR_CODES.OUTPUT_ESCAPE,
  );
  await rm(join(root, '.openplanr-diagram-locks'));

  const slug = 'recoverable-diagram';
  const backup = join(root, 'diagrams', `.${slug}.backup-test`);
  await mkdir(backup, { recursive: true });
  await writeFile(join(backup, 'marker'), 'complete\n');
  assert.equal(await recoverInterruptedDiagramPromotion(root, slug), true);
  assert.equal(await readFile(join(root, 'diagrams', slug, 'marker'), 'utf8'), 'complete\n');
});

test('abandoned staging cleanup is bounded and Mermaid active content is rejected', async (t) => {
  const root = await temporaryRoot(t);
  const abandoned = join(root, '.openplanr-diagram-staging', 'flowchart-dead-session');
  await mkdir(abandoned, { recursive: true });
  await writeFile(join(abandoned, 'partial.svg'), '<svg/>');
  assert.equal(await cleanupAbandonedDiagramStages(root, { maximumAgeMs: -1 }), 1);
  await assert.rejects(
    async () => importMermaid('flowchart LR\nA --> B\nclick A "https://example.com"'),
    (error) => error?.code === DIAGRAM_ERROR_CODES.MERMAID_INVALID,
  );
});
