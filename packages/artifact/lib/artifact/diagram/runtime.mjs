import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { DIAGRAM_GRAMMAR_REGISTRY } from '@openplanr/protocol/diagram-contracts';

import {
  cleanupAbandonedDiagramStages,
  createDiagramRenderManifest,
  digestBytes,
  diagramRelativeDirectory,
  jsonBytes,
  assertDiagramSlug,
  promoteDiagramSet,
  readDiagramSet,
  recoverInterruptedDiagramPromotion,
  resolveDiagramOutputRoot,
  withDiagramLock,
} from './custody/index.mjs';
import { DIAGRAM_ERROR_CODES, diagramFail } from './errors.mjs';
import { importMermaid } from './mermaid.mjs';
import { assertDiagramDocument } from './model.mjs';
import {
  assertExcalidrawScene,
  exportDiagramExcalidraw,
  exportDiagramMermaid,
  renderExcalidrawSceneSvg,
} from './projection/index.mjs';
import { validateDiagramSvg } from './accessibility.mjs';
import {
  DIAGRAM_FONT,
  DIAGRAM_RASTERIZER,
  DIAGRAM_RENDERER,
  DIAGRAM_THEME,
  createFidelityReport,
  createRenderQualityReport,
  renderDiagramHtml,
  renderDiagramOutputs,
  renderDiagramPng,
} from './rendering/index.mjs';

const MEDIA = Object.freeze({
  assets: 'application/vnd.openplanr.diagram-assets+json',
  excalidraw: 'application/vnd.excalidraw+json',
  fidelity: 'application/vnd.openplanr.diagram-fidelity+json',
  html: 'text/html; charset=utf-8',
  ir: 'application/vnd.openplanr.diagram+json',
  manifest: 'application/vnd.openplanr.diagram-manifest+json',
  mermaid: 'text/vnd.mermaid; charset=utf-8',
  png: 'image/png',
  quality: 'application/vnd.openplanr.diagram-quality+json',
  svg: 'image/svg+xml; charset=utf-8',
});

const SOURCE_SUFFIX = Object.freeze({
  ir: '.planr-diagram.json',
  mermaid: '.mmd',
  excalidraw: '.excalidraw',
});

function outputName(slug, suffix) {
  return `${slug}.${suffix}`;
}

function addOutput(outputs, name, value, mediaType, fidelity) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  outputs.set(name, Object.freeze({ bytes, mediaType, fidelity }));
}

function assetReceipt() {
  return {
    kind: 'openplanr-diagram-render-assets',
    schemaVersion: '1.0.0',
    renderer: { ...DIAGRAM_RENDERER, digest: sha256Jcs(DIAGRAM_RENDERER) },
    rasterizer: { ...DIAGRAM_RASTERIZER, digest: sha256Jcs(DIAGRAM_RASTERIZER) },
    font: DIAGRAM_FONT,
    theme: { ...DIAGRAM_THEME, digest: sha256Jcs(DIAGRAM_THEME) },
    registry: {
      path: 'registry/v1.6.0/diagram-grammars.json',
      digest: DIAGRAM_GRAMMAR_REGISTRY.documentDigest,
    },
  };
}

function descriptor(relativeDirectory, name, output) {
  return {
    path: `${relativeDirectory}/${name}`,
    mediaType: output.mediaType,
    digest: digestBytes(output.bytes),
    fidelity: output.fidelity,
  };
}

function finalizeBundle(document, slug, outputs, sourceName) {
  const relativeDirectory = diagramRelativeDirectory(slug);
  const sourceOutput = outputs.get(sourceName);
  if (!sourceOutput) throw new Error(`Missing active diagram source: ${sourceName}`);
  const descriptors = [...outputs].map(([name, output]) =>
    descriptor(relativeDirectory, name, output),
  );
  const manifest = createDiagramRenderManifest(document, {
    source: {
      path: `${relativeDirectory}/${sourceName}`,
      digest: digestBytes(sourceOutput.bytes),
    },
    outputs: descriptors,
  });
  const manifestName = outputName(slug, 'manifest.json');
  const files = new Map([...outputs].map(([name, output]) => [name, output.bytes]));
  files.set(manifestName, jsonBytes(manifest));
  return Object.freeze({
    contentId: manifest.documentDigest.slice('sha256:'.length),
    files,
    manifest,
  });
}

function buildIrBundle(document, slug) {
  assertDiagramDocument(document);
  if (document.diagramId !== slug) {
    diagramFail(
      DIAGRAM_ERROR_CODES.SCHEMA_INVALID,
      'Diagram slug and canonical document identity must match.',
      {
        slug,
        diagramId: document.diagramId,
        repair:
          'Use the diagramId as the slug or create a new canonical document with the requested identity.',
      },
    );
  }
  const rendered = renderDiagramOutputs(document);
  const mermaid = exportDiagramMermaid(document);
  const excalidraw = exportDiagramExcalidraw(document);
  const outputs = new Map();
  addOutput(
    outputs,
    outputName(slug, 'planr-diagram.json'),
    jsonBytes(document),
    MEDIA.ir,
    'editable',
  );
  addOutput(outputs, outputName(slug, 'svg'), rendered.svg, MEDIA.svg, 'render-only');
  addOutput(outputs, outputName(slug, 'png'), rendered.png.bytes, MEDIA.png, 'render-only');
  addOutput(outputs, outputName(slug, 'html'), rendered.html, MEDIA.html, 'render-only');
  addOutput(
    outputs,
    outputName(slug, 'quality.json'),
    jsonBytes(rendered.quality),
    MEDIA.quality,
    'render-only',
  );
  addOutput(
    outputs,
    outputName(slug, 'assets.json'),
    jsonBytes(assetReceipt()),
    MEDIA.assets,
    'render-only',
  );
  addOutput(
    outputs,
    outputName(slug, 'fidelity.mermaid.json'),
    jsonBytes(mermaid.report),
    MEDIA.fidelity,
    mermaid.report.status,
  );
  addOutput(
    outputs,
    outputName(slug, 'fidelity.excalidraw.json'),
    jsonBytes(excalidraw.report),
    MEDIA.fidelity,
    excalidraw.report.status,
  );
  if (mermaid.source)
    addOutput(
      outputs,
      outputName(slug, 'mmd'),
      mermaid.source,
      MEDIA.mermaid,
      mermaid.report.status,
    );
  if (excalidraw.scene)
    addOutput(
      outputs,
      outputName(slug, 'excalidraw'),
      jsonBytes(excalidraw.scene),
      MEDIA.excalidraw,
      excalidraw.report.status,
    );
  return finalizeBundle(document, slug, outputs, outputName(slug, 'planr-diagram.json'));
}

function findOutput(current, suffix) {
  const entry = [...current.files.entries()].find(([path]) => path.endsWith(suffix));
  return entry ? { path: entry[0], name: basename(entry[0]), bytes: entry[1] } : null;
}

function preserveSourceOutputs(current, outputs) {
  for (const [path, bytes] of current.files) {
    if (!Object.values(SOURCE_SUFFIX).some((suffix) => path.endsWith(suffix))) continue;
    const previous = current.manifest.outputs.find((output) => output.path === path);
    addOutput(outputs, basename(path), bytes, previous.mediaType, previous.fidelity);
  }
}

function buildSceneBundle(document, slug, sceneBytes, current) {
  let scene;
  try {
    scene = assertExcalidrawScene(JSON.parse(sceneBytes.toString('utf8')));
  } catch (error) {
    if (error?.name === 'DiagramError') throw error;
    diagramFail(DIAGRAM_ERROR_CODES.SCENE_INVALID, 'Edited scene is not valid JSON.', {
      cause: error.message,
    });
  }
  const renderedScene = renderExcalidrawSceneSvg(scene, {
    title: document.accessibility.title,
    description: document.accessibility.description,
  });
  const png = renderDiagramPng(renderedScene.svg);
  const html = renderDiagramHtml(document, renderedScene.svg);
  const quality = createRenderQualityReport(document, {
    scene: renderedScene.scene,
    png,
    svgValidation: validateDiagramSvg(renderedScene.svg),
  });
  const fidelity = createFidelityReport(document, {
    sourceFormat: 'excalidraw',
    targetFormat: 'svg',
    status: 'render-only',
    notes: [
      'The edited scene owns this render.',
      'Canonical semantic IR and Mermaid bytes were preserved and were not claimed equivalent to the scene.',
    ],
  });
  const outputs = new Map();
  preserveSourceOutputs(current, outputs);
  addOutput(outputs, outputName(slug, 'svg'), renderedScene.svg, MEDIA.svg, 'render-only');
  addOutput(outputs, outputName(slug, 'png'), png.bytes, MEDIA.png, 'render-only');
  addOutput(outputs, outputName(slug, 'html'), html, MEDIA.html, 'render-only');
  addOutput(
    outputs,
    outputName(slug, 'quality.json'),
    jsonBytes(quality),
    MEDIA.quality,
    'render-only',
  );
  addOutput(
    outputs,
    outputName(slug, 'assets.json'),
    jsonBytes(assetReceipt()),
    MEDIA.assets,
    'render-only',
  );
  addOutput(
    outputs,
    outputName(slug, 'fidelity.scene.json'),
    jsonBytes(fidelity),
    MEDIA.fidelity,
    'render-only',
  );
  return finalizeBundle(document, slug, outputs, outputName(slug, 'excalidraw'));
}

function assertGeneratedOutputsCurrent(current) {
  if (current.generatedChanges.length === 0) return;
  diagramFail(
    DIAGRAM_ERROR_CODES.OUTPUT_CONFLICT,
    'Generated diagram output was modified or an unowned file is present.',
    {
      changes: current.generatedChanges,
      repair: 'Choose a new slug or restore/remove the conflicting output explicitly.',
    },
  );
}

function inspection(current) {
  const validation =
    current.sourceChanges.length === 0 && current.generatedChanges.length === 0
      ? 'passed'
      : 'changed';
  return Object.freeze({
    directory: current.directory,
    manifest: current.manifest,
    validation,
    sourceChanges: Object.freeze([...current.sourceChanges]),
    generatedChanges: Object.freeze([...current.generatedChanges]),
  });
}

function normalizeAcceptedSource(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/^accept-/u, '');
  if (!Object.hasOwn(SOURCE_SUFFIX, normalized)) {
    diagramFail(DIAGRAM_ERROR_CODES.SOURCE_CONFLICT, `Unknown diagram source choice: ${value}`, {
      choices: ['accept-ir', 'accept-mermaid', 'accept-excalidraw'],
    });
  }
  return normalized;
}

function selectedSource(current, acceptedSource) {
  const changed = [...new Set(current.sourceChanges.map(({ branch }) => branch).filter(Boolean))];
  const accepted = normalizeAcceptedSource(acceptedSource);
  if (changed.length > 1 && !accepted) {
    diagramFail(
      DIAGRAM_ERROR_CODES.SOURCE_CONFLICT,
      'More than one diagram source branch changed after the last manifest.',
      {
        branches: changed,
        choices: ['accept-ir', 'accept-mermaid', 'accept-excalidraw', 'new-slug'],
      },
    );
  }
  if (accepted) return accepted;
  if (changed.length === 1) return changed[0];
  const activePath = current.manifest.source.path;
  return (
    Object.entries(SOURCE_SUFFIX).find(([, suffix]) => activePath.endsWith(suffix))?.[0] ?? 'ir'
  );
}

async function promote(root, slug, bundle, current) {
  const result = await promoteDiagramSet(root, slug, bundle.contentId, bundle.files, { current });
  return Object.freeze({
    status: result.status,
    directory: result.directory,
    manifest: bundle.manifest,
    outputCount: bundle.files.size,
  });
}

export async function renderDiagram(
  document,
  { outputRoot = process.cwd(), slug = document?.diagramId } = {},
) {
  slug = assertDiagramSlug(slug);
  const root = resolveDiagramOutputRoot(outputRoot);
  return withDiagramLock(root, slug, async () => {
    await cleanupAbandonedDiagramStages(root);
    await recoverInterruptedDiagramPromotion(root, slug);
    const current = await readDiagramSet(root, slug);
    if (current) {
      assertGeneratedOutputsCurrent(current);
      if (current.sourceChanges.length > 0) {
        diagramFail(
          DIAGRAM_ERROR_CODES.SOURCE_CONFLICT,
          'An existing diagram source changed; use rerenderDiagram so its owner is explicit.',
          {
            branches: [...new Set(current.sourceChanges.map(({ branch }) => branch))],
          },
        );
      }
    }
    return promote(root, slug, buildIrBundle(document, slug), current);
  });
}

export async function rerenderDiagram({
  outputRoot = process.cwd(),
  slug,
  acceptSource = null,
} = {}) {
  slug = assertDiagramSlug(slug);
  const root = resolveDiagramOutputRoot(outputRoot);
  return withDiagramLock(root, slug, async () => {
    await cleanupAbandonedDiagramStages(root);
    await recoverInterruptedDiagramPromotion(root, slug);
    const current = await readDiagramSet(root, slug);
    if (!current)
      diagramFail(DIAGRAM_ERROR_CODES.OUTPUT_CONFLICT, `No generated diagram exists for ${slug}.`);
    assertGeneratedOutputsCurrent(current);
    const source = selectedSource(current, acceptSource);
    const ir = findOutput(current, SOURCE_SUFFIX.ir);
    if (!ir)
      diagramFail(
        DIAGRAM_ERROR_CODES.SOURCE_CONFLICT,
        'Canonical IR is absent from the generated diagram set.',
      );
    let document;
    try {
      document = assertDiagramDocument(JSON.parse(ir.bytes.toString('utf8')));
    } catch (error) {
      if (source === 'ir') throw error;
      diagramFail(
        DIAGRAM_ERROR_CODES.SOURCE_CONFLICT,
        'Canonical IR is unreadable while rerendering another source branch.',
        { cause: error.message },
      );
    }
    if (source === 'excalidraw') {
      const scene = findOutput(current, SOURCE_SUFFIX.excalidraw);
      if (!scene)
        diagramFail(
          DIAGRAM_ERROR_CODES.SOURCE_CONFLICT,
          'The accepted Excalidraw source is absent.',
        );
      return promote(root, slug, buildSceneBundle(document, slug, scene.bytes, current), current);
    }
    if (source === 'mermaid') {
      const mermaid = findOutput(current, SOURCE_SUFFIX.mermaid);
      if (!mermaid)
        diagramFail(DIAGRAM_ERROR_CODES.SOURCE_CONFLICT, 'The accepted Mermaid source is absent.');
      const imported = importMermaid(mermaid.bytes.toString('utf8'), {
        diagramId: slug,
        title: document.title,
        summary: document.summary,
        audience: document.audience,
        detailTier: document.layout.detailTier,
        themeId: document.theme.themeId,
        sourcePath: mermaid.path,
      });
      return promote(root, slug, buildIrBundle(imported.document, slug), current);
    }
    return promote(root, slug, buildIrBundle(document, slug), current);
  });
}

export async function inspectDiagram({ outputRoot = process.cwd(), slug } = {}) {
  slug = assertDiagramSlug(slug);
  const root = resolveDiagramOutputRoot(outputRoot);
  await recoverInterruptedDiagramPromotion(root, slug);
  const current = await readDiagramSet(root, slug);
  if (!current)
    diagramFail(DIAGRAM_ERROR_CODES.OUTPUT_CONFLICT, `No generated diagram exists for ${slug}.`);
  return inspection(current);
}

export async function checkDiagram(options = {}) {
  const result = await inspectDiagram(options);
  if (result.sourceChanges.length > 0 || result.generatedChanges.length > 0) {
    diagramFail(DIAGRAM_ERROR_CODES.OUTPUT_CONFLICT, 'Diagram files differ from their manifest.', {
      sourceChanges: result.sourceChanges,
      generatedChanges: result.generatedChanges,
      repair:
        result.sourceChanges.length > 0
          ? 'Run planr diagram rerender and choose the intended source branch when required.'
          : 'Restore the generated bytes or render to a new slug.',
    });
  }
  return result;
}

export const DIAGRAM_OUTPUT_MEDIA_TYPES = MEDIA;
