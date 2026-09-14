import { createHash } from 'node:crypto';
import path from 'node:path';
import { assertOperatingPlanningProposalV1 } from 'planr-pipeline/operate/planning-bridge-v2';
import type { OpenPlanrConfig } from '../../models/types.js';
import { loadConfig } from '../config-service.js';
import { prepareOperatingSpecDraft, resolveSpecDir } from '../spec-service.js';
import {
  type OperatingOriginAuthority,
  type OperatingSpecCreationReceipt,
  readSpecOperatingOrigin,
  readSpecOperatingOriginAuthority,
} from './spec-operating-origin-service.js';

type JsonRecord = Record<string, unknown>;

const FRAMING_FIELDS = Object.freeze([
  'title',
  'slug',
  'problem',
  'objective',
  'users',
  'scope',
  'nonScope',
  'risks',
  'constraints',
  'requirements',
  'acceptanceOutcomes',
] as const);

const LIST_FIELDS = new Set([
  'users',
  'scope',
  'nonScope',
  'risks',
  'constraints',
  'requirements',
  'acceptanceOutcomes',
]);

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function hashText(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

/** Validate human-owned Planning framing before preview or create. */
export function assertPlanningFraming(value: JsonRecord): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('E_OPERATE_PLANNING_INVALID', 'Planning framing must be a closed object.');
  }
  for (const field of FRAMING_FIELDS) {
    if (!Object.hasOwn(value, field)) {
      fail('E_OPERATE_PLANNING_INVALID', `Planning framing is missing ${field}.`);
    }
    if (LIST_FIELDS.has(field)) {
      const entries = value[field];
      if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== 'string')) {
        fail(
          'E_OPERATE_PLANNING_INVALID',
          `Planning framing field ${field} must be a string list.`,
        );
      }
      continue;
    }
    if (typeof value[field] !== 'string' || String(value[field]).length === 0) {
      fail(
        'E_OPERATE_PLANNING_INVALID',
        `Planning framing field ${field} must be a non-empty string.`,
      );
    }
  }
  const foreign = Object.keys(value).find((field) => !FRAMING_FIELDS.includes(field as never));
  if (foreign) {
    fail('E_OPERATE_PLANNING_INVALID', `Planning framing contains unsupported field ${foreign}.`);
  }
  return value;
}

function framingFromProposal(proposal: JsonRecord): JsonRecord {
  return assertPlanningFraming(proposal.framing as JsonRecord);
}

function operatingOriginPreviewInput(proposal: JsonRecord): JsonRecord {
  const decision = proposal.decision as JsonRecord;
  const action = proposal.action as JsonRecord;
  const verification = proposal.verification as JsonRecord;
  return {
    correlationId: String(proposal.correlationId),
    proposalId: String(proposal.proposalId),
    cycleId: String(proposal.cycleId),
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
    perspectives: (proposal.acceptedPerspectiveSummaries as JsonRecord[]).map((perspective) => ({
      roleId: String(perspective.roleId),
      roleKind: perspective.roleKind,
      stance: String(perspective.stance),
      summary: String(perspective.summary),
      constraints: perspective.constraints as string[],
      uncertainties: perspective.uncertainties as string[],
    })),
    evidence: (proposal.evidence as JsonRecord[]).map((entry) => ({
      evidenceRefId: String(entry.evidenceRefId),
      relation: String(entry.relation),
      freshness: String(entry.freshness),
      confidence: Number(entry.confidence),
      accessState: String(entry.accessState),
      summary: entry.summary === null ? null : String(entry.summary),
      limitations: entry.limitations as string[],
    })),
    omissions: (proposal.omissions as JsonRecord[]).map((entry) => ({
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
  };
}

/** Render the exact SPEC bytes OpenPlanr will publish for one reviewed proposal. */
export async function buildOperatingSpecPreviewFromProposal(input: {
  projectDir: string;
  config?: OpenPlanrConfig;
  proposal: JsonRecord;
}): Promise<JsonRecord> {
  assertOperatingPlanningProposalV1(input.proposal as never);
  const config = input.config ?? (await loadConfig(input.projectDir));
  const framing = framingFromProposal(input.proposal);
  const actor = input.proposal.actor as JsonRecord;
  const draft = await prepareOperatingSpecDraft(input.projectDir, config, {
    title: String(framing.title),
    slug: String(framing.slug),
    actorId: String(actor.actorId),
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
    operatingOrigin: operatingOriginPreviewInput(input.proposal) as never,
    createdAt: String(input.proposal.createdAt),
  });
  const preview = input.proposal.preview as JsonRecord;
  const eventHead = input.proposal.eventHead as JsonRecord;
  return Object.freeze({
    specId: draft.id,
    title: String(framing.title),
    slug: draft.slug,
    status: 'shaping',
    content: draft.content,
    contentHash: hashText(draft.content),
    proposalId: String(input.proposal.proposalId),
    proposalHash: String(input.proposal.proposalHash),
    eventHead: Object.freeze({
      sequence: Number(eventHead.sequence),
      hash: String(eventHead.hash),
    }),
    previewDigest: String(preview.digest),
    generatedAt: String(input.proposal.createdAt),
  });
}

export function buildPlanningDeliveryProgress(origin: JsonRecord): JsonRecord {
  const decision = origin.decision as JsonRecord;
  const spec = origin.spec as JsonRecord;
  const specId = String(spec.specId);
  const status = String(spec.status ?? 'shaping');
  return Object.freeze({
    nodes: Object.freeze([
      Object.freeze({
        kind: 'decision',
        label: 'Decision accepted',
        state: 'complete',
        owner: 'Operate',
        reason: 'Exact accepted source',
        subjectId: String(decision.id),
      }),
      Object.freeze({
        kind: 'proposal',
        label: 'Proposal confirmed',
        state: 'complete',
        owner: 'Operate',
        reason: 'Human digest confirmation',
        subjectId: String(origin.proposalId),
      }),
      Object.freeze({
        kind: 'spec',
        label: `${specId} ${status}`,
        state: status,
        owner: 'Planning',
        subjectId: specId,
        href: `#/detail/${encodeURIComponent(specId)}`,
      }),
      Object.freeze({
        kind: 'plan',
        label: 'PLAN',
        state: 'not-started',
        owner: 'Planning',
        reason: 'Separate human invocation required',
      }),
      Object.freeze({
        kind: 'ship',
        label: 'SHIP',
        state: 'not-started',
        owner: 'Pipeline',
        reason: 'Requires reviewed PLAN and later invocation',
      }),
      Object.freeze({
        kind: 'verify',
        label: 'Verify value',
        state: 'waiting',
        owner: 'Operate',
        reason: 'Delivery is not Outcome success',
      }),
      Object.freeze({
        kind: 'learn',
        label: 'Learning',
        state: 'waiting',
        owner: 'Operate',
        reason: 'No accepted observation yet',
      }),
    ]),
  });
}

function publicReceipt(receipt: OperatingSpecCreationReceipt, title: string): JsonRecord {
  return Object.freeze({
    transactionId: receipt.transactionId,
    receiptHash: receipt.receiptHash,
    correlationId: receipt.correlationId,
    proposalId: receipt.proposalId,
    proposalHash: receipt.proposalHash,
    specId: receipt.specId,
    title,
    slug: receipt.slug,
    contentHash: receipt.contentHash,
    originHash: receipt.originHash,
    provenanceEventId: receipt.provenanceEventId,
    replayed: receipt.replayed,
    planningHref: `#/detail/${encodeURIComponent(receipt.specId)}`,
  });
}

export function buildPlanningHandoffCreation(input: {
  receipt: OperatingSpecCreationReceipt;
  origin: JsonRecord;
  title: string;
}): JsonRecord {
  return Object.freeze({
    receipt: publicReceipt(input.receipt, input.title),
    origin: structuredClone(input.origin),
    progress: buildPlanningDeliveryProgress(input.origin),
    nextCommands: Object.freeze([
      `planr spec show ${input.receipt.specId}`,
      `$planr:plan ${input.receipt.specId}`,
      `/planr:plan ${input.receipt.specId}`,
    ]),
  });
}

export async function readPlanningHandoffSourceAuthority(input: {
  projectDir: string;
  config?: OpenPlanrConfig;
  specId: string;
}) {
  const config = input.config ?? (await loadConfig(input.projectDir));
  const resolved = await resolveSpecDir(input.projectDir, config, input.specId);
  if (!resolved) {
    fail('E_OPERATE_PLANNING_ACCESS', 'The requested Planning origin is not available.');
  }
  const authority = await readSpecOperatingOriginAuthority(resolved.dir);
  if (authority.specId !== input.specId) {
    fail('E_OPERATE_PLANNING_ACCESS', 'The requested Planning origin is not available.');
  }
  return authority;
}

export async function readPlanningHandoffTrace(input: {
  projectDir: string;
  config?: OpenPlanrConfig;
  specId: string;
  authority?: OperatingOriginAuthority;
}): Promise<JsonRecord> {
  const config = input.config ?? (await loadConfig(input.projectDir));
  const resolved = await resolveSpecDir(input.projectDir, config, input.specId);
  if (!resolved) {
    fail('E_OPERATE_ORIGIN_INVALID', 'The requested SPEC does not exist in Planning custody.');
  }
  const origin = await readSpecOperatingOrigin(resolved.dir);
  if (
    input.authority &&
    (String(origin.originHash) !== input.authority.originHash ||
      String(origin.cycleId) !== input.authority.cycleId ||
      String(origin.scopeId) !== input.authority.scopeId ||
      String(origin.domainId) !== input.authority.domainId ||
      String(origin.domainVersion) !== input.authority.domainVersion ||
      String((origin.actor as JsonRecord).actorId) !== input.authority.actorId ||
      String((origin.spec as JsonRecord).specId) !== input.authority.specId)
  ) {
    fail('E_OPERATE_PLANNING_ACCESS', 'The authorized Planning origin changed during the read.');
  }
  const receipt = publicReceipt(
    {
      transactionId: String((origin.transaction as JsonRecord).transactionId),
      receiptHash: String((origin.transaction as JsonRecord).receiptHash),
      correlationId: String(origin.correlationId),
      proposalId: String(origin.proposalId),
      proposalHash: String(origin.proposalHash),
      specId: String((origin.spec as JsonRecord).specId),
      slug: String((origin.spec as JsonRecord).slug),
      specDir: resolved.dir,
      specFile: path.join(resolved.dir, `${input.specId}-${resolved.slug}.md`),
      contentHash: String((origin.spec as JsonRecord).contentHash),
      originPath: path.join(resolved.dir, 'operating-origin.json'),
      originHash: String(origin.originHash),
      provenanceEventId: String((origin.transaction as JsonRecord).planningProvenanceEventId),
      replayed: true,
    },
    String((origin.spec as JsonRecord).specId),
  );
  return Object.freeze({
    receipt,
    origin: structuredClone(origin),
    progress: buildPlanningDeliveryProgress(origin),
    nextCommands: Object.freeze([
      `planr spec show ${input.specId}`,
      `$planr:plan ${input.specId}`,
      `/planr:plan ${input.specId}`,
    ]),
  });
}
