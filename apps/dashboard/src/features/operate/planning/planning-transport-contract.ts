import type {
  DashboardEventHead,
  DashboardQueryIdentity,
} from '../../../lib/binding/query-identity.js';
import {
  isExactPlanningCreation,
  isExactPlanningNextCommands,
  isExactPlanningSpecPreview,
  type PlanningPreviewCurrent,
} from './planning-handoff-model.js';

export const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const _ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export type PlanningFraming = Readonly<{
  title: string;
  slug: string;
  problem: string;
  objective: string;
  users: readonly string[];
  scope: readonly string[];
  nonScope: readonly string[];
  risks: readonly string[];
  constraints: readonly string[];
  requirements: readonly string[];
  acceptanceOutcomes: readonly string[];
}>;

export type PlanningHandoffPreview = Readonly<{
  proposal: Record<string, unknown>;
  specPreview: Record<string, unknown>;
}>;

export type PlanningHandoffCreation = Readonly<{
  receipt: Record<string, unknown>;
  origin: Record<string, unknown>;
  progress: Readonly<{ nodes: readonly Record<string, unknown>[] }>;
  nextCommands: readonly string[];
}>;

export type PlanningActionLocator = Readonly<{
  subjectId: string;
  actionDigest: string;
  revision: number;
}>;

export type PlanningLaunchProof = Readonly<{
  actorId: string;
  projectId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  generation: number;
  route: string;
  cycleId: string;
  viewHash: string;
  eventHead: DashboardEventHead;
  actionId: string;
  actionHash: string;
  actionRevision: number;
  proposalId: string;
  confirmDigest: string;
}>;

export type PlanningActions = Readonly<{
  bind(identity: DashboardQueryIdentity, actionLocator: PlanningActionLocator): void;
  preview(actionId: string, framing?: PlanningFraming): Promise<PlanningHandoffPreview>;
  createSpec(proposalId: string, confirmDigest: string): Promise<PlanningHandoffCreation>;
  trace(specId: string): Promise<PlanningHandoffCreation>;
  reconcile(identity: DashboardQueryIdentity, locator?: PlanningActionLocator): void;
  cancel(): void;
  dispose(): void;
}>;

export type PlanningActionsOptions = Readonly<{
  origin: string;
  fetcher?: typeof fetch;
}>;

class PlanningActionError extends Error {
  constructor(readonly code: string) {
    super('The governed Planning handoff was refused without effect.');
    this.name = code;
  }
}

export type JsonRecord = Record<string, unknown>;

export type PlanningTransportGuard = Readonly<{
  assertCurrent(): void;
  waitForCurrent<Value>(pending: Promise<Value>): Promise<Value>;
}>;

export function fail(code = 'OPERATE_COMMAND_INVALID'): never {
  throw new PlanningActionError(code);
}

export function record(value: unknown): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as JsonRecord;
}

function exactRecord(value: unknown, keys: readonly string[]): JsonRecord {
  const candidate = record(value);
  const actual = Object.keys(candidate).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('OPERATE_RESPONSE_INVALID');
  return candidate;
}

export function exactOrigin(value: string): string {
  let candidate: URL;
  try {
    candidate = new URL(value);
  } catch {
    fail('OPERATE_ORIGIN_INVALID');
  }
  if (
    candidate.origin !== value ||
    candidate.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(candidate.hostname)
  ) {
    fail('OPERATE_ORIGIN_INVALID');
  }
  return candidate.origin;
}

function commandUrl(origin: string, path: string, identity: DashboardQueryIdentity): string {
  const url = new URL(path, origin);
  url.searchParams.set('scopeId', identity.scopeId);
  url.searchParams.set('domainId', identity.domainId);
  url.searchParams.set('domainVersion', identity.domainVersion);
  return url.toString();
}

function exactHead(value: unknown): DashboardEventHead {
  const candidate = exactRecord(value, ['sequence', 'hash']);
  const keys = Object.keys(candidate).sort();
  if (keys.length !== 2 || keys[0] !== 'hash' || keys[1] !== 'sequence') fail();
  if (!Number.isSafeInteger(candidate.sequence) || (candidate.sequence as number) < 0) fail();
  const hash = candidate.hash === null ? null : candidate.hash;
  if (hash !== null && typeof hash !== 'string') fail();
  if (hash !== null && !SHA256.test(hash)) fail();
  if (((candidate.sequence as number) === 0) !== (hash === null)) fail();
  return Object.freeze({ sequence: candidate.sequence as number, hash });
}

export function exactLocator(value: unknown): PlanningActionLocator {
  const candidate = exactRecord(value, ['subjectId', 'actionDigest', 'revision']);
  const keys = Object.keys(candidate).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== 'actionDigest' ||
    keys[1] !== 'revision' ||
    keys[2] !== 'subjectId'
  ) {
    fail();
  }
  const revision = candidate.revision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) fail();
  return Object.freeze({
    subjectId:
      typeof candidate.subjectId === 'string' && _ID.test(candidate.subjectId)
        ? candidate.subjectId
        : fail(),
    actionDigest:
      typeof candidate.actionDigest === 'string' && SHA256.test(candidate.actionDigest)
        ? candidate.actionDigest
        : fail(),
    revision: revision as number,
  });
}

export function planningLaunchProof(
  identity: DashboardQueryIdentity,
  locator: PlanningActionLocator,
  proposalId: string,
  confirmDigest: string,
): PlanningLaunchProof {
  if (identity.cycleId === null || identity.viewHash === null || identity.eventHead === null) {
    fail('OPERATE_BINDING_REQUIRED');
  }
  return Object.freeze({
    actorId: identity.actorId,
    projectId: identity.projectId,
    scopeId: identity.scopeId,
    domainId: identity.domainId,
    domainVersion: identity.domainVersion,
    generation: identity.generation,
    route: identity.route,
    cycleId: identity.cycleId,
    viewHash: identity.viewHash,
    eventHead: identity.eventHead,
    actionId: locator.subjectId,
    actionHash: locator.actionDigest,
    actionRevision: locator.revision,
    proposalId,
    confirmDigest,
  });
}

export function isPlanningLaunchProof(
  value: unknown,
  expected: PlanningLaunchProof,
): value is PlanningLaunchProof {
  const proof = record(value);
  const head = record(proof.eventHead);
  return (
    Object.keys(proof).length === 15 &&
    proof.actorId === expected.actorId &&
    proof.projectId === expected.projectId &&
    proof.scopeId === expected.scopeId &&
    proof.domainId === expected.domainId &&
    proof.domainVersion === expected.domainVersion &&
    proof.generation === expected.generation &&
    proof.route === expected.route &&
    proof.cycleId === expected.cycleId &&
    proof.viewHash === expected.viewHash &&
    head.sequence === expected.eventHead.sequence &&
    head.hash === expected.eventHead.hash &&
    proof.actionId === expected.actionId &&
    proof.actionHash === expected.actionHash &&
    proof.actionRevision === expected.actionRevision &&
    proof.proposalId === expected.proposalId &&
    proof.confirmDigest === expected.confirmDigest
  );
}

export async function post(
  fetcher: typeof fetch,
  origin: string,
  path: string,
  identity: DashboardQueryIdentity,
  body: JsonRecord,
  signal: AbortSignal,
  capability?: string,
  guard?: PlanningTransportGuard,
): Promise<JsonRecord> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-openplanr-actor': identity.actorId,
  };
  if (capability) headers.authorization = `Bearer ${capability}`;
  let response: Response;
  try {
    const pending = fetcher(commandUrl(origin, path, identity), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-store',
      signal,
    });
    response = guard ? await guard.waitForCurrent(pending) : await pending;
    guard?.assertCurrent();
  } catch {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    fail('OPERATION_UNCERTAIN');
  }
  let text: string;
  try {
    const pending = response.text();
    text = guard ? await guard.waitForCurrent(pending) : await pending;
    guard?.assertCurrent();
  } catch {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    fail('OPERATION_UNCERTAIN');
  }
  if (
    !response.headers.get('content-type')?.startsWith('application/json') ||
    new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES
  ) {
    fail('OPERATION_UNCERTAIN');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    fail('OPERATION_UNCERTAIN');
  }
  if (!response.ok) {
    let envelope: JsonRecord;
    let error: JsonRecord;
    try {
      envelope = record(payload);
      error = record(envelope.error);
    } catch {
      fail('OPERATION_UNCERTAIN');
    }
    fail(typeof error.reasonCode === 'string' ? error.reasonCode : 'OPERATE_COMMAND_REFUSED');
  }
  try {
    return record(payload);
  } catch {
    fail('OPERATION_UNCERTAIN');
  }
}

export async function get(
  fetcher: typeof fetch,
  origin: string,
  path: string,
  identity: DashboardQueryIdentity,
  signal: AbortSignal,
  guard?: PlanningTransportGuard,
): Promise<JsonRecord> {
  const pendingResponse = fetcher(commandUrl(origin, path, identity), {
    headers: {
      accept: 'application/json',
      'x-openplanr-actor': identity.actorId,
    },
    cache: 'no-store',
    signal,
  });
  const response = guard ? await guard.waitForCurrent(pendingResponse) : await pendingResponse;
  guard?.assertCurrent();
  const pendingText = response.text();
  const text = guard ? await guard.waitForCurrent(pendingText) : await pendingText;
  guard?.assertCurrent();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) fail();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    fail();
  }
  if (!response.ok) fail('OPERATE_COMMAND_REFUSED');
  return record(payload);
}

export function validatePostedResponse<T>(validate: () => T): T {
  try {
    return validate();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    fail('OPERATION_UNCERTAIN');
  }
}

export function exactPreview(
  value: JsonRecord,
  current: PlanningPreviewCurrent,
): PlanningHandoffPreview {
  const envelope = exactRecord(value, ['proposal', 'specPreview']);
  const proposal = record(envelope.proposal);
  const specPreview = record(envelope.specPreview);
  if (!isExactPlanningSpecPreview(proposal, specPreview, current)) {
    fail('OPERATE_RESPONSE_INVALID');
  }
  return Object.freeze({ proposal, specPreview });
}

export function exactCreation(
  value: JsonRecord,
  expected?: Readonly<{
    identity: DashboardQueryIdentity;
    locator: PlanningActionLocator;
    proposalId: string;
    confirmDigest: string;
  }>,
): PlanningHandoffCreation {
  const envelope = exactRecord(value, ['receipt', 'origin', 'progress', 'nextCommands']);
  const receipt = record(envelope.receipt);
  const origin = record(envelope.origin);
  const progress = exactRecord(envelope.progress, ['nodes']);
  if (!isExactPlanningCreation(receipt, origin, progress)) {
    fail('OPERATE_RESPONSE_INVALID');
  }
  if (expected) {
    const originActor = record(origin.actor);
    const originAction = record(origin.action);
    const originHead = exactHead(origin.eventHead);
    if (
      receipt.proposalId !== expected.proposalId ||
      origin.proposalId !== expected.proposalId ||
      origin.proposalRevision !== 2 ||
      originActor.actorId !== expected.identity.actorId ||
      originActor.kind !== 'human' ||
      origin.scopeId !== expected.identity.scopeId ||
      origin.domainId !== expected.identity.domainId ||
      origin.domainVersion !== expected.identity.domainVersion ||
      origin.cycleId !== expected.identity.cycleId ||
      originAction.id !== expected.locator.subjectId ||
      originAction.revision !== expected.locator.revision ||
      originAction.hash !== expected.locator.actionDigest ||
      expected.identity.eventHead === null ||
      originHead.sequence !== expected.identity.eventHead.sequence ||
      originHead.hash !== expected.identity.eventHead.hash ||
      !SHA256.test(expected.confirmDigest)
    ) {
      fail('OPERATE_RESPONSE_INVALID');
    }
  }
  if (
    !Array.isArray(envelope.nextCommands) ||
    !envelope.nextCommands.every((entry): entry is string => typeof entry === 'string')
  ) {
    fail('OPERATE_RESPONSE_INVALID');
  }
  const nextCommands = envelope.nextCommands;
  if (!isExactPlanningNextCommands(receipt, nextCommands)) {
    fail('OPERATE_RESPONSE_INVALID');
  }
  return Object.freeze({
    receipt,
    origin,
    progress: Object.freeze({ nodes: Object.freeze(progress.nodes as Record<string, unknown>[]) }),
    nextCommands: Object.freeze(nextCommands),
  });
}

export function exactTraceCreation(
  value: JsonRecord,
  identity: DashboardQueryIdentity,
  specId: string,
): PlanningHandoffCreation {
  const result = exactCreation(value);
  const origin = record(result.origin);
  if (
    record(origin.spec).specId !== specId ||
    record(origin.actor).actorId !== identity.actorId ||
    record(origin.actor).kind !== 'human' ||
    origin.scopeId !== identity.scopeId ||
    origin.domainId !== identity.domainId ||
    origin.domainVersion !== identity.domainVersion
  ) {
    fail('OPERATE_RESPONSE_INVALID');
  }
  return result;
}
