import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalDigest } from './canonical.js';
import { resolveOperatingPipelineRoot } from './protocol.js';
import { OperateError, type OperatingPlanningEngine } from './types.js';
import { resolveContainedPath } from './workspace.js';

export interface PipelinePoBridge<TPrepared = unknown, TCompleted = unknown> {
  preparePlan(input: {
    projectRoot: string;
    feature: string;
    scaffold: boolean;
    createStackTemplate: boolean;
  }): TPrepared | Promise<TPrepared>;
  completePlan(input: {
    projectRoot: string;
    feature: string;
    runtime: string;
    runId: string;
  }): TCompleted | Promise<TCompleted>;
}

export interface OperatingGeneratorBridge {
  prepareOperatingArtifactGeneration(input: Record<string, unknown>): OperatingArtifactSessionLike;
  renderOperatingArtifactTemplate(
    template: Record<string, unknown>,
    variables: Record<string, unknown>,
  ): { content: string; template: Record<string, unknown> };
  startOperatingArtifactGeneration(
    session: OperatingArtifactSessionLike,
    options?: { now?: string },
  ): OperatingArtifactSessionLike;
  validateOperatingArtifactOutput(
    session: OperatingArtifactSessionLike,
    content: string,
    options?: { now?: string },
  ): { session: OperatingArtifactSessionLike; content: string };
  commitOperatingArtifactGeneration(
    session: OperatingArtifactSessionLike,
    options?: { now?: string },
  ): OperatingArtifactSessionLike;
  failOperatingArtifactGeneration(
    session: OperatingArtifactSessionLike,
    failureCode: string,
    options?: { now?: string },
  ): OperatingArtifactSessionLike;
  resumeOperatingArtifactGeneration(
    session: OperatingArtifactSessionLike,
    options?: { now?: string },
  ): OperatingArtifactSessionLike;
}

export type OperatingArtifactSessionLike = Record<string, unknown> & {
  kind: 'operating-artifact-session';
  id: string;
  cycleId: string;
  state: 'prepared' | 'generating' | 'validated' | 'committed' | 'failed' | 'cancelled';
  artifactType: 'markdown' | 'html' | 'json' | 'csv';
  inputDigest: `sha256:${string}`;
  outputDigest?: `sha256:${string}`;
  destination: string;
  evidenceRefs: string[];
  producer: {
    product: string;
    version: string;
    runtime: string;
    capability: 'analysis-standard' | 'analysis-high';
  };
  generation: {
    template: {
      id: string;
      version: string;
      digest: `sha256:${string}`;
    };
    attempt: number;
    maxAttempts: number;
    budget: {
      maxBytes: number;
      maxDurationMs: number;
      maxTokens: number | null;
      maxCostUsd: number | null;
    };
    sandbox: {
      network: 'none';
      filesystem: 'none' | 'project-read-only';
      tools: [];
      allowedUrlSchemes: Array<'https' | 'mailto'>;
    };
  };
  provenance?: {
    templateDigest: `sha256:${string}`;
    inputDigest: `sha256:${string}`;
    outputDigest: `sha256:${string}`;
    generatedAt: string;
  };
  createdAt: string;
  updatedAt: string;
};

async function loadPortablePipelineModule(): Promise<Record<string, unknown>> {
  const root = resolveOperatingPipelineRoot();
  if (!root) {
    throw new OperateError(
      'E_PIPELINE_NOT_INSTALLED',
      'Operating Board routing requires the full planr-pipeline package.',
    );
  }
  return import(pathToFileURL(path.join(root, 'lib', 'pipeline', 'index.mjs')).href);
}

export interface PipelinePoHandoff<TPrepared = unknown> {
  planningEngine: 'pipeline-po';
  feature: string;
  runId: string;
  preparedDigest: `sha256:${string}`;
  prepared: TPrepared;
  invocation: string;
  state: 'awaiting-native-plan';
  shipInvoked: false;
}

export async function loadPipelinePoBridge(): Promise<PipelinePoBridge> {
  const module = (await loadPortablePipelineModule()) as Partial<PipelinePoBridge>;
  if (typeof module.preparePlan !== 'function' || typeof module.completePlan !== 'function') {
    throw new OperateError(
      'E_PIPELINE_NOT_INSTALLED',
      'The installed pipeline does not expose the required PLAN engine API.',
    );
  }
  return module as PipelinePoBridge;
}

export async function loadOperatingGeneratorBridge(): Promise<OperatingGeneratorBridge> {
  const module = (await loadPortablePipelineModule()) as Partial<OperatingGeneratorBridge>;
  if (
    typeof module.prepareOperatingArtifactGeneration !== 'function' ||
    typeof module.renderOperatingArtifactTemplate !== 'function' ||
    typeof module.startOperatingArtifactGeneration !== 'function' ||
    typeof module.validateOperatingArtifactOutput !== 'function' ||
    typeof module.commitOperatingArtifactGeneration !== 'function' ||
    typeof module.failOperatingArtifactGeneration !== 'function' ||
    typeof module.resumeOperatingArtifactGeneration !== 'function'
  ) {
    throw new OperateError(
      'E_PIPELINE_NOT_INSTALLED',
      'The installed pipeline does not expose the Protocol v1.2 operating artifact generator.',
    );
  }
  return module as OperatingGeneratorBridge;
}

async function walkFiles(root: string, maximum = 2_000): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      if (files.length >= maximum) {
        throw new OperateError(
          'E_OPERATE_PLANNER_CONFLICT',
          'Planning producer inspection exceeded its bounded file count.',
        );
      }
      const candidate = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new OperateError(
          'E_OPERATE_PATH_ESCAPE',
          'Planning targets cannot contain symlinks.',
        );
      }
      if (entry.isDirectory()) queue.push(candidate);
      else if (entry.isFile()) files.push(candidate);
    }
  }
  return files.sort();
}

export async function inspectPlanningProducer(input: {
  projectRoot: string;
  targetPath: string;
}): Promise<{
  populated: boolean;
  producer?: OperatingPlanningEngine;
  files: string[];
}> {
  const target = await resolveContainedPath(input.projectRoot, input.targetPath);
  const present = await access(target).then(
    () => true,
    () => false,
  );
  const files = present
    ? (await stat(target)).isDirectory()
      ? await walkFiles(target)
      : [target]
    : [];
  const relativeFiles = files.map((file) =>
    path.relative(input.projectRoot, file).split(path.sep).join('/'),
  );
  const planningFiles = relativeFiles.filter((file) =>
    /(?:^|\/)(?:stories|tasks)\/.+\.(?:md|feature)$/i.test(file),
  );

  const producers = new Set<OperatingPlanningEngine>();
  const provenancePath = path.join(input.projectRoot, '.planr', 'provenance.jsonl');
  const provenance = await readFile(provenancePath, 'utf8').catch(() => '');
  for (const line of provenance.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        artifact_path?: string;
        producer?: { product?: string; phase?: string };
      };
      if (
        event.artifact_path &&
        (event.artifact_path === input.targetPath ||
          event.artifact_path.startsWith(`${input.targetPath.replace(/\/$/, '')}/`))
      ) {
        if (event.producer?.product === 'planr-pipeline' && event.producer.phase === 'po') {
          producers.add('pipeline-po');
        } else if (event.producer?.product === 'openplanr') {
          producers.add('openplanr');
        }
      }
    } catch {
      // Invalid provenance is diagnosed elsewhere; it cannot prove producer ownership.
    }
  }
  if (producers.size > 1) {
    throw new OperateError(
      'E_OPERATE_PLANNER_CONFLICT',
      'The target contains provenance from more than one planning producer.',
      { producers: [...producers].sort(), files: relativeFiles },
    );
  }
  const producer = [...producers][0];
  return {
    populated: planningFiles.length > 0,
    ...(producer ? { producer } : {}),
    files: relativeFiles,
  };
}

export async function hasPipelinePoCompletionProvenance(input: {
  projectRoot: string;
  targetPath: string;
  runId: string;
}): Promise<boolean> {
  const normalizedTarget = input.targetPath.replace(/\/$/, '');
  const provenancePath = path.join(input.projectRoot, '.planr', 'provenance.jsonl');
  const provenance = await readFile(provenancePath, 'utf8').catch(() => '');
  for (const line of provenance.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        artifact_path?: unknown;
        operation?: unknown;
        producer?: { product?: unknown; phase?: unknown };
        run_id?: unknown;
      };
      const artifactPath = typeof event.artifact_path === 'string' ? event.artifact_path : '';
      if (
        event.run_id === input.runId &&
        event.operation === 'decomposed' &&
        event.producer?.product === 'planr-pipeline' &&
        event.producer.phase === 'po' &&
        (artifactPath === normalizedTarget || artifactPath.startsWith(`${normalizedTarget}/`))
      ) {
        return true;
      }
    } catch {
      // Invalid provenance cannot prove completion.
    }
  }
  return false;
}

export async function assertPlanningProducer(input: {
  projectRoot: string;
  targetPath: string;
  selected: OperatingPlanningEngine;
}): Promise<void> {
  const inspection = await inspectPlanningProducer(input);
  if (inspection.populated && (!inspection.producer || inspection.producer !== input.selected)) {
    throw new OperateError(
      'E_OPERATE_PLANNER_CONFLICT',
      'The target already contains planning artifacts from another or unknown producer.',
      {
        selected: input.selected,
        existing: inspection.producer ?? 'unknown',
        files: inspection.files,
      },
    );
  }
}

export async function preparePipelinePoHandoff<TPrepared>(input: {
  bridge: PipelinePoBridge<TPrepared, unknown>;
  projectRoot: string;
  feature: string;
  runtime: string;
  runId: string;
  targetPath: string;
}): Promise<PipelinePoHandoff<TPrepared>> {
  await assertPlanningProducer({
    projectRoot: input.projectRoot,
    targetPath: input.targetPath,
    selected: 'pipeline-po',
  });
  const prepared = await input.bridge.preparePlan({
    projectRoot: input.projectRoot,
    feature: input.feature,
    scaffold: false,
    createStackTemplate: false,
  });
  return {
    planningEngine: 'pipeline-po',
    feature: input.feature,
    runId: input.runId,
    preparedDigest: canonicalDigest(prepared),
    prepared,
    invocation: `planr pipeline plan ${JSON.stringify(input.feature)} --runtime ${input.runtime}`,
    state: 'awaiting-native-plan',
    shipInvoked: false,
  };
}

export async function completePipelinePoHandoff<TPrepared, TCompleted>(input: {
  bridge: PipelinePoBridge<TPrepared, TCompleted>;
  projectRoot: string;
  runtime: string;
  handoff: PipelinePoHandoff<TPrepared>;
  nativePlanCompleted: true;
}): Promise<{
  planningEngine: 'pipeline-po';
  runId: string;
  state: 'plan-completed';
  result: TCompleted;
  shipInvoked: false;
}> {
  if (
    input.nativePlanCompleted !== true ||
    canonicalDigest(input.handoff.prepared) !== input.handoff.preparedDigest
  ) {
    throw new OperateError(
      'E_OPERATE_PLANNER_CONFLICT',
      'Pipeline PO completion requires the unchanged prepared handoff and explicit PLAN completion.',
    );
  }
  const result = await input.bridge.completePlan({
    projectRoot: input.projectRoot,
    feature: input.handoff.feature,
    runtime: input.runtime,
    runId: input.handoff.runId,
  });
  return {
    planningEngine: 'pipeline-po',
    runId: input.handoff.runId,
    state: 'plan-completed',
    result,
    shipInvoked: false,
  };
}
