import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ArtifactCommandError, type ArtifactEnvelope } from './artifact-pipeline-service.js';
import { sha256CanonicalJson } from './canonical-json.js';
import { resolvePipelinePackage } from './pipeline-package-service.js';

export function isDiagramManifestFile(file: string): boolean {
  if (!path.basename(file).endsWith('.manifest.json')) return false;
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    return value.kind === 'diagram-manifest' && typeof value.diagramId === 'string';
  } catch {
    return false;
  }
}

export function isDiagramShareFile(file: string): boolean {
  if (isDiagramManifestFile(file)) return true;
  if (path.extname(file).toLowerCase() !== '.json') return false;
  try {
    return JSON.parse(readFileSync(file, 'utf8')).kind === 'diagram-authoring-bundle';
  } catch {
    return path.basename(file).endsWith('.planr-diagram-bundle.json');
  }
}

export interface DiagramShareResult {
  ok: boolean;
  shared?: boolean;
  title?: string;
  url?: string;
  id?: string;
  localRevision?: string;
  publishedRevision?: string;
  reviewPath?: string;
  imported?: number;
  destination?: string;
  output?: string;
}

async function loadDiagramSharing(entry: 'share' | 'review-bundle') {
  const pipeline = resolvePipelinePackage(false);
  const file = pipeline && path.join(pipeline.root, `lib/artifact/diagram/${entry}.mjs`);
  if (!file || !existsSync(file))
    throw new ArtifactCommandError(
      'E_PIPELINE_VERSION_INCOMPATIBLE',
      'The installed workflow package does not support native encrypted diagram sharing.',
      'Install a compatible OpenPlanr release first.',
    );
  return import(pathToFileURL(file).href);
}

export async function previewDiagramShare(file: string): Promise<{
  title: string;
  source: { digest: string };
  scene: { items: unknown[]; relations: unknown[] };
  destination: string;
  localRevision: string;
}> {
  const runtime = await loadDiagramSharing('review-bundle');
  if (typeof runtime.prepareDiagramShareBundle !== 'function')
    throw new ArtifactCommandError(
      'E_PIPELINE_VERSION_INCOMPATIBLE',
      'The diagram sharing runtime is incompatible.',
      'Update OpenPlanr first.',
    );
  const sharing = await loadDiagramSharing('share');
  if (typeof sharing.getDiagramShareStatus !== 'function')
    throw new ArtifactCommandError(
      'E_PIPELINE_VERSION_INCOMPATIBLE',
      'The diagram sharing runtime cannot preview its destination.',
      'Update OpenPlanr first.',
    );
  const bundle = await runtime.prepareDiagramShareBundle(path.resolve(file));
  const status = await sharing.getDiagramShareStatus(path.resolve(file));
  const localRevision = sha256CanonicalJson(bundle).slice('sha256:'.length);
  if (localRevision !== status.localRevision)
    throw new ArtifactCommandError(
      'E_DIAGRAM_SHARE_PREVIEW_CHANGED',
      'The diagram changed while preparing its sharing preview.',
      'Preview the current diagram and retry.',
    );
  return { ...bundle, destination: status.destination, localRevision };
}

export async function runDiagramShareAction(
  file: string,
  action: 'share' | 'publish' | 'sync' | 'recovery',
  options: Record<string, unknown> = {},
): Promise<DiagramShareResult> {
  const runtime = await loadDiagramSharing('share');
  const method = {
    share: 'shareDiagram',
    publish: 'publishDiagramShare',
    sync: 'syncDiagramShare',
    recovery: 'exportDiagramShareRecovery',
  }[action];
  if (typeof runtime[method] !== 'function')
    throw new ArtifactCommandError(
      'E_PIPELINE_VERSION_INCOMPATIBLE',
      'The diagram sharing runtime is incompatible.',
      'Update OpenPlanr first.',
    );
  return runtime[method](path.resolve(file), options);
}

export interface DiagramStudioSession {
  ok: boolean;
  url: string;
  sessionId: string;
  reviewPath: string;
  close?: () => Promise<void>;
}

interface DiagramArtifactRuntime {
  createDiagramArtifactEnvelope(manifest: string): Promise<{
    envelope: ArtifactEnvelope;
    binding: Record<string, unknown>;
    htmlPath: string;
    manifest: Record<string, unknown>;
  }>;
}

async function loadDiagramArtifactRuntime(): Promise<DiagramArtifactRuntime> {
  const pipeline = resolvePipelinePackage(false);
  if (!pipeline) {
    throw new Error(
      'Diagram review requires the OpenPlanr workflow package. Install a compatible OpenPlanr release and retry.',
    );
  }
  const entry = path.join(pipeline.root, 'lib', 'artifact', 'diagram', 'index.mjs');
  const runtime = (await import(pathToFileURL(entry).href)) as Partial<DiagramArtifactRuntime>;
  if (typeof runtime.createDiagramArtifactEnvelope !== 'function') {
    throw new Error(
      `Installed planr-pipeline ${pipeline.version} does not support diagram review manifests. Update OpenPlanr first.`,
    );
  }
  return runtime as DiagramArtifactRuntime;
}

export async function prepareDiagramArtifact(file: string): Promise<ArtifactEnvelope> {
  const runtime = await loadDiagramArtifactRuntime();
  return (await runtime.createDiagramArtifactEnvelope(path.resolve(file))).envelope;
}

export async function openDiagramArtifact(
  file: string,
  options: Record<string, unknown>,
): Promise<DiagramStudioSession> {
  if (!isDiagramManifestFile(file) && isDiagramShareFile(file)) {
    const suffix = '.planr-diagram-bundle.json';
    const slug = path.basename(file).slice(0, -suffix.length);
    if (
      !path.basename(file).endsWith(suffix) ||
      path.basename(path.dirname(file)) !== slug ||
      path.basename(path.dirname(path.dirname(file))) !== 'diagrams'
    )
      throw new Error(
        'Authored diagrams must use diagrams/{slug}/{slug}.planr-diagram-bundle.json.',
      );
    const owner = await openDiagramOwner({
      root: path.dirname(path.dirname(path.dirname(file))),
      slug,
      noOpen: options.noOpen === true,
      port: options.port as number | undefined,
      openUrl: options.openUrl as ((url: string) => void | Promise<void>) | undefined,
    });
    return { ...owner, reviewPath: '' };
  }
  const pipeline = resolvePipelinePackage(false);
  if (!pipeline) throw new Error('Diagram studio requires the OpenPlanr workflow package.');
  const runtime = await import(
    pathToFileURL(path.join(pipeline.root, 'lib/artifact/diagram-review.mjs')).href
  );
  if (typeof runtime.startDiagramReview !== 'function')
    throw new Error(
      'The installed workflow package does not support the native diagram studio. Update OpenPlanr first.',
    );
  return runtime.startDiagramReview(path.resolve(file), options);
}

/** Programmatic owner bridge; command registration belongs to the authoring CLI slice. */
export async function openDiagramOwner(options: {
  root: string;
  slug: string;
  title?: string;
  grammar?: string;
  noOpen?: boolean;
  openUrl?: (url: string) => void | Promise<void>;
  port?: number;
  env?: Record<string, string | undefined>;
}): Promise<{
  ok: true;
  kind: 'diagram-owner';
  sessionId: string;
  recoveryScope: string;
  baseUrl: string;
  url: string;
  launchError?: string;
  apiBase: string;
  capabilities: { read: true; write: true };
  headers: Record<string, string>;
  close(): Promise<void>;
}> {
  const pipeline = resolvePipelinePackage(false);
  if (!pipeline) throw new Error('Diagram editing requires the OpenPlanr workflow package.');
  const runtime = await import(
    pathToFileURL(path.join(pipeline.root, 'lib/artifact/diagram/editor/local-owner.mjs')).href
  );
  if (typeof runtime.startDiagramOwner !== 'function')
    throw new Error(
      'The installed workflow package does not support diagram editing. Update OpenPlanr first.',
    );
  return runtime.startDiagramOwner({ ...options, root: path.resolve(options.root) });
}
