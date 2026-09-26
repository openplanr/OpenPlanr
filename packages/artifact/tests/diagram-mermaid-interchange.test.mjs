import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import {
  adoptMermaidCopy,
  exportMermaidCopy,
  previewMermaidCopy,
  renderAuthoredDiagramSvg,
} from '../lib/artifact/diagram/authoring/index.mjs';
import { sealBundle, validateAuthoringBundle } from '../lib/artifact/diagram/authoring/model.mjs';

const fixture = (name) =>
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'diagram', 'interchange', name), 'utf8');
const supported = fixture('flowchart-supported.mmd');
const partial = fixture('flowchart-partial.mmd');
const preview = (source, options = {}) =>
  previewMermaidCopy(source, { diagramId: 'checkout', ...options });

test('supported LF and CRLF copies retain exact UTF-8 source and nested correspondence', () => {
  for (const source of [supported, supported.replaceAll('\n', '\r\n')]) {
    const result = preview(source);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(validateAuthoringBundle(result.bundle).ok, true);
    assert.equal(result.bundle.originalSource.text, source);
    assert.equal(result.bundle.sourceMap.sourceByteLength, Buffer.byteLength(source));
    assert.equal(result.fidelity.semantic, 'lossless');
    assert.equal(result.fidelity.presentation, 'partial');
    assert.equal(result.fidelity.sourceText, 'lossless');
    const proposedIds = result.bundle.presentation.elements.map((item) => item.elementId);
    assert.deepEqual(
      result.diagnostics.find((item) => item.code === 'generated-layout').elementIds,
      proposedIds,
    );
    assert.deepEqual(
      result.fidelity.losses.find((item) => item.code === 'generated-layout').elementIds,
      proposedIds,
    );
    assert.equal(
      renderAuthoredDiagramSvg(result.bundle).ok,
      true,
      'the proposed copy is exportable as a visual snapshot',
    );
    assert.deepEqual(
      result.bundle.document.groups.map((group) => [group.id, group.members]),
      [
        ['platform', ['a', 'data']],
        ['data', ['b']],
      ],
    );
    assert.equal(result.bundle.document.nodes.find((node) => node.id === 'b').kind, 'data-store');
    for (const entry of result.bundle.sourceMap.entries) {
      const bytes = Buffer.from(source);
      assert.equal(
        Buffer.from(bytes.subarray(entry.range.startByte, entry.range.endByte))
          .toString('utf8')
          .trim().length > 0,
        true,
      );
    }
    assert.equal(adoptMermaidCopy(result).ok, false);
    assert.equal(adoptMermaidCopy(result, result.acknowledgement).ok, true);
  }
});

test('first-copy node spacing and connectors render in every certified flow direction', () => {
  for (const direction of ['LR', 'RL', 'TB', 'BT']) {
    const result = preview(`flowchart ${direction}\nA[Start]\nB[Done]\nA -->|next| B\n`);
    assert.equal(result.ok, true, direction);
    assert.equal(renderAuthoredDiagramSvg(result.bundle).ok, true, direction);
  }
});

test('unsafe, malformed and over-limit sources fail without an adopted revision', () => {
  for (const [source, code] of [
    ['flowchart TB\nA[Start]\n%%{init: {"theme": "dark"}}\n', 'unsafe-construct'],
    ['flowchart TB\nA[Start]\nclick A "https://example.com"\n', 'unsafe-construct'],
    ['flowchart TB\nA[<script>alert(1)</script>]\n', 'unsafe-construct'],
    ['flowchart TB\nA[Start]\nA -->\n', 'malformed-statement'],
    [`flowchart TB\nA[${'é'.repeat(33_000)}]\n`, 'source-too-large'],
  ]) {
    const result = preview(source);
    assert.equal(result.ok, false, code);
    assert.equal(
      result.diagnostics.some((item) => item.code === code),
      true,
      JSON.stringify(result.diagnostics),
    );
    assert.equal(result.bundle, undefined);
  }
  const source = 'flowchart TB\r\n%% blank\r\n\r\nA[Été]\r\nB[Done]\r\nA --> B\r\ninvalid???\r\n';
  const result = preview(source);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.find((item) => item.code === 'malformed-statement'),
    {
      code: 'malformed-statement',
      severity: 'error',
      line: 7,
      column: 1,
      range: {
        startByte: Buffer.byteLength(source.split('invalid???')[0]),
        endByte: Buffer.byteLength(source.split('invalid???')[0]) + 10,
      },
      message: 'Statement is not valid certified Mermaid syntax.',
      repair: 'Correct its node, edge or subgraph syntax.',
      elementIds: [],
    },
  );
  let reads = 0;
  const hostile = Object.defineProperty({}, 'diagramId', {
    enumerable: true,
    get() {
      reads++;
      return 'checkout';
    },
  });
  assert.equal(previewMermaidCopy(supported, hostile).ok, false);
  assert.equal(reads, 0);
  assert.equal(preview('flowchart TB\nA[bad\u0000input]\n').diagnostics[0].code, 'invalid-control');
});

test('safe partial preview requires an acknowledgement tied to exact losses and content', () => {
  const result = preview(partial);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.fidelity.semantic, 'partial');
  assert.equal(result.fidelity.sourceText, 'lossless');
  assert.equal(
    result.diagnostics.some((item) => item.code === 'styles-and-directives' && item.line === 5),
    true,
  );
  assert.equal(adoptMermaidCopy(result).ok, false);
  assert.equal(adoptMermaidCopy(result, result.acknowledgement).ok, true);
  const changed = preview(partial.replace('Start', 'Begin'));
  assert.equal(adoptMermaidCopy(changed, result.acknowledgement).ok, false);
});

test('explicit IDs and placement survive reorder, label edits and copy export/reimport', () => {
  const first = preview('flowchart TB\nA[Start]\nB{Decision}\nA -->|yes| B\n');
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const old = structuredClone(first.bundle);
  old.presentation.elements.find((item) => item.elementId === 'a').bounds.x = 457;
  const moved = sealBundle(old);
  const second = preview('flowchart TB\nB{Choice}\nA[Begin]\nA -->|approved| B\n', {
    previousBundle: moved,
  });
  assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
  assert.deepEqual(
    second.bundle.document.nodes.map((node) => node.id),
    ['b', 'a'],
  );
  assert.equal(
    second.bundle.presentation.elements.find((item) => item.elementId === 'a').bounds.x,
    457,
  );
  assert.equal(second.bundle.document.relations[0].id, first.bundle.document.relations[0].id);
  const copy = exportMermaidCopy(second.bundle);
  assert.equal(copy.ok, true, JSON.stringify(copy.diagnostics));
  const again = preview(copy.text, { previousBundle: second.bundle });
  assert.equal(again.ok, true, JSON.stringify(again.diagnostics));
  assert.equal(again.bundle.document.nodes.find((node) => node.id === 'a').label, 'Begin');
  assert.equal(
    again.bundle.presentation.elements.find((item) => item.elementId === 'a').bounds.x,
    457,
  );
  assert.equal(
    preview('flowchart TB\nA_b[One]\nA-b[Two]\n').diagnostics.some(
      (item) => item.code === 'source-id-collision',
    ),
    true,
  );
  const alias = preview('flowchart TB\nA_b[Original]\n');
  assert.equal(
    preview('flowchart TB\nA-b[Renamed source ID]\n', {
      previousBundle: alias.bundle,
    }).diagnostics.some((item) => item.code === 'unverified-identity'),
    true,
  );
  const authored = structuredClone(alias.bundle);
  authored.document.nodes[0].label = 'Edited on canvas';
  authored.sourceMap.entries[0].confidence = 'ambiguous';
  authored.sourceMap.entries[0].losses = [
    'Semantic content changed after this source correspondence was captured.',
  ];
  const edited = sealBundle(authored);
  assert.equal(validateAuthoringBundle(edited).ok, true);
  const fromEdited = preview('flowchart TB\nA_b[Edited in source]\n', { previousBundle: edited });
  assert.equal(fromEdited.ok, true, JSON.stringify(fromEdited.diagnostics));
  assert.equal(fromEdited.bundle.document.nodes[0].id, alias.bundle.document.nodes[0].id);
  assert.equal(
    preview('flowchart TB\nsubgraph A_b[Container]\nB[Child]\nend\n', {
      previousBundle: edited,
    }).diagnostics.some((item) => item.code === 'changed-source-role'),
    true,
  );
  assert.equal(
    preview('flowchart TB\nA[One]\nB[Two]\nA --> B\nA --> B\n').diagnostics.some(
      (item) => item.code === 'ambiguous-edge',
    ),
    true,
  );
  const parallel = preview('flowchart TB\nA[One]\nB[Two]\nA -->|yes| B\nA -->|no| B\n');
  assert.equal(parallel.ok, true, JSON.stringify(parallel.diagnostics));
  const parallelAgain = preview('flowchart TB\nA[One]\nB[Two]\nA -->|no| B\nA -->|yes| B\n', {
    previousBundle: parallel.bundle,
  });
  assert.equal(parallelAgain.ok, true, JSON.stringify(parallelAgain.diagnostics));
  assert.deepEqual(
    new Set(parallelAgain.bundle.document.relations.map((item) => item.id)),
    new Set(parallel.bundle.document.relations.map((item) => item.id)),
  );
});

test('copy export reports unrepresentable authored content while leaving bundle complete', () => {
  const first = preview('flowchart TB\nA[One]\nB[Two]\nA --> B\n');
  const original = structuredClone(first.bundle);
  const changed = structuredClone(first.bundle);
  const relation = changed.presentation.elements.find((item) => item.route);
  relation.route = {
    mode: 'manual',
    strategy: 'straight',
    from: { side: 'bottom', offset: 0.5 },
    to: { side: 'top', offset: 0.5 },
    points: [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ],
  };
  changed.document.annotations.push({ id: 'note', targetId: 'a', text: 'Keep this note' });
  changed.presentation.elements.push({
    ...structuredClone(changed.presentation.elements.find((item) => item.elementId === 'a')),
    elementId: 'note',
    appearance: {
      ...changed.presentation.elements.find((item) => item.elementId === 'a').appearance,
      shape: 'text',
    },
  });
  const bundle = sealBundle(changed);
  assert.equal(
    validateAuthoringBundle(bundle).ok,
    true,
    JSON.stringify(validateAuthoringBundle(bundle).diagnostics),
  );
  const copy = exportMermaidCopy(bundle);
  assert.equal(copy.ok, true, JSON.stringify(copy.diagnostics));
  assert.equal(copy.fidelity.semantic, 'partial');
  assert.equal(copy.fidelity.presentation, 'partial');
  assert.equal(
    copy.fidelity.losses.some((item) => item.code === 'annotations'),
    true,
  );
  assert.equal(
    copy.fidelity.losses.some((item) => item.code === 'manual-geometry'),
    true,
  );
  assert.equal(bundle.document.annotations.length, 1);
  const reimported = preview('flowchart TB\nA[Renamed]\nB[Two]\nA --> B\n', {
    previousBundle: bundle,
  });
  assert.equal(reimported.ok, true, JSON.stringify(reimported.diagnostics));
  assert.deepEqual(reimported.bundle.document.annotations, bundle.document.annotations);
  assert.deepEqual(
    reimported.bundle.presentation.elements.find((item) => item.elementId === relation.elementId)
      .route,
    relation.route,
  );
  const orphaned = preview('flowchart TB\nB[Two]\n', { previousBundle: bundle });
  assert.equal(orphaned.ok, false);
  assert.equal(
    orphaned.diagnostics.some((item) => item.code === 'orphaned-authoring'),
    true,
  );
  const unsafe = structuredClone(bundle);
  unsafe.document.nodes.find((item) => item.id === 'a').label = '<script>hidden</script>';
  const safeCopy = exportMermaidCopy(sealBundle(unsafe));
  assert.equal(safeCopy.ok, true);
  assert.equal(safeCopy.text.includes('<script>'), false);
  assert.equal(
    safeCopy.fidelity.losses.some((item) => item.code === 'unsafe-label'),
    true,
  );
  const controlSource = preview(
    'flowchart TB\nsubgraph G[Group]\nA[One]\nB[Two]\nend\nA -->|go| B\n',
  );
  const controls = structuredClone(controlSource.bundle);
  controls.document.nodes.find((item) => item.id === 'a').label = 'Line one\nLine two';
  controls.document.groups[0].label = 'Group\tlabel';
  controls.document.relations[0].label = 'Go\rnow';
  const controlCopy = exportMermaidCopy(sealBundle(controls));
  assert.equal(controlCopy.ok, true, JSON.stringify(controlCopy.diagnostics));
  assert.equal(controlCopy.fidelity.semantic, 'partial');
  assert.deepEqual(
    new Set(
      controlCopy.fidelity.losses
        .filter((item) => ['unsafe-label', 'unsupported-edge-label'].includes(item.code))
        .flatMap((item) => item.elementIds),
    ),
    new Set(['a', 'g', controlSource.bundle.document.relations[0].id]),
  );
  const controlRoundTrip = preview(controlCopy.text);
  assert.equal(controlRoundTrip.ok, true, JSON.stringify(controlRoundTrip.diagnostics));
  assert.deepEqual(first.bundle, original);
});

test('real Chromium and Node run the same pure converter without providers or fetch', {
  timeout: 90_000,
}, async () => {
  const compiled = await build({
    entryPoints: [
      join(import.meta.dirname, '..', 'lib', 'artifact', 'diagram', 'authoring', 'index.mjs'),
    ],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  const code = compiled.outputFiles[0].text;
  assert.equal(/(?:from|require\()\s*["']node:(?:fs|path)/u.test(code), false);
  const browserModule = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );
  const nodeResult = preview(supported),
    browserResult = browserModule.previewMermaidCopy(supported, { diagramId: 'checkout' });
  assert.deepEqual(browserResult, nodeResult);
  const script = await build({
    stdin: {
      contents: `import { previewMermaidCopy } from './packages/artifact/lib/artifact/diagram/authoring/index.mjs'; globalThis.mermaidProof = { runtime: { document: typeof document, process: typeof process, Buffer: typeof Buffer }, result: previewMermaidCopy(${JSON.stringify(supported)}, { diagramId: 'checkout' }) };`,
      resolveDir: join(import.meta.dirname, '..', '..', '..'),
      sourcefile: 'mermaid-browser-proof.mjs',
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
    logLevel: 'silent',
  });
  const browser = await launchBrowser({ engine: 'chromium' });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: script.outputFiles[0].text });
    const actual = await page.evaluate(() => globalThis.mermaidProof);
    assert.deepEqual(actual.runtime, {
      document: 'object',
      process: 'undefined',
      Buffer: 'undefined',
    });
    assert.deepEqual(actual.result, nodeResult);
  } finally {
    await browser.close();
  }
  assert.equal(Object.hasOwn(nodeResult.bundle, 'repositoryLink'), false);
});
