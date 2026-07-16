import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolvePipelinePackage } from './pipeline-package-service.js';

export interface ArtifactEnvelope {
  schemaVersion: string;
  artifacts: Array<{
    id: string;
    kind: 'html';
    title: string;
    sha256: string;
    html: string;
    viewport: { width: number; height: number };
    colorScheme: 'light' | 'dark';
  }>;
  viewer: {
    mode: 'single' | 'variants';
    activeArtifactId: string;
    presentation?: 'document' | 'canvas';
  };
  review?: Record<string, unknown>;
}

interface ArtifactBundle {
  html: string;
  sha256: string;
  bytes: number;
  inputBytes: number;
  fileCount: number;
}

export interface ArtifactPipelineApi {
  bundleArtifact(options: { entry: string; root: string }): Promise<ArtifactBundle>;
  createArtifactEnvelope(options: {
    artifacts: Array<{
      id: string;
      title: string;
      html: string;
      viewport: { width: number; height: number };
      colorScheme: 'light' | 'dark';
    }>;
    viewer?: ArtifactEnvelope['viewer'];
  }): ArtifactEnvelope;
  createReviewLinkPreview(envelope: ArtifactEnvelope): {
    fragmentLength: number;
    compressedBytes: number;
    ciphertextBytes: number;
    fragmentEligible: boolean;
  };
  createReviewLink(
    envelope: ArtifactEnvelope,
    options: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  createLiveReviewRoom?: (
    envelope: ArtifactEnvelope,
    options: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  hydrateLiveReviewRoom?: (
    source: string,
    options?: Record<string, unknown>,
  ) => Promise<{ envelope: ArtifactEnvelope; review: Record<string, unknown> }>;
  decodeReviewLink(source: string, options?: Record<string, unknown>): Promise<ArtifactEnvelope>;
  importArtifactReview(options: Record<string, unknown>): Promise<Record<string, unknown>>;
  startArtifactReview(options: Record<string, unknown>): Promise<Record<string, unknown>>;
  exportArtifactReviewSession(
    sessionId: string,
    options: { format: 'json' | 'markdown' },
  ): Promise<{ content: string } & Record<string, unknown>>;
}

export class ArtifactCommandError extends Error {
  readonly code: string;
  readonly fix?: string;

  constructor(code: string, message: string, fix?: string) {
    super(message);
    this.name = code;
    this.code = code;
    this.fix = fix;
  }

  toJSON(): Record<string, unknown> {
    return {
      ok: false,
      code: this.code,
      problem: this.message,
      ...(this.fix ? { fix: this.fix } : {}),
    };
  }
}

let cachedApi: Promise<ArtifactPipelineApi> | undefined;

export function loadArtifactPipeline(): Promise<ArtifactPipelineApi> {
  if (cachedApi) return cachedApi;
  cachedApi = (async () => {
    const pipeline = resolvePipelinePackage(false);
    if (!pipeline) {
      throw new ArtifactCommandError(
        'E_PIPELINE_NOT_INSTALLED',
        'Artifact review requires the full OpenPlanr workflow package.',
        'Run `npm install -g openplanr@latest` to install it.',
      );
    }
    const entry = path.join(pipeline.root, 'lib', 'pipeline', 'index.mjs');
    const value = (await import(pathToFileURL(entry).href)) as Partial<ArtifactPipelineApi>;
    const required: Array<keyof ArtifactPipelineApi> = [
      'bundleArtifact',
      'createArtifactEnvelope',
      'createReviewLinkPreview',
      'createReviewLink',
      'decodeReviewLink',
      'importArtifactReview',
      'startArtifactReview',
      'exportArtifactReviewSession',
    ];
    const missing = required.filter((name) => typeof value[name] !== 'function');
    if (missing.length > 0) {
      throw new ArtifactCommandError(
        'E_PIPELINE_VERSION_INCOMPATIBLE',
        `Installed planr-pipeline ${pipeline.version} lacks: ${missing.join(', ')}.`,
        'Run `npm install -g openplanr@latest` to install the compatible pipeline.',
      );
    }
    return value as ArtifactPipelineApi;
  })();
  return cachedApi;
}

function artifactId(file: string, root: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(file)).replaceAll(path.sep, '/');
  const stem = path.basename(file, path.extname(file));
  const slug =
    stem
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'artifact';
  const suffix = createHash('sha256').update(relative).digest('hex').slice(0, 8);
  return `${slug}-${suffix}`;
}

export async function prepareArtifactEnvelope(options: {
  file: string;
  root: string;
  title?: string;
  presentation?: 'auto' | 'document' | 'canvas';
}): Promise<{
  api: ArtifactPipelineApi;
  envelope: ArtifactEnvelope;
  bundle: ArtifactBundle;
  artifactId: string;
  presentation: 'document' | 'canvas';
}> {
  const api = await loadArtifactPipeline();
  const file = path.resolve(options.file);
  const root = path.resolve(options.root);
  const bundle = await api.bundleArtifact({ entry: file, root });
  const id = artifactId(file, root);
  const presentation = options.presentation === 'canvas' ? 'canvas' : 'document';
  const envelope = api.createArtifactEnvelope({
    artifacts: [
      {
        id,
        title: options.title?.trim() || path.basename(file, path.extname(file)),
        html: bundle.html,
        viewport: { width: 1440, height: 900 },
        colorScheme: 'light',
      },
    ],
    ...(options.presentation === 'auto' || options.presentation === undefined
      ? {}
      : {
          viewer: {
            mode: 'single' as const,
            activeArtifactId: id,
            presentation: options.presentation,
          },
        }),
  });
  return { api, envelope, bundle, artifactId: id, presentation };
}

export function withoutArtifactReview(envelope: ArtifactEnvelope): ArtifactEnvelope {
  return {
    schemaVersion: envelope.schemaVersion,
    artifacts: structuredClone(envelope.artifacts),
    viewer: structuredClone(envelope.viewer),
  };
}

export async function openExternalUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ArtifactCommandError(
      'E_ARTIFACT_BROWSER_OPEN_FAILED',
      'Refusing to open a non-HTTP URL.',
    );
  }
  const command =
    process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : process.platform === 'win32'
        ? { file: 'cmd', args: ['/d', '/s', '/c', 'start', '', url] }
        : { file: 'xdg-open', args: [url] };
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export function resetArtifactPipelineForTests(): void {
  cachedApi = undefined;
}
