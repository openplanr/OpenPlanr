import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  assertOperatingOriginV1,
  assertOperatingPlanningProposalV1,
  createOperatingOriginV1,
} from 'planr-pipeline/operate/planning-bridge-v2';
import { sha256Jcs, validateProtocolArtifact } from 'planr-pipeline/protocol';
import type { OpenPlanrConfig } from '../../models/types.js';
import { parseMarkdown } from '../../utils/markdown.js';
import {
  appendOpenPlanrProvenance,
  type ProvenanceAppendHooks,
  readOpenPlanrVersion,
} from '../provenance-service.js';
import {
  getSpecDesignDir,
  getSpecStoriesDir,
  getSpecsRootDir,
  getSpecTasksDir,
  prepareOperatingSpecDraft,
} from '../spec-service.js';

const ORIGIN_FILE = 'operating-origin.json';
const LOCK_FILE = '.operate-planning.lock';
const LOCK_WAIT_ATTEMPTS = 250;
const LOCK_WAIT_MS = 20;

type JsonRecord = Record<string, unknown>;

export type OperatingSpecCreationReceipt = {
  transactionId: string;
  receiptHash: string;
  correlationId: string;
  proposalId: string;
  proposalHash: string;
  specId: string;
  slug: string;
  specDir: string;
  specFile: string;
  contentHash: string;
  originPath: string;
  originHash: string;
  provenanceEventId: string;
  replayed: boolean;
};

export type OperatingSpecCreationHooks = {
  /** @internal deterministic crash injection used only by transaction tests. */
  afterSpecPublish?: () => Promise<void> | void;
  /** @internal deterministic crash injection used only by transaction tests. */
  beforeProvenanceWrite?: () => Promise<void> | void;
  /** @internal deterministic crash injection used only by transaction tests. */
  afterProvenancePartialWrite?: () => Promise<void> | void;
  /** @internal deterministic crash injection used only by transaction tests. */
  afterProvenanceSyncBeforeReturn?: () => Promise<void> | void;
};

export type OperatingOriginAuthority = Readonly<{
  actorId: string;
  cycleId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  specId: string;
  originHash: string;
}>;

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function hashText(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${sha256Jcs(value as never).slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return sha256Jcs(left as never) === sha256Jcs(right as never);
}

function contained(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function acquireLock(specsRoot: string): Promise<() => Promise<void>> {
  await mkdir(specsRoot, { recursive: true });
  const lockPath = path.join(specsRoot, LOCK_FILE);
  for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt += 1) {
    try {
      const handle = await open(
        lockPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      );
      await handle.sync();
      await handle.close();
      return async () => await rm(lockPath, { force: true });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
    }
  }
  fail(
    'E_OPERATE_PLANNING_CONCURRENT',
    'Another Planning promotion still owns the project-local transaction lock.',
  );
}

async function publishedOrigins(
  specsRoot: string,
): Promise<Array<{ origin: JsonRecord; specDir: string }>> {
  const entries = await readdir(specsRoot, { withFileTypes: true });
  const results: Array<{ origin: JsonRecord; specDir: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^(?:SPEC|FEAT)-\d{3}-[a-z0-9-]+$/u.test(entry.name)) continue;
    const specDir = path.join(specsRoot, entry.name);
    try {
      const origin = await readSpecOperatingOrigin(specDir);
      results.push({ origin, specDir });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') continue;
      fail(
        'E_OPERATE_ORIGIN_INVALID',
        'A published operating-origin sidecar is invalid and requires explicit recovery.',
      );
    }
  }
  return results;
}

async function appendCorrelatedProvenance(input: {
  projectDir: string;
  specId: string;
  specFile: string;
  proposalId: string;
  proposalHash: string;
  correlationId: string;
  transactionId: string;
  receiptHash: string;
  eventId: string;
  timestamp: string;
  hooks?: ProvenanceAppendHooks;
}): Promise<void> {
  await appendOpenPlanrProvenance(
    {
      projectDir: input.projectDir,
      artifactId: input.specId,
      artifactPath: input.specFile,
      operation: 'created',
      productVersion: readOpenPlanrVersion(),
      runtime: 'openplanr',
      phase: 'planning',
      runId: input.transactionId,
      eventId: input.eventId,
      timestamp: input.timestamp,
      correlation: {
        correlation_id: input.correlationId,
        proposal_id: input.proposalId,
        proposal_hash: input.proposalHash,
        transaction_id: input.transactionId,
        receipt_hash: input.receiptHash,
      },
    },
    input.hooks,
  );
}

function receiptFromOrigin(
  origin: JsonRecord,
  specDir: string,
  replayed: boolean,
): OperatingSpecCreationReceipt {
  const spec = origin.spec as JsonRecord;
  const transaction = origin.transaction as JsonRecord;
  const specId = String(spec.specId);
  const slug = String(spec.slug);
  return {
    transactionId: String(transaction.transactionId),
    receiptHash: String(transaction.receiptHash),
    correlationId: String(origin.correlationId),
    proposalId: String(origin.proposalId),
    proposalHash: String(origin.proposalHash),
    specId,
    slug,
    specDir,
    specFile: path.join(specDir, `${specId}-${slug}.md`),
    contentHash: String(spec.contentHash),
    originPath: path.join(specDir, ORIGIN_FILE),
    originHash: String(origin.originHash),
    provenanceEventId: String(transaction.planningProvenanceEventId),
    replayed,
  };
}

async function reconcilePublished(
  projectDir: string,
  proposal: JsonRecord,
  match: { origin: JsonRecord; specDir: string },
): Promise<OperatingSpecCreationReceipt> {
  const origin = match.origin;
  if (
    origin.proposalHash !== proposal.proposalHash ||
    origin.proposalRevision !== proposal.revision ||
    origin.correlationId !== proposal.correlationId
  ) {
    fail(
      'E_OPERATE_PLANNING_CONFLICT',
      'The proposal identity is already bound to different published custody.',
    );
  }
  const receipt = receiptFromOrigin(origin, match.specDir, true);
  const content = await readFile(receipt.specFile, 'utf8').catch(() =>
    fail(
      'E_OPERATE_ORIGIN_INVALID',
      'The published SPEC referenced by operating origin is missing.',
    ),
  );
  if (hashText(content) !== receipt.contentHash) {
    fail(
      'E_OPERATE_ORIGIN_INVALID',
      'The published SPEC content no longer matches its operating origin.',
    );
  }
  await appendCorrelatedProvenance({
    projectDir,
    specId: receipt.specId,
    specFile: receipt.specFile,
    proposalId: receipt.proposalId,
    proposalHash: receipt.proposalHash,
    correlationId: receipt.correlationId,
    transactionId: receipt.transactionId,
    receiptHash: receipt.receiptHash,
    eventId: receipt.provenanceEventId,
    timestamp: String(origin.createdAt),
  });
  return receipt;
}

/**
 * Promote one confirmed planning proposal into a SPEC, closed origin sidecar,
 * and separately appended provenance record. Directory rename is the SPEC +
 * origin commit point; a missing provenance append is reconciled on exact retry.
 */
export async function createSpecFromOperatingProposal(input: {
  projectDir: string;
  config: OpenPlanrConfig;
  proposal: JsonRecord;
  actor: { actorId: string; kind: 'human' };
  hooks?: OperatingSpecCreationHooks;
}): Promise<OperatingSpecCreationReceipt> {
  assertOperatingPlanningProposalV1(input.proposal as never);
  if (
    input.proposal.state !== 'approved' ||
    input.actor.actorId !== (input.proposal.confirmation as JsonRecord)?.actorId ||
    input.actor.kind !== 'human'
  ) {
    fail(
      'E_OPERATE_PLANNING_CONFIRMATION',
      'Only the exact confirmed human proposal may create a SPEC.',
    );
  }
  const specsRoot = getSpecsRootDir(input.projectDir, input.config);
  const release = await acquireLock(specsRoot);
  let staging: string | null = null;
  try {
    const matches = (await publishedOrigins(specsRoot)).filter(
      ({ origin }) => origin.proposalId === input.proposal.proposalId,
    );
    if (matches.length > 1)
      fail('E_OPERATE_PLANNING_CONFLICT', 'Duplicate published custody exists for this proposal.');
    if (matches.length === 1)
      return await reconcilePublished(input.projectDir, input.proposal, matches[0]);

    const framing = input.proposal.framing as JsonRecord;
    const decision = input.proposal.decision as JsonRecord;
    const action = input.proposal.action as JsonRecord;
    const verification = input.proposal.verification as JsonRecord;
    const draft = await prepareOperatingSpecDraft(input.projectDir, input.config, {
      title: String(framing.title),
      slug: String(framing.slug),
      actorId: input.actor.actorId,
      framing: {
        problem: String(framing.problem),
        objective: String(framing.objective),
        users: framing.users as string[],
        scope: framing.scope as string[],
        nonScope: framing.nonScope as string[],
        risks: framing.risks as string[],
        constraints: framing.constraints as string[],
        requirements: framing.requirements as string[],
        acceptanceOutcomes: framing.acceptanceOutcomes as string[],
      },
      operatingOrigin: {
        correlationId: String(input.proposal.correlationId),
        proposalId: String(input.proposal.proposalId),
        cycleId: String(input.proposal.cycleId),
        decision: {
          decisionId: String(decision.decisionId),
          revision: Number(decision.revision),
          title: String(decision.title),
          outcome: String(decision.outcome),
          rationale: String(decision.rationale),
        },
        action: {
          actionId: String(action.actionId),
          revision: Number(action.revision),
          expectedResult: String(action.expectedResult),
        },
        perspectives: (input.proposal.acceptedPerspectiveSummaries as JsonRecord[]).map(
          (perspective) => ({
            roleId: String(perspective.roleId),
            roleKind: perspective.roleKind as 'advisor' | 'challenger' | 'chair',
            stance: String(perspective.stance),
            summary: String(perspective.summary),
            constraints: perspective.constraints as string[],
            uncertainties: perspective.uncertainties as string[],
          }),
        ),
        evidence: (input.proposal.evidence as JsonRecord[]).map((entry) => ({
          evidenceRefId: String(entry.evidenceRefId),
          relation: String(entry.relation),
          freshness: String(entry.freshness),
          confidence: Number(entry.confidence),
          accessState: String(entry.accessState),
          summary: entry.summary === null ? null : String(entry.summary),
          limitations: entry.limitations as string[],
        })),
        omissions: (input.proposal.omissions as JsonRecord[]).map((entry) => ({
          count: Number(entry.count),
          reason: String(entry.reason),
        })),
        verification: {
          metricId: String(verification.metricId),
          baseline: Number(verification.baseline),
          target: Number(verification.target),
          window: String(verification.window),
          method: String(verification.method),
        },
      },
      createdAt: String((input.proposal.confirmation as JsonRecord).confirmedAt),
    });
    if (!contained(specsRoot, draft.specDir) || !contained(draft.specDir, draft.specFile)) {
      fail(
        'E_OPERATE_PLANNING_PATH',
        'The planned SPEC path escapes the configured planning root.',
      );
    }
    let stagedFrontmatter: JsonRecord;
    try {
      stagedFrontmatter = parseMarkdown(draft.content).data as JsonRecord;
    } catch {
      fail('E_OPERATE_PLANNING_INVALID', 'The staged SPEC frontmatter is not canonical YAML.');
    }
    const expectedFrontmatter = {
      id: draft.id,
      title: String(framing.title),
      slug: draft.slug,
      schemaVersion: '1.7.0',
      status: 'shaping',
      priority: 'P1',
      po: input.actor.actorId,
      created: String((input.proposal.confirmation as JsonRecord).confirmedAt).slice(0, 10),
      updated: String((input.proposal.confirmation as JsonRecord).confirmedAt).slice(0, 10),
      ui_files: [],
      tech_dependencies: [],
    };
    if (
      validateProtocolArtifact('spec', stagedFrontmatter, { protocolVersion: '1.7.0' }).length >
        0 ||
      !sameJson(stagedFrontmatter, expectedFrontmatter)
    ) {
      fail(
        'E_OPERATE_PLANNING_INVALID',
        'The staged SPEC frontmatter differs from its exact closed Planning draft.',
      );
    }
    const contentHash = hashText(draft.content);
    const transactionId = stableId('txn', {
      proposalId: input.proposal.proposalId,
      proposalHash: input.proposal.proposalHash,
      specId: draft.id,
      slug: draft.slug,
      contentHash,
    });
    const provenanceEventId = stableId('prv', { transactionId, artifactId: draft.id });
    const receiptHash = sha256Jcs({
      transactionId,
      correlationId: String(input.proposal.correlationId),
      proposalId: String(input.proposal.proposalId),
      proposalHash: String(input.proposal.proposalHash),
      specId: draft.id,
      slug: draft.slug,
      contentHash,
      provenanceEventId,
    });
    const createdAt = String((input.proposal.confirmation as JsonRecord).confirmedAt);
    const origin = createOperatingOriginV1({
      proposal: input.proposal as never,
      spec: { specId: draft.id, slug: draft.slug, contentHash, status: 'shaping' },
      actor: input.actor,
      transaction: { transactionId, receiptHash, planningProvenanceEventId: provenanceEventId },
      createdAt,
    }) as unknown as JsonRecord;

    staging = path.join(specsRoot, `.operate-planning-txn-${transactionId.slice(4)}`);
    await mkdir(staging, { recursive: false, mode: 0o700 });
    const stagedSpecFile = path.join(staging, path.basename(draft.specFile));
    await mkdir(getSpecStoriesDir(staging), { recursive: true });
    await mkdir(getSpecTasksDir(staging), { recursive: true });
    await mkdir(getSpecDesignDir(staging), { recursive: true });
    await writeFile(stagedSpecFile, draft.content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await writeFile(path.join(getSpecDesignDir(staging), '.gitkeep'), '', {
      flag: 'wx',
      mode: 0o600,
    });
    await writeFile(path.join(staging, ORIGIN_FILE), `${JSON.stringify(origin, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    const specHandle = await open(stagedSpecFile, 'r');
    await specHandle.sync();
    await specHandle.close();
    const originHandle = await open(path.join(staging, ORIGIN_FILE), 'r');
    await originHandle.sync();
    await originHandle.close();
    await rename(staging, draft.specDir);
    staging = null;
    await input.hooks?.afterSpecPublish?.();
    await appendCorrelatedProvenance({
      projectDir: input.projectDir,
      specId: draft.id,
      specFile: draft.specFile,
      proposalId: String(input.proposal.proposalId),
      proposalHash: String(input.proposal.proposalHash),
      correlationId: String(input.proposal.correlationId),
      transactionId,
      receiptHash,
      eventId: provenanceEventId,
      timestamp: createdAt,
      hooks: {
        beforeWrite: input.hooks?.beforeProvenanceWrite,
        afterPartialWrite: input.hooks?.afterProvenancePartialWrite,
        afterSyncBeforeReturn: input.hooks?.afterProvenanceSyncBeforeReturn,
      },
    });
    return receiptFromOrigin(origin, draft.specDir, false);
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await release();
  }
}

async function readOperatingOriginSidecar(specDir: string): Promise<{
  origin: JsonRecord;
  specPath: string;
}> {
  try {
    const directoryStat = await lstat(specDir);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      fail('E_OPERATE_ORIGIN_INVALID', 'Operating origin requires a regular SPEC directory.');
    }
    const originPath = path.join(specDir, ORIGIN_FILE);
    const originStat = await lstat(originPath);
    if (!originStat.isFile() || originStat.isSymbolicLink()) {
      fail('E_OPERATE_ORIGIN_INVALID', 'Operating origin requires a regular closed sidecar.');
    }
    const origin = JSON.parse(await readFile(originPath, 'utf8')) as JsonRecord;
    assertOperatingOriginV1(origin as never);
    const spec = origin.spec as JsonRecord;
    const specId = String(spec.specId);
    const slug = String(spec.slug);
    const expectedBase = `${specId}-${slug}`;
    if (path.basename(path.resolve(specDir)) !== expectedBase) {
      fail(
        'E_OPERATE_ORIGIN_INVALID',
        'Operating origin does not match its canonical SPEC directory identity.',
      );
    }
    const specPath = path.join(specDir, `${expectedBase}.md`);
    const specStat = await lstat(specPath);
    if (!specStat.isFile() || specStat.isSymbolicLink()) {
      fail('E_OPERATE_ORIGIN_INVALID', 'Operating origin requires a regular canonical SPEC file.');
    }
    const [canonicalDir, canonicalSpec, canonicalOrigin] = await Promise.all([
      realpath(specDir),
      realpath(specPath),
      realpath(originPath),
    ]);
    for (const candidate of [canonicalSpec, canonicalOrigin]) {
      const relative = path.relative(canonicalDir, candidate);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        fail('E_OPERATE_ORIGIN_INVALID', 'Operating origin custody escapes its SPEC directory.');
      }
    }
    return { origin, specPath };
  } catch (cause) {
    if ((cause as { code?: string }).code === 'E_OPERATE_ORIGIN_INVALID') throw cause;
    fail(
      'E_OPERATE_ORIGIN_INVALID',
      'Operating origin custody is missing, malformed, or inaccessible.',
    );
  }
}

/**
 * Load only the immutable owner/source identity required to authorize a trace.
 * Canonical SPEC markdown bytes are deliberately not read at this boundary.
 */
export async function readSpecOperatingOriginAuthority(
  specDir: string,
): Promise<OperatingOriginAuthority> {
  const { origin } = await readOperatingOriginSidecar(specDir);
  return Object.freeze({
    actorId: String((origin.actor as JsonRecord).actorId),
    cycleId: String(origin.cycleId),
    scopeId: String(origin.scopeId),
    domainId: String(origin.domainId),
    domainVersion: String(origin.domainVersion),
    specId: String((origin.spec as JsonRecord).specId),
    originHash: String(origin.originHash),
  });
}

export async function readSpecOperatingOrigin(specDir: string): Promise<JsonRecord> {
  const { origin, specPath } = await readOperatingOriginSidecar(specDir);
  const spec = origin.spec as JsonRecord;
  const rawSpec = await readFile(specPath, 'utf8').catch(() =>
    fail('E_OPERATE_ORIGIN_INVALID', 'Operating origin canonical SPEC bytes are inaccessible.'),
  );
  const frontmatter = parseMarkdown(rawSpec).data as Record<string, unknown>;
  if (
    frontmatter.id !== spec.specId ||
    frontmatter.slug !== spec.slug ||
    hashText(rawSpec) !== spec.contentHash
  ) {
    fail(
      'E_OPERATE_ORIGIN_INVALID',
      'Operating origin does not match the canonical SPEC identity and bytes.',
    );
  }
  return origin;
}
