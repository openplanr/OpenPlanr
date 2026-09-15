import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { sha256Jcs, withDocumentDigest } from '@openplanr/protocol/canonical-json';
import { assertProtocolArtifact } from '@openplanr/protocol/contracts';

import {
  createArtifactEnvelope,
  digestArtifactEnvelope,
  validateArtifactEnvelope,
  validateArtifactReview,
} from '../envelope.mjs';
import { digestBytes } from './custody/bytes.mjs';
import { checkDiagram } from './runtime.mjs';
import { prepareDiagramSvg } from '../ui/diagram-svg.mjs';

const CONSUMERS = new Set(['specification', 'documentation', 'pdf']);
const OUTPUT_MEDIA = Object.freeze({
  png: 'image/png',
  svg: 'image/svg+xml; charset=utf-8',
});

function fail(message, details = {}) {
  const error = new Error(message);
  error.name = 'E_DIAGRAM_REFERENCE_CUSTODY_INVALID';
  error.code = 'E_DIAGRAM_REFERENCE_CUSTODY_INVALID';
  error.details = Object.freeze({ ...details });
  throw error;
}

function locator(manifestPath) {
  const absolute = resolve(manifestPath);
  const directory = dirname(absolute);
  const diagramsRoot = dirname(directory);
  const outputRoot = dirname(diagramsRoot);
  const slug = basename(directory);
  if (basename(diagramsRoot) !== 'diagrams' || basename(absolute) !== `${slug}.manifest.json`) {
    fail('Diagram manifest must live at diagrams/{slug}/{slug}.manifest.json.');
  }
  return { absolute, directory, outputRoot, slug };
}

function outputBySuffix(manifest, suffix) {
  return manifest.outputs.find(({ path }) => path.endsWith(suffix)) ?? null;
}

async function verifiedSet(manifestPath) {
  const location = locator(manifestPath);
  const inspected = await checkDiagram({ outputRoot: location.outputRoot, slug: location.slug });
  const manifest = inspected.manifest;
  const canonical = manifest.outputs.find(output => output.path.endsWith('.planr-diagram.json'));
  if (!canonical) fail('Diagram set has no canonical metadata.');
  const sourcePath = join(location.outputRoot, ...canonical.path.split('/'));
  const sourceBytes = await readFile(sourcePath);
  if (digestBytes(sourceBytes) !== canonical.digest) fail('Canonical diagram source digest changed.');
  let document;
  try {
    document = JSON.parse(sourceBytes.toString('utf8'));
    assertProtocolArtifact('diagram-document', document, { protocolVersion: '1.6.0' });
  } catch (error) {
    fail('Canonical diagram source is not a valid Protocol 1.6 document.', { cause: error.message });
  }
  return { location, manifest, document };
}

function relativeConsumerPath(outputRoot, value) {
  if (value == null) return null;
  const target = isAbsolute(value) ? value : resolve(outputRoot, value);
  const path = relative(outputRoot, target).replaceAll('\\', '/');
  if (!path || path === '..' || path.startsWith('../')) {
    fail('Diagram consumer path must remain inside the diagram output root.');
  }
  return path;
}

function selectConsumerOutput(manifest, consumer, preferred) {
  const formats = preferred
    ? [preferred]
    : consumer === 'pdf'
      ? ['svg', 'png']
      : ['svg'];
  for (const format of formats) {
    if (!Object.hasOwn(OUTPUT_MEDIA, format)) fail(`Unsupported diagram attachment format: ${format}.`);
    const output = outputBySuffix(manifest, `.${format}`);
    if (output) return output;
  }
  fail(`Diagram set has no verified ${formats.join(' or ')} output.`);
}

export async function createDiagramConsumerReference(manifestPath, {
  consumer,
  consumerPath = null,
  preferredFormat,
} = {}) {
  if (!CONSUMERS.has(consumer)) fail('Diagram consumer must be specification, documentation, or pdf.');
  const set = await verifiedSet(manifestPath);
  const output = selectConsumerOutput(set.manifest, consumer, preferredFormat);
  const outputPath = join(set.location.outputRoot, ...output.path.split('/'));
  const bytes = await readFile(outputPath);
  if (digestBytes(bytes) !== output.digest) fail('Selected diagram output digest changed.');
  const reference = withDocumentDigest({
    kind: 'diagram-consumer-reference',
    schemaVersion: '1.0.0',
    protocolVersion: '1.6.0',
    documentVersion: '1.0.0',
    digestAlgorithm: 'sha256',
    canonicalization: 'rfc8785',
    referenceId: `${set.location.slug}-${consumer}`,
    diagramId: set.location.slug,
    consumer: {
      kind: consumer,
      path: relativeConsumerPath(set.location.outputRoot, consumerPath),
    },
    manifest: {
      path: `diagrams/${set.location.slug}/${set.location.slug}.manifest.json`,
      digest: set.manifest.documentDigest,
    },
    source: { ...set.manifest.source },
    output: {
      path: output.path,
      mediaType: output.mediaType,
      digest: output.digest,
      fidelity: output.fidelity,
    },
    accessibility: {
      title: set.document.accessibility.title,
      description: set.document.accessibility.description,
    },
  });
  assertProtocolArtifact('diagram-consumer-reference', reference, { protocolVersion: '1.6.0' });
  return Object.freeze({ reference, bytes, absolutePath: outputPath });
}

export async function createDiagramSpecificationReference(manifestPath, options = {}) {
  return createDiagramConsumerReference(manifestPath, { ...options, consumer: 'specification' });
}

export async function createDiagramDocumentationReference(manifestPath, options = {}) {
  return createDiagramConsumerReference(manifestPath, { ...options, consumer: 'documentation' });
}

export async function createDiagramPdfAttachment(manifestPath, options = {}) {
  return createDiagramConsumerReference(manifestPath, { ...options, consumer: 'pdf' });
}

function reviewBinding(set, envelope, review = null) {
  validateArtifactEnvelope(envelope);
  if (review) {
    validateArtifactReview(review);
    if (review.reviewOf !== digestArtifactEnvelope(envelope)) {
      fail('Artifact review does not target this diagram envelope.');
    }
  }
  const artifact = envelope.artifacts.find(({ id }) => id === set.location.slug);
  if (!artifact) fail('Artifact envelope does not contain the diagram HTML artifact.');
  const html = outputBySuffix(set.manifest, '.html');
  if (!html || `sha256:${artifact.sha256}` !== html.digest) {
    fail('Artifact envelope HTML does not match the verified diagram render.');
  }
  const binding = withDocumentDigest({
    kind: 'diagram-review-binding',
    schemaVersion: '1.0.0',
    protocolVersion: '1.6.0',
    documentVersion: '1.0.0',
    digestAlgorithm: 'sha256',
    canonicalization: 'rfc8785',
    bindingId: `${set.location.slug}-review`,
    diagramId: set.location.slug,
    manifest: {
      path: `diagrams/${set.location.slug}/${set.location.slug}.manifest.json`,
      digest: set.manifest.documentDigest,
    },
    artifact: {
      artifactId: artifact.id,
      envelopeDigest: `sha256:${digestArtifactEnvelope(envelope)}`,
      htmlDigest: html.digest,
    },
    review: review ? {
      reviewId: review.reviewId,
      reviewDigest: sha256Jcs(review),
      pinIds: review.pins.map(({ id }) => id).sort(),
    } : null,
  });
  assertProtocolArtifact('diagram-review-binding', binding, { protocolVersion: '1.6.0' });
  return binding;
}

export async function createDiagramArtifactEnvelope(manifestPath, { nativeViewport = false } = {}) {
  const set = await verifiedSet(manifestPath);
  const output = outputBySuffix(set.manifest, '.html');
  if (!output) fail('Diagram set has no self-contained HTML output.');
  const htmlPath = join(set.location.outputRoot, ...output.path.split('/'));
  const html = await readFile(htmlPath, 'utf8');
  if (digestBytes(Buffer.from(html)) !== output.digest) fail('Diagram HTML digest changed.');
  let drawing = null;
  if (nativeViewport) {
    const output = outputBySuffix(set.manifest, '.svg');
    if (!output) fail('Diagram set has no SVG drawing.');
    const bytes = await readFile(join(set.location.outputRoot, output.path), 'utf8');
    if (digestBytes(Buffer.from(bytes)) !== output.digest) fail('Diagram SVG digest changed.');
    drawing = prepareDiagramSvg(bytes);
  }
  const scene = drawing?.scene;
  const envelope = createArtifactEnvelope({
    artifacts: [{
      id: set.location.slug,
      title: set.document.title,
      html,
      viewport: scene ? { width: scene.width, height: scene.height } : { width: 1440, height: 900 },
      colorScheme: set.document.theme.mode === 'dark' ? 'dark' : 'light',
    }],
    viewer: {
      mode: 'single',
      activeArtifactId: set.location.slug,
      presentation: 'canvas',
    },
  });
  return Object.freeze({
    envelope,
    binding: reviewBinding(set, envelope),
    htmlPath,
    document: set.document,
    drawing,
    outputRoot: set.location.outputRoot,
    manifest: set.manifest,
  });
}

export async function bindDiagramArtifactReview(manifestPath, envelope, review) {
  const set = await verifiedSet(manifestPath);
  return reviewBinding(set, envelope, review);
}
