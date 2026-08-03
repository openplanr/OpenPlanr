import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
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

// ---------------------------------------------------------------------------
// Shared citation-bearing bootstrap map (FR12)
// ---------------------------------------------------------------------------
//
// FR12 forbids the two mechanisms this project deliberately retired — pre-collected
// evidence-pack INPUTS handed to agents, and repository-size ceilings — and demands
// that efficiency come instead from better targeting. The bootstrap map is that
// targeting layer: ONE summary of the project's own planning and git indexes, built
// once per cycle and referenced by every role's mandate so five advisory lenses stop
// independently re-walking the same tree to rediscover what already exists.
//
// It is emphatically NOT an evidence pack. Every entry is a body-free POINTER: a
// short label, a locator, and a resolvable citation (a git revision, or a `.planr`
// path bound to a content digest the role can verify itself). No file body, no
// collected snapshot, and no size gate is ever attached — each role remains free to
// inspect the project directly and investigate further. The map only tells a lens
// WHERE to look first, never substitutes for its own reading.

const BOOTSTRAP_MAP_MAX_GIT_COMMITS = 8;
const BOOTSTRAP_MAP_MAX_READ_BYTES = 256 * 1024;
const BOOTSTRAP_MAP_MAX_FAMILY_WALK = 4_000;
// A well-formed representative-file citation path: repository-relative, no `..`,
// each segment starting alphanumeric (so dot-prefixed internals like `.state` are
// skipped rather than emitted as a malformed planr citation).
const BOOTSTRAP_MAP_CITABLE_PATH = /^\.planr(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export interface OperatingBootstrapMapCitation {
  kind: 'git' | 'planr';
  revision?: string;
  path?: string;
  digest?: `sha256:${string}`;
}

export interface OperatingBootstrapMapEntry {
  /** Which existing index this pointer summarizes. */
  index: 'git-history' | 'planning-artifacts';
  /** A body-free human summary — never file content. */
  label: string;
  /** A locator (a `.planr/` path or an ISO commit date) for the role to open directly. */
  location: string;
  /** A resolvable citation the role can verify without trusting this summary. */
  citation: OperatingBootstrapMapCitation;
}

export interface OperatingBootstrapMap {
  kind: 'operating-bootstrap-map';
  schemaVersion: '1.0.0';
  /** The project HEAD the map was summarized at, or null when git was unavailable. */
  projectHead: string | null;
  /** Citation-bearing pointers into the planning and git indexes. */
  entries: OperatingBootstrapMapEntry[];
  /** Dedup hint: top-level workspace roots, so a lens scopes rather than re-globbing the tree. */
  workspaceRoots: string[];
  /** Search/read deduplication hints referencing the indexes above. */
  searchHints: string[];
  mapDigest: `sha256:${string}`;
}

const bootstrapMapCache = new Map<string, OperatingBootstrapMap>();

/** Test-only: clear the per-(root, head) bootstrap-map cache between fixtures. */
export function _resetOperatingBootstrapMapCache(): void {
  bootstrapMapCache.clear();
}

async function bootstrapMapGitHead(projectRoot: string): Promise<string | null> {
  try {
    const head = (await executeGitReadOnly(projectRoot, ['rev-parse', 'HEAD'])).trim();
    return /^[a-f0-9]{7,64}$/.test(head) ? head : null;
  } catch {
    return null;
  }
}

async function bootstrapGitHistoryEntries(
  projectRoot: string,
  head: string | null,
): Promise<OperatingBootstrapMapEntry[]> {
  if (!head) return [];
  try {
    const stdout = await executeGitReadOnly(projectRoot, [
      'log',
      '-n',
      String(BOOTSTRAP_MAP_MAX_GIT_COMMITS),
      '--no-color',
      '--format=%H%x1f%cI%x1f%s',
    ]);
    return stdout
      .split('\n')
      .filter(Boolean)
      .slice(0, BOOTSTRAP_MAP_MAX_GIT_COMMITS)
      .flatMap((line) => {
        const [revision, when = '', subject = ''] = line.split('\x1f');
        if (!/^[a-f0-9]{7,64}$/.test(revision ?? '')) return [];
        return [
          {
            index: 'git-history' as const,
            label: subject.slice(0, 200) || '(no subject)',
            location: when,
            citation: { kind: 'git' as const, revision },
          },
        ];
      });
  } catch {
    return [];
  }
}

/** A body-free citation for one representative planning file: its path plus a content digest. */
async function bootstrapPlanrCitation(
  projectRoot: string,
  absoluteFile: string,
): Promise<OperatingBootstrapMapCitation | null> {
  const relative = path.relative(projectRoot, absoluteFile).split(path.sep).join('/');
  if (!BOOTSTRAP_MAP_CITABLE_PATH.test(relative)) return null;
  try {
    const info = await stat(absoluteFile);
    if (!info.isFile() || info.size > BOOTSTRAP_MAP_MAX_READ_BYTES) {
      return { kind: 'planr', path: relative };
    }
    const content = await readFile(absoluteFile, 'utf8');
    return { kind: 'planr', path: relative, digest: sha256Digest(content) };
  } catch {
    return { kind: 'planr', path: relative };
  }
}

/** Count planning artifacts under a `.planr/` family and pick the lowest-sorted representative file. */
async function summarizePlanningFamily(
  familyRoot: string,
): Promise<{ count: number; representative: string | null }> {
  let count = 0;
  let representative: string | null = null;
  const stack: string[] = [familyRoot];
  while (stack.length > 0 && count <= BOOTSTRAP_MAP_MAX_FAMILY_WALK) {
    const current = stack.pop() as string;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name.startsWith('.')) continue;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else if (entry.isFile()) {
        count += 1;
        if (!representative || child.localeCompare(representative) < 0) representative = child;
      }
    }
  }
  return { count, representative };
}

async function bootstrapPlanningEntries(
  projectRoot: string,
): Promise<OperatingBootstrapMapEntry[]> {
  const planrRoot = path.join(projectRoot, '.planr');
  const children = await readdir(planrRoot, { withFileTypes: true }).catch(() => []);
  const entries: OperatingBootstrapMapEntry[] = [];
  for (const child of [...children].sort((left, right) => left.name.localeCompare(right.name))) {
    if (child.name.startsWith('.')) continue;
    const location = `.planr/${child.name}`;
    if (child.isDirectory()) {
      const { count, representative } = await summarizePlanningFamily(
        path.join(planrRoot, child.name),
      );
      if (count === 0) continue;
      const citation =
        (representative ? await bootstrapPlanrCitation(projectRoot, representative) : null) ??
        ({ kind: 'planr', path: location } as OperatingBootstrapMapCitation);
      entries.push({
        index: 'planning-artifacts',
        label: `${count} planning artifact${count === 1 ? '' : 's'} under ${location}`,
        location,
        citation,
      });
    } else if (child.isFile()) {
      const citation =
        (await bootstrapPlanrCitation(projectRoot, path.join(planrRoot, child.name))) ??
        ({ kind: 'planr', path: location } as OperatingBootstrapMapCitation);
      entries.push({
        index: 'planning-artifacts',
        label: location,
        location,
        citation,
      });
    }
  }
  return entries;
}

async function bootstrapWorkspaceRoots(projectRoot: string): Promise<string[]> {
  const found = new Set<string>(['.planr']);
  const entries = await readdir(projectRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    found.add(entry.name);
  }
  return [...found].sort();
}

/**
 * Build the ONE shared, citation-bearing bootstrap map for a cycle (FR12). It is a
 * body-free summary of the project's OWN planning and git indexes, cached per
 * (project, HEAD) so five role mandates reference the same map instead of each
 * re-walking the repository. Every read is bounded and fail-soft: a missing git
 * history, a gitignored `.planr/`, or an unreadable family simply yields fewer
 * pointers — never a failure and never a repository-size ceiling. The map narrows
 * where a lens looks first; it never caps what a lens may examine.
 */
export async function buildOperatingBootstrapMap(
  projectRoot: string | undefined,
  options: { refresh?: boolean } = {},
): Promise<OperatingBootstrapMap> {
  const emptyMap = (head: string | null): OperatingBootstrapMap => {
    const unsigned = {
      kind: 'operating-bootstrap-map' as const,
      schemaVersion: '1.0.0' as const,
      projectHead: head,
      entries: [] as OperatingBootstrapMapEntry[],
      workspaceRoots: [] as string[],
      searchHints: [] as string[],
    };
    return { ...unsigned, mapDigest: canonicalDigest(unsigned) };
  };
  if (!projectRoot) return emptyMap(null);
  const resolvedRoot = path.resolve(projectRoot);
  const head = await bootstrapMapGitHead(resolvedRoot);
  const cacheKey = head ? `${resolvedRoot}::${head}` : null;
  if (cacheKey && !options.refresh) {
    const cached = bootstrapMapCache.get(cacheKey);
    if (cached) return cached;
  }
  const [gitEntries, planningEntries, workspaceRoots] = await Promise.all([
    bootstrapGitHistoryEntries(resolvedRoot, head),
    bootstrapPlanningEntries(resolvedRoot),
    bootstrapWorkspaceRoots(resolvedRoot),
  ]);
  const entries = [...planningEntries, ...gitEntries];
  const searchHints: string[] = [];
  if (planningEntries.length > 0) {
    searchHints.push(
      'Planning artifacts are already indexed above; open the cited `.planr/` families directly instead of re-walking the workspace to rediscover product intent.',
    );
  }
  if (gitEntries.length > 0) {
    searchHints.push(
      'Recent history is summarized above; target the cited revisions rather than re-running a broad, unbounded git log.',
    );
  }
  if (workspaceRoots.length > 0) {
    searchHints.push(
      'Top-level workspace roots are enumerated above; scope searches to the roots relevant to your lens rather than re-globbing the entire tree.',
    );
  }
  const unsigned = {
    kind: 'operating-bootstrap-map' as const,
    schemaVersion: '1.0.0' as const,
    projectHead: head,
    entries,
    workspaceRoots,
    searchHints,
  };
  const map: OperatingBootstrapMap = { ...unsigned, mapDigest: canonicalDigest(unsigned) };
  if (cacheKey) bootstrapMapCache.set(cacheKey, map);
  return map;
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
