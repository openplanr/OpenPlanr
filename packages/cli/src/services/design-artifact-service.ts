import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ArtifactCommandError } from './artifact-pipeline-service.js';
import { type PipelinePackage, resolvePipelinePackage } from './pipeline-package-service.js';

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
      'Design review requires the OpenPlanr workflow package. Reinstall openplanr without --omit=optional.',
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
  token?: string;
  pending?: boolean;
}

export type DesignShareAction =
  | 'share'
  | 'publish'
  | 'sync'
  | 'status'
  | 'recovery'
  | 'restore'
  | 'rotate'
  | 'pause'
  | 'resume'
  | 'revoke'
  | 'delete'
  | 'access'
  | 'review-metadata';

export const DESIGN_MANAGE_ACTIONS = [
  'rotate',
  'pause',
  'resume',
  'revoke',
  'delete',
  'access',
  'recovery',
  'restore',
] as const satisfies readonly DesignShareAction[];

export const DESIGN_HANDOFF_ACTIONS = [
  'inspect',
  'draft',
  'update',
  'approve',
  'category',
  'disposition',
] as const;
export type DesignHandoffAction = (typeof DESIGN_HANDOFF_ACTIONS)[number];

const SHARE_METHODS: Record<DesignShareAction, string> = {
  share: 'shareDesign',
  publish: 'publishDesignShare',
  sync: 'syncDesignShare',
  status: 'getDesignShareStatus',
  recovery: 'exportDesignShareRecovery',
  restore: 'importDesignShareRecovery',
  rotate: 'manageDesignShare',
  pause: 'manageDesignShare',
  resume: 'manageDesignShare',
  revoke: 'manageDesignShare',
  delete: 'manageDesignShare',
  access: 'manageDesignShare',
  'review-metadata': 'publishDesignReviewMetadata',
};

const PIPELINE_REINSTALL =
  'Reinstall the CLI with its optional dependencies: npm install -g openplanr (without --omit=optional).';
const RUNTIME_MISSING = {
  code: 'E_DESIGN_RUNTIME_MISSING',
  message:
    'Design commands need the OpenPlanr workflow package (planr-pipeline), which is not installed.',
  fix: PIPELINE_REINSTALL,
} as const;

const SHARE_CODES = { unsupported: 'E_DESIGN_SHARE_UNSUPPORTED', failed: 'E_DESIGN_SHARE_FAILED' };
const UTILITY_CODES = {
  unsupported: 'E_DESIGN_RUNTIME_UNSUPPORTED',
  failed: 'E_DESIGN_UTILITY_FAILED',
};

/** The installed workflow package, which holds the only design sharing implementation. */
function sharingPipeline(): PipelinePackage {
  const pipeline = resolvePipelinePackage(false);
  if (!pipeline)
    throw new ArtifactCommandError(
      'E_DESIGN_SHARE_PIPELINE_MISSING',
      'Design sharing needs the OpenPlanr workflow package (planr-pipeline), which is not installed.',
      PIPELINE_REINSTALL,
    );
  return pipeline;
}

function designPipeline(): PipelinePackage {
  const pipeline = resolvePipelinePackage(false);
  if (!pipeline)
    throw new ArtifactCommandError(
      RUNTIME_MISSING.code,
      RUNTIME_MISSING.message,
      RUNTIME_MISSING.fix,
    );
  return pipeline;
}

async function pipelineModule(pipeline: PipelinePackage, relative: string) {
  return (await import(pathToFileURL(path.join(pipeline.root, relative)).href)) as Record<
    string,
    unknown
  >;
}

/** Gives a design failure that has no public error code a stable one, E_DESIGN_SHARE_FAILED by default. */
function withShareCode(error: unknown, fallback = SHARE_CODES.failed): never {
  const code = (error as { code?: unknown; name?: unknown } | null)?.code;
  const name = (error as { name?: unknown } | null)?.name;
  const coded = [code, name].some(
    (value) => typeof value === 'string' && /^E_[A-Z0-9_]+$/u.test(value),
  );
  if (!coded && error instanceof Error) throw new ArtifactCommandError(fallback, error.message);
  throw error;
}

export async function runDesignShareAction(
  file: string,
  action: DesignShareAction,
  options: Record<string, unknown> = {},
): Promise<DesignShareResult> {
  const pipeline = sharingPipeline();
  try {
    if (action === 'share' || action === 'publish') {
      const { document } = await loadDesignRuntime();
      await document.renderDesignDocument(file);
    }
    const runtime = await pipelineModule(pipeline, 'lib/design/share.mjs');
    const method = runtime[SHARE_METHODS[action]];
    if (typeof method !== 'function')
      throw new ArtifactCommandError(
        'E_DESIGN_SHARE_UNSUPPORTED',
        `The installed workflow package does not support design sharing action "${action}".`,
        'Update OpenPlanr: npm install -g openplanr.',
      );
    if (SHARE_METHODS[action] === 'manageDesignShare')
      return (await method(file, action, options)) as DesignShareResult;
    if (action === 'review-metadata') {
      const { payload, ...rest } = options;
      return (await method(file, payload, rest)) as DesignShareResult;
    }
    return (await method(file, options)) as DesignShareResult;
  } catch (error) {
    return withShareCode(error);
  }
}

/** A new private recovery file path under `PLANR_HOME/design-recovery`. */
export async function defaultDesignRecoveryOutput(): Promise<string> {
  const runtime = await pipelineModule(sharingPipeline(), 'lib/design/recovery-location.mjs');
  if (typeof runtime.defaultDesignRecoveryOutput !== 'function')
    throw new ArtifactCommandError(
      'E_DESIGN_SHARE_UNSUPPORTED',
      'The installed workflow package does not choose a default recovery file location.',
      'Pass --output <path>, or update OpenPlanr: npm install -g openplanr.',
    );
  return String(runtime.defaultDesignRecoveryOutput(process.env));
}

/** Versions the skill helpers compare before they hand a design share operation to this CLI. */
export async function readDesignShareRuntime(cliVersion: string) {
  const pipeline = sharingPipeline();
  const compatPath = path.join(pipeline.root, 'lib/design/share-compat.mjs');
  const compat = existsSync(compatPath)
    ? (await pipelineModule(pipeline, 'lib/design/share-compat.mjs')).DESIGN_SHARE_COMPAT
    : null;
  return {
    ok: true,
    cli: cliVersion,
    pipeline: pipeline.version,
    designShareCompat: typeof compat === 'number' ? compat : null,
  };
}

async function callDesignUtility(
  pipeline: PipelinePackage,
  argv: string[],
  codes: typeof UTILITY_CODES,
  openUrl?: (url: string) => Promise<void>,
): Promise<Record<string, unknown>> {
  try {
    const utility = await pipelineModule(pipeline, 'lib/design/utility.mjs');
    if (typeof utility.designUtility !== 'function')
      throw new ArtifactCommandError(
        codes.unsupported,
        `The installed workflow package does not support design ${argv[0]}.`,
        'Update OpenPlanr: npm install -g openplanr.',
      );
    return (await utility.designUtility(argv, { stdout: () => {}, openUrl })) as Record<
      string,
      unknown
    >;
  } catch (error) {
    return withShareCode(error, codes.failed);
  }
}

/** Runs one workflow package design utility command, such as `inspect <file>`, and returns its result. */
export async function runDesignUtility(
  argv: string[],
  openUrl?: (url: string) => Promise<void>,
): Promise<Record<string, unknown>> {
  return callDesignUtility(designPipeline(), argv, UTILITY_CODES, openUrl);
}

/** Runs the workflow package's own feedback command, which syncs a shared design first. */
export async function runDesignFeedback(
  file: string,
  action: string,
  flags: Record<string, string | boolean | undefined>,
): Promise<Record<string, unknown>> {
  const pipeline = sharingPipeline();
  const argv = ['feedback', file, '--action', action];
  for (const [name, value] of Object.entries(flags)) {
    if (value === undefined || value === false) continue;
    argv.push(`--${name}`);
    if (value !== true) argv.push(value);
  }
  return callDesignUtility(pipeline, argv, SHARE_CODES);
}

/** The design utility contract range, or `pipeline: null` when the workflow package is missing. */
export async function readDesignCapabilities(cliVersion: string) {
  const pipeline = resolvePipelinePackage(false);
  if (!pipeline)
    return {
      ok: false as const,
      ...RUNTIME_MISSING,
      contract: null,
      supported: null,
      cli: cliVersion,
      pipeline: null,
    };
  const utility = await pipelineModule(pipeline, 'lib/design/utility.mjs');
  const contract = utility.DESIGN_UTILITY_CONTRACT;
  const { min, max } = (utility.DESIGN_UTILITY_SUPPORTED ?? {}) as { min?: unknown; max?: unknown };
  const isVersion = (value: unknown): value is number => Number.isInteger(value);
  if (!isVersion(contract) || !isVersion(min) || !isVersion(max))
    throw new ArtifactCommandError(
      UTILITY_CODES.unsupported,
      `The installed workflow package ${pipeline.version} does not report a design command contract.`,
      'Update OpenPlanr: npm install -g openplanr@latest.',
    );
  return {
    ok: true as const,
    contract,
    supported: { min, max },
    cli: cliVersion,
    pipeline: pipeline.version,
  };
}

/** Prepare a factual owner handoff. Semantic refinement stays in the host agent. */
export async function prepareDesignHandoff(file: string): Promise<Record<string, unknown>> {
  const pipeline = sharingPipeline();
  const { document } = await loadDesignRuntime();
  await document.renderDesignDocument(file);
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

/** Inspects or updates a handoff; updates on a shared design also publish owner review metadata. */
export async function runDesignHandoffAction(
  file: string,
  action: Exclude<DesignHandoffAction, 'draft'>,
  input: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const pipeline = sharingPipeline();
  try {
    const runtime = await pipelineModule(pipeline, 'lib/design/handoff.mjs');
    const { readDesignHandoff, updateDesignHandoff } = runtime;
    if (typeof readDesignHandoff !== 'function' || typeof updateDesignHandoff !== 'function')
      throw new ArtifactCommandError(
        'E_DESIGN_SHARE_UNSUPPORTED',
        'The installed workflow package does not support review handoffs.',
        'Update OpenPlanr: npm install -g openplanr.',
      );
    if (action === 'inspect') return (await readDesignHandoff(file)) as Record<string, unknown>;
    const snapshot = (await readDesignHandoff(file)) as {
      revision?: string;
      draft?: { version?: number };
    };
    return (await updateDesignHandoff(file, {
      ...input,
      action,
      revision: input.revision ?? snapshot.revision,
      version: input.version ?? snapshot.draft?.version ?? 0,
    })) as Record<string, unknown>;
  } catch (error) {
    return withShareCode(error);
  }
}
