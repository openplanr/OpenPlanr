import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolvePipelinePackage } from './pipeline-package-service.js';

export function isDesignDocumentFile(file: string): boolean {
  if (path.extname(file).toLowerCase() !== '.json') return false;
  try {
    return JSON.parse(readFileSync(file, 'utf8')).kind === 'openplanr-design-document';
  } catch (error) {
    if (
      error instanceof SyntaxError &&
      path.basename(file) === 'design-document.json' &&
      existsSync(path.join(path.dirname(file), '.design/current.json'))
    )
      return true;
    throw error;
  }
}

export interface DesignArtifactSession {
  ok: boolean;
  url: string;
  sessionId: string;
  status: string;
  revision: string;
  reviewPath: string;
  draftError?: string;
  close?: () => Promise<void>;
}

interface DesignRuntime {
  renderDesignDocument(file: string): Promise<unknown>;
  currentDesign(file: string): {
    envelope: import('./artifact-pipeline-service.js').ArtifactEnvelope;
  };
}

async function loadDesignRuntime() {
  const pipeline = resolvePipelinePackage(false);
  if (!pipeline)
    throw new Error(
      'Design review requires the OpenPlanr workflow package. Install openplanr or use the design skill’s bundled utility.',
    );
  const [document, review] = await Promise.all([
    import(pathToFileURL(path.join(pipeline.root, 'lib/design/document.mjs')).href),
    import(pathToFileURL(path.join(pipeline.root, 'lib/design/review.mjs')).href),
  ]);
  return {
    document: document as DesignRuntime,
    review: review as {
      startDesignReview(
        file: string,
        options: Record<string, unknown>,
      ): Promise<DesignArtifactSession>;
    },
  };
}

export async function prepareDesignArtifact(file: string) {
  const { document } = await loadDesignRuntime();
  await document.renderDesignDocument(file);
  return document.currentDesign(file).envelope;
}

export async function openDesignArtifact(file: string, options: Record<string, unknown>) {
  const { document, review } = await loadDesignRuntime();
  let draftError: string | undefined;
  try {
    await document.renderDesignDocument(file);
  } catch (error) {
    // A half-written draft must not hide a previously committed review.
    try {
      document.currentDesign(file);
    } catch {
      throw error;
    }
    draftError = error instanceof Error ? error.message : String(error);
  }
  return {
    ...(await review.startDesignReview(file, options)),
    ...(draftError ? { draftError } : {}),
  };
}

interface DesignShareResult {
  ok: boolean;
  shared?: boolean;
  url?: string;
  id?: string;
  publishedRevision?: string;
  reviewPath?: string;
  imported?: number;
  output?: string;
}

export async function runDesignShareAction(
  file: string,
  action: 'share' | 'publish' | 'sync' | 'recovery',
  options: Record<string, unknown> = {},
): Promise<DesignShareResult> {
  const pipeline = resolvePipelinePackage(false);
  if (!pipeline)
    throw new Error(
      'Design sharing requires the OpenPlanr workflow package or the design skill’s bundled utility.',
    );
  if (action === 'share' || action === 'publish') {
    const { document } = await loadDesignRuntime();
    await document.renderDesignDocument(file);
  }
  const runtime = await import(
    pathToFileURL(path.join(pipeline.root, 'lib/design/share.mjs')).href
  );
  const method = {
    share: 'shareDesign',
    publish: 'publishDesignShare',
    sync: 'syncDesignShare',
    recovery: 'exportDesignShareRecovery',
  }[action];
  if (typeof runtime[method] !== 'function')
    throw new Error(
      'The installed workflow package does not support permanent design sharing. Update OpenPlanr first.',
    );
  return runtime[method](file, options);
}

/** Prepare a factual owner handoff. Semantic refinement stays in the host agent. */
export async function prepareDesignHandoff(file: string): Promise<Record<string, unknown>> {
  const { document } = await loadDesignRuntime();
  await document.renderDesignDocument(file);
  const pipeline = resolvePipelinePackage(false);
  if (!pipeline) throw new Error('The OpenPlanr workflow package is unavailable.');
  const runtime = await import(
    pathToFileURL(path.join(pipeline.root, 'lib/design/handoff.mjs')).href
  );
  if (typeof runtime.updateDesignHandoff !== 'function')
    throw new Error(
      'The installed workflow package does not support review handoffs. Update OpenPlanr first.',
    );
  const snapshot = runtime.readDesignHandoff(file);
  return runtime.updateDesignHandoff(file, {
    action: 'draft',
    revision: snapshot.revision,
    version: snapshot.draft?.version ?? 0,
  });
}
