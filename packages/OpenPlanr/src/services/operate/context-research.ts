import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalDigest, canonicalize, sha256Digest } from './canonical.js';
import { resolveOperatingPipelineRoot } from './protocol.js';
import {
  executeGitReadOnly,
  gitRevisionResolves,
  readGitPathAtRevision,
  readGitPlanrPathAtRevision,
} from './read-only-providers.js';
import { OperateError, type OperatingInitAnswers } from './types.js';
import { assertOperatingProject, resolveOperatingPaths } from './workspace.js';

export interface OperatingContextClaim {
  id: string;
  field:
    | 'purpose'
    | 'stage'
    | 'business-model'
    | 'pricing'
    | 'ideal-customer'
    | 'goal'
    | 'metric'
    | 'architecture'
    | 'delivery-state'
    | 'risk'
    | 'constraint'
    | 'other';
  value: string;
  epistemicStatus: 'observed' | 'inferred' | 'hypothesis' | 'owner-confirmed' | 'unknown';
  confidence: number;
  citations: Array<Record<string, unknown>>;
  ownerNote?: string;
}

interface ResearchApi {
  createOperatingResearchMandate(input: Record<string, unknown>): Record<string, unknown>;
  validateOperatingContextClaims(claims: unknown): OperatingContextClaim[];
}

interface ContextResearchSession {
  version: '1.0.0';
  sessionId: string;
  projectHead: string;
  runtime: string;
  researchMode: 'local' | 'connected';
  consentDigest: string | null;
  mandate: Record<string, unknown>;
  createdAt: string;
}

let cachedApi: Promise<ResearchApi> | null = null;

async function researchApi(): Promise<ResearchApi> {
  cachedApi ??= (async () => {
    const root = resolveOperatingPipelineRoot({ requireMission: true });
    if (!root) {
      throw new OperateError(
        'E_PIPELINE_VERSION_INCOMPATIBLE',
        'Agent-native context research requires planr-pipeline with Protocol v1.4.',
      );
    }
    const loaded = (await import(
      pathToFileURL(path.join(root, 'lib', 'operate', 'research.mjs')).href
    )) as Partial<ResearchApi>;
    if (
      typeof loaded.createOperatingResearchMandate !== 'function' ||
      typeof loaded.validateOperatingContextClaims !== 'function'
    ) {
      throw new OperateError(
        'E_PIPELINE_VERSION_INCOMPATIBLE',
        'Installed planr-pipeline does not expose Protocol v1.4 research helpers.',
      );
    }
    return loaded as ResearchApi;
  })();
  return cachedApi;
}

function contextDirectory(projectRoot: string): string {
  return path.join(resolveOperatingPaths(projectRoot).localRoot, 'context');
}

function sessionPath(projectRoot: string): string {
  return path.join(contextDirectory(projectRoot), 'research-session.json');
}

function contextPath(projectRoot: string): string {
  return path.join(contextDirectory(projectRoot), 'context.json');
}

async function atomicWrite(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${canonicalize(value)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

async function gitHead(projectRoot: string): Promise<string> {
  return (await executeGitReadOnly(projectRoot, ['rev-parse', 'HEAD'])).trim();
}

export async function prepareOperatingContextResearch(input: {
  projectRoot: string;
  runtime: string;
  researchMode?: 'local' | 'connected';
  connectedResearchConsentDigest?: string | null;
  preview?: boolean;
}): Promise<{ sessionId: string; mandate: Record<string, unknown>; instruction: string }> {
  const projectRoot = await assertOperatingProject(input.projectRoot);
  const projectHead = await gitHead(projectRoot);
  const researchMode = input.researchMode ?? 'local';
  const mandate = (await researchApi()).createOperatingResearchMandate({
    cycleId: 'CYCLE-BOOTSTRAP',
    runtime: input.runtime,
    researchMode,
    connectedResearchConsentDigest: input.connectedResearchConsentDigest ?? null,
    focus: ['product-context', 'architecture', 'delivery-state', 'risks', 'goals', 'metrics'],
    roots: ['.'],
  });
  const session: ContextResearchSession = {
    version: '1.0.0',
    sessionId: `CTX-${randomUUID()}`,
    projectHead,
    runtime: String((mandate.runtimeBinding as { runtime?: unknown }).runtime ?? input.runtime),
    researchMode,
    consentDigest: input.connectedResearchConsentDigest ?? null,
    mandate,
    createdAt: new Date().toISOString(),
  };
  if (!input.preview) await atomicWrite(sessionPath(projectRoot), session);
  return {
    sessionId: session.sessionId,
    mandate,
    instruction:
      'Inspect the workspace directly using the selected runtime. Return a JSON array of Protocol v1.4 context claims. Research before asking; label every claim observed, inferred, hypothesis, owner-confirmed, or unknown.',
  };
}

async function citationResolves(
  projectRoot: string,
  session: ContextResearchSession,
  citation: Record<string, unknown>,
): Promise<boolean> {
  if (citation.kind === 'repository') {
    const blob = await readGitPathAtRevision(
      projectRoot,
      String(citation.revision),
      String(citation.path),
    );
    return (
      blob.exists &&
      Number(citation.startLine) <= Number(citation.endLine) &&
      Number(citation.endLine) <= blob.lineCount
    );
  }
  if (citation.kind === 'git') {
    return gitRevisionResolves(projectRoot, String(citation.revision));
  }
  if (citation.kind === 'planr') {
    const blob = await readGitPlanrPathAtRevision(
      projectRoot,
      session.projectHead,
      String(citation.path),
    );
    return blob.exists && sha256Digest(blob.content ?? '') === citation.digest;
  }
  if (citation.kind === 'external') {
    return session.researchMode === 'connected' && Boolean(session.consentDigest);
  }
  return false;
}

export async function recordOperatingContextResearch(input: {
  projectRoot: string;
  stdin?: string;
}): Promise<{
  claims: OperatingContextClaim[];
  rejected: Array<{ id: string; reason: string }>;
  contextDigest: string;
}> {
  const projectRoot = await assertOperatingProject(input.projectRoot);
  if (!input.stdin) {
    throw new OperateError(
      'E_OPERATE_INPUT_REQUIRED',
      'Context review requires one JSON array of runtime-authored context claims on stdin.',
    );
  }
  const session = JSON.parse(
    await readFile(sessionPath(projectRoot), 'utf8'),
  ) as ContextResearchSession;
  if ((await gitHead(projectRoot)) !== session.projectHead) {
    throw new OperateError(
      'E_OPERATE_SESSION_STALE',
      'The workspace changed after context research was prepared. Refresh context research.',
    );
  }
  let submitted: unknown;
  try {
    submitted = JSON.parse(input.stdin);
  } catch {
    throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Context claims must be one JSON array.');
  }
  let claims: OperatingContextClaim[];
  try {
    claims = (await researchApi()).validateOperatingContextClaims(submitted);
  } catch (error) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      error instanceof Error ? error.message : 'Context claims failed Protocol v1.4 validation.',
    );
  }
  const accepted: OperatingContextClaim[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];
  for (const claim of claims) {
    const results = await Promise.all(
      claim.citations.map((citation) => citationResolves(projectRoot, session, citation)),
    );
    if (claim.epistemicStatus !== 'unknown' && results.some((result) => !result)) {
      rejected.push({ id: claim.id, reason: 'one or more citations did not resolve' });
      continue;
    }
    accepted.push(claim);
  }
  const context = {
    kind: 'operating-context',
    schemaVersion: '1.0.0',
    protocolVersion: '1.4.0',
    runtime: session.runtime,
    projectHead: session.projectHead,
    mandateDigest: session.mandate.mandateDigest,
    claims: accepted,
    rejected,
    updatedAt: new Date().toISOString(),
  };
  await atomicWrite(contextPath(projectRoot), context);
  return { claims: accepted, rejected, contextDigest: canonicalDigest(context) };
}

export async function readOperatingContextResearch(projectRoot: string): Promise<unknown> {
  const root = await assertOperatingProject(projectRoot);
  return JSON.parse(await readFile(contextPath(root), 'utf8')) as unknown;
}

function bestClaims(
  claims: OperatingContextClaim[],
  field: OperatingContextClaim['field'],
): OperatingContextClaim[] {
  return claims
    .filter((claim) => claim.field === field && claim.epistemicStatus !== 'unknown')
    .sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id));
}

function firstValue(
  claims: OperatingContextClaim[],
  field: OperatingContextClaim['field'],
  fallback: string,
): string {
  return bestClaims(claims, field)[0]?.value.trim() || fallback;
}

function normalizedStage(claims: OperatingContextClaim[]): string {
  const raw = firstValue(claims, 'stage', 'launched').toLowerCase();
  if (/\bidea\b/.test(raw)) return 'idea';
  if (/\bprototype|pre[- ]?launch|mvp\b/.test(raw)) return 'prototype';
  if (/\bgrowth|scal(e|ing)|expansion\b/.test(raw)) return 'growth';
  if (/\bmature|established|steady[- ]?state\b/.test(raw)) return 'mature';
  return 'launched';
}

/**
 * Seed the legacy initialization record from validated Protocol v1.4 research.
 * The epistemic status remains in the machine-local context sidecar; using the
 * claim in the charter does not promote it to owner-confirmed. Explicit CLI or
 * runtime answers always win when these defaults are merged by the caller.
 */
export async function operatingInitializationAnswersFromResearch(
  projectRoot: string,
): Promise<OperatingInitAnswers | null> {
  let stored: unknown;
  try {
    stored = await readOperatingContextResearch(projectRoot);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' ||
      (error instanceof OperateError && error.code === 'E_OPERATE_PROJECT_REQUIRED')
    ) {
      return null;
    }
    throw error;
  }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
  const record = stored as { claims?: unknown };
  if (!Array.isArray(record.claims)) return null;
  const claims = record.claims.filter(
    (claim): claim is OperatingContextClaim =>
      Boolean(claim) && typeof claim === 'object' && !Array.isArray(claim),
  );
  const purposes = bestClaims(claims, 'purpose');
  const goals = bestClaims(claims, 'goal')
    .map((claim) => claim.value.trim())
    .filter(Boolean);
  const metrics = bestClaims(claims, 'metric')
    .map((claim) => claim.value.trim())
    .filter(Boolean);
  const risks = bestClaims(claims, 'risk')
    .map((claim) => claim.value.trim())
    .filter(Boolean);
  const constraints = bestClaims(claims, 'constraint')
    .map((claim) => claim.value.trim())
    .filter(Boolean);
  const unknowns = claims
    .filter((claim) => claim.epistemicStatus === 'unknown')
    .map((claim) => claim.value.trim())
    .filter(Boolean);
  return {
    profile: 'saas',
    planningEngine: 'openplanr',
    cadence: 'manual',
    sensitivityCeiling: 'internal',
    componentRoots: [],
    charter: {
      purpose:
        purposes[0]?.value.trim() ||
        'Product purpose remains provisional and will be refined by the first operating cycle.',
      stage: normalizedStage(claims),
      businessModel: firstValue(claims, 'business-model', 'Not yet specified'),
      idealCustomer: firstValue(claims, 'ideal-customer', 'Not yet specified'),
      goals:
        goals.length > 0 ? goals : ['Clarify and prioritize the highest-leverage product outcome.'],
      constraints,
      successMetrics:
        metrics.length > 0
          ? metrics
          : ['Define an owner-confirmed baseline and target during this operating cycle.'],
      guardrails: [
        'No external or irreversible action without explicit human authority.',
        'Operate may propose work but never invokes PLAN or SHIP automatically.',
      ],
      knownUnknowns: [...new Set([...unknowns, ...risks])],
    },
  };
}
