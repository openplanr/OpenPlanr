import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  makeBundle,
  makeTransaction,
  placement,
  sealBundle,
} from '../../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { compileDiagramCommand } from '../../../artifact/lib/artifact/diagram/authoring/commands.mjs';
import { createDiagramAuthoringStore } from '../../../artifact/lib/artifact/diagram/authoring/store.mjs';
import {
  applyDiagramTransaction,
  newDiagram,
} from '../../src/services/diagram-authoring-service.js';

const roots: string[] = [];
const target = 'diagrams/checkout/checkout.planr-diagram-bundle.json';
function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'openplanr-diagram-authoring-cli-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('scoped diagram authoring service', () => {
  it('creates a canonical bundle, previews without changing it, and applies only the exact accepted preview', async () => {
    const root = project();
    const created = await newDiagram(root, target, 'Checkout');
    expect(created).toMatchObject({ ok: true, action: 'diagram.new', diagramId: 'checkout' });
    const file = path.join(root, target);
    const before = readFileSync(file, 'utf8');
    const bundle = JSON.parse(before);
    const compiled = compileDiagramCommand(
      bundle,
      {
        type: 'create',
        elements: [
          {
            collection: 'nodes',
            value: { id: 'start', label: 'Start', kind: 'process', description: null },
          },
        ],
        presentation: [placement('start')],
      },
      { transactionId: 'add-start' },
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok || !compiled.transaction) return;
    const transactionFile = path.join(root, 'transaction.json');
    writeFileSync(transactionFile, JSON.stringify(compiled.transaction));
    const preview = await applyDiagramTransaction(root, target, transactionFile);
    expect(preview).toMatchObject({ ok: true, status: 'preview', diagramId: 'checkout' });
    expect(readFileSync(file, 'utf8')).toBe(before);
    await expect(
      applyDiagramTransaction(root, target, transactionFile, 'wrong'),
    ).rejects.toMatchObject({ code: 'E_DIAGRAM_PREVIEW_CHANGED' });
    expect(readFileSync(file, 'utf8')).toBe(before);
    const applied = await applyDiagramTransaction(
      root,
      target,
      transactionFile,
      preview.previewToken,
    );
    expect(applied).toMatchObject({ ok: true, status: 'saved', diagramId: 'checkout' });
    expect(JSON.parse(readFileSync(file, 'utf8')).document.nodes[0].id).toBe('start');
    await expect(applyDiagramTransaction(root, target, transactionFile)).rejects.toMatchObject({
      code: 'E_DIAGRAM_TRANSACTION_INVALID',
    });
  });

  it('preserves unaffected geometry, locks, styles and identities through a rename and failure branch', async () => {
    const root = project();
    const source = makeBundle();
    source.presentation.elements[1].locks.position = true;
    sealBundle(source);
    const store = createDiagramAuthoringStore({ root: realpathSync(root), slug: 'checkout' });
    expect((await store.initialize(source, { transactionId: 'fixture-init' })).ok).toBe(true);
    const file = path.join(root, target);
    const renameFile = path.join(root, 'rename.json');
    writeFileSync(renameFile, JSON.stringify(makeTransaction(source)));
    const renamePreview = await applyDiagramTransaction(root, target, renameFile);
    await applyDiagramTransaction(root, target, renameFile, renamePreview.previewToken);
    const renamed = JSON.parse(readFileSync(file, 'utf8'));
    expect(renamed.document.nodes[0].label).toBe('Accept order');
    const failure = {
      id: 'failure',
      label: 'Payment failed',
      kind: 'process',
      description: null,
    };
    const branch = {
      id: 'edge-failure',
      from: 'node-a',
      to: 'failure',
      kind: 'flow',
      direction: 'forward',
      label: 'Failure',
      weight: null,
    };
    const edgePlacement = structuredClone(source.presentation.elements[2]);
    edgePlacement.elementId = 'edge-failure';
    edgePlacement.route.points = [
      { x: 160, y: 65 },
      { x: 500, y: 65 },
    ];
    const compiled = compileDiagramCommand(
      renamed,
      {
        type: 'create',
        elements: [
          { collection: 'nodes', value: failure },
          { collection: 'relations', value: branch },
        ],
        presentation: [placement('failure', 'rectangle', 500, 30), edgePlacement],
      },
      { transactionId: 'add-failure-branch' },
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok || !compiled.transaction) return;
    const branchFile = path.join(root, 'branch.json');
    writeFileSync(branchFile, JSON.stringify(compiled.transaction));
    const branchPreview = await applyDiagramTransaction(root, target, branchFile);
    await applyDiagramTransaction(root, target, branchFile, branchPreview.previewToken);
    const result = JSON.parse(readFileSync(file, 'utf8'));
    expect(result.document.nodes.find((node: { id: string }) => node.id === 'node-b')).toEqual(
      source.document.nodes[1],
    );
    expect(result.document.relations.find((edge: { id: string }) => edge.id === 'edge-a')).toEqual(
      source.document.relations[0],
    );
    for (const original of source.presentation.elements) {
      expect(
        result.presentation.elements.find(
          (candidate: { elementId: string }) => candidate.elementId === original.elementId,
        ),
      ).toEqual(original);
    }
    expect(result.document.groups).toEqual(source.document.groups);
    expect(result.document.annotations).toEqual(source.document.annotations);
    expect(result.document.nodes.map((node: { id: string }) => node.id)).toContain('failure');
    expect(result.document.relations.map((edge: { id: string }) => edge.id)).toContain(
      'edge-failure',
    );
  });

  it('rejects a stale exact-base preview after an independent edit without overwriting it', async () => {
    const root = project();
    const source = makeBundle();
    const store = createDiagramAuthoringStore({ root: realpathSync(root), slug: 'checkout' });
    await store.initialize(source, { transactionId: 'fixture-init' });
    const staleFile = path.join(root, 'stale.json');
    writeFileSync(staleFile, JSON.stringify(makeTransaction(source)));
    const stalePreview = await applyDiagramTransaction(root, target, staleFile);
    const independent = compileDiagramCommand(
      source,
      { type: 'rename', id: 'node-b', label: 'Delivered' },
      { transactionId: 'independent-rename' },
    );
    expect(independent.ok).toBe(true);
    if (!independent.ok || !independent.transaction) return;
    const independentFile = path.join(root, 'independent.json');
    writeFileSync(independentFile, JSON.stringify(independent.transaction));
    const independentPreview = await applyDiagramTransaction(root, target, independentFile);
    await applyDiagramTransaction(root, target, independentFile, independentPreview.previewToken);
    const current = readFileSync(path.join(root, target), 'utf8');
    await expect(
      applyDiagramTransaction(root, target, staleFile, stalePreview.previewToken),
    ).rejects.toMatchObject({ code: 'E_DIAGRAM_TRANSACTION_INVALID' });
    expect(readFileSync(path.join(root, target), 'utf8')).toBe(current);
  });

  it('refuses paths outside canonical custody', async () => {
    const root = project();
    await expect(newDiagram(root, '../escape.json', 'Escape')).rejects.toMatchObject({
      code: 'E_DIAGRAM_PATH',
    });
    await expect(
      newDiagram(root, 'diagrams/other/checkout.planr-diagram-bundle.json', 'Mismatch'),
    ).rejects.toMatchObject({ code: 'E_DIAGRAM_PATH' });
  });
});
