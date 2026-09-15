import path from 'node:path';
import type { VerifiedLandingPackageHandoff } from '../pipeline-package-service.js';
import {
  type LandingOperationAdapterV1,
  LandingOperationRegistryV1,
} from './operation-registry.js';
import {
  type LandingReceiptCustodySnapshotV1,
  LandingReceiptCustodyV1,
} from './receipt-custody.js';

export type LandingServiceErrorCode =
  | 'E_LANDING_INPUT_INVALID'
  | 'E_LANDING_OWNER_INTERACTIVE_REQUIRED'
  | 'E_LANDING_MACHINE_AUTHORITY_FORBIDDEN'
  | 'E_LANDING_HOST_NOT_CONFIGURED'
  | 'E_LANDING_BINDING_MISMATCH';

export class LandingServiceError extends Error {
  readonly code: LandingServiceErrorCode;
  readonly recovery?: string;

  constructor(code: LandingServiceErrorCode, message: string, recovery?: string) {
    super(message);
    this.name = 'LandingServiceError';
    this.code = code;
    this.recovery = recovery;
  }
}

type LandingApi = VerifiedLandingPackageHandoff['landingApi'];

export type LandingPrepareInputV1 = Readonly<{
  feature: string;
  receiptHash: `sha256:${string}`;
  operations: readonly Readonly<Record<string, unknown>>[];
  preconditions?: readonly Readonly<Record<string, unknown>>[];
  baseRecords?: readonly Readonly<Record<string, unknown>>[];
  createdAt?: string;
  expiresAt?: string;
}>;

export type LandingAdvanceInputV1 = Readonly<{
  planId: string;
  operationId: string;
  ownerInteractive: boolean;
  json?: boolean;
  yes?: boolean;
  agent?: boolean;
  hook?: boolean;
  now?: string;
}>;

function landingFunction<T extends (...args: never[]) => unknown>(
  api: LandingApi,
  name: string,
): T {
  const value = api[name as keyof LandingApi];
  if (typeof value !== 'function') {
    throw new LandingServiceError(
      'E_LANDING_HOST_NOT_CONFIGURED',
      'The verified landing package API is unavailable.',
    );
  }
  return value as T;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LandingServiceError('E_LANDING_INPUT_INVALID', 'Landing input is invalid.');
  }
  return value as Readonly<Record<string, unknown>>;
}

function operationFor(
  plan: Readonly<Record<string, unknown>>,
  operationId: string,
): Readonly<Record<string, unknown>> {
  const operations = plan.operations;
  if (!Array.isArray(operations)) {
    throw new LandingServiceError('E_LANDING_BINDING_MISMATCH', 'Landing plan is invalid.');
  }
  const matches = operations.filter(
    (value) =>
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).operationId === operationId,
  );
  if (matches.length !== 1) {
    throw new LandingServiceError(
      'E_LANDING_BINDING_MISMATCH',
      'Landing operation does not belong to the exact plan.',
    );
  }
  return matches[0] as Readonly<Record<string, unknown>>;
}

function registryOperationId(operation: Readonly<Record<string, unknown>>): string {
  const value = operation.registryOperationId;
  if (typeof value !== 'string') {
    throw new LandingServiceError(
      'E_LANDING_BINDING_MISMATCH',
      'Landing operation registry binding is invalid.',
    );
  }
  return value;
}

function dates(input: LandingPrepareInputV1): { createdAt: string; expiresAt: string } {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const expiresAt =
    input.expiresAt ?? new Date(Date.parse(createdAt) + 60 * 60 * 1_000).toISOString();
  if (
    !Number.isFinite(Date.parse(createdAt)) ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    Date.parse(expiresAt) <= Date.parse(createdAt)
  ) {
    throw new LandingServiceError('E_LANDING_INPUT_INVALID', 'Landing plan time is invalid.');
  }
  return { createdAt, expiresAt };
}

export class LandingServiceV1 {
  readonly #projectDir: string;
  readonly #handoff: VerifiedLandingPackageHandoff;
  readonly #custody: LandingReceiptCustodyV1;
  readonly #operations: LandingOperationRegistryV1;

  constructor(input: {
    projectDir: string;
    handoff: VerifiedLandingPackageHandoff;
    adapters?: readonly LandingOperationAdapterV1[];
    custody?: LandingReceiptCustodyV1;
  }) {
    this.#projectDir = path.resolve(input.projectDir);
    this.#handoff = input.handoff;
    this.#custody =
      input.custody ??
      new LandingReceiptCustodyV1({ root: path.join(this.#projectDir, '.planr', 'landing') });
    this.#operations = new LandingOperationRegistryV1({
      operationRegistry: input.handoff.registryValues.operationRegistry,
      adapters: input.adapters,
    });
  }

  async #inspection(
    feature: string,
    receiptHash: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    const inspect = landingFunction<
      (input: Record<string, unknown>) => Readonly<Record<string, unknown>>
    >(this.#handoff.landingApi, 'inspectShipClosureForLanding');
    return inspect({ projectRoot: this.#projectDir, feature, receiptHash });
  }

  async #bound(
    snapshot: LandingReceiptCustodySnapshotV1,
  ): Promise<Readonly<Record<string, unknown>>> {
    const bind = landingFunction<
      (input: Record<string, unknown>) => Readonly<Record<string, unknown>>
    >(this.#handoff.landingApi, 'bindLandingPlan');
    return bind({
      plan: snapshot.plan,
      closureInspection: await this.#inspection(snapshot.feature, snapshot.receiptHash),
      operationRegistry: this.#handoff.registryValues.operationRegistry,
      baseRecords: snapshot.baseRecords,
    });
  }

  async prepare(input: LandingPrepareInputV1): Promise<Readonly<Record<string, unknown>>> {
    if (
      !input ||
      typeof input.feature !== 'string' ||
      !input.feature.trim() ||
      !/^sha256:[a-f0-9]{64}$/u.test(input.receiptHash) ||
      !Array.isArray(input.operations) ||
      input.operations.length === 0 ||
      !Array.isArray(input.preconditions ?? []) ||
      !Array.isArray(input.baseRecords ?? [])
    ) {
      throw new LandingServiceError('E_LANDING_INPUT_INVALID', 'Landing preparation is invalid.');
    }
    const first = record(input.operations[0]);
    const operationAdapterId = registryOperationId(first);
    const target = await this.#operations.inspect(operationAdapterId, {
      kind: 'landing-target-inspection',
      schemaVersion: '1.0.0',
      authority: 'none',
      projectRoot: this.#projectDir,
      operation: first,
    });
    if (first.targetBeforeHash !== target.targetStateHash) {
      throw new LandingServiceError(
        'E_LANDING_BINDING_MISMATCH',
        'Landing target changed before plan preparation.',
      );
    }
    const prepare = landingFunction<
      (value: Record<string, unknown>) => Readonly<Record<string, unknown>>
    >(this.#handoff.landingApi, 'prepareLanding');
    const closureInspection = await this.#inspection(input.feature, input.receiptHash);
    const time = dates(input);
    const plan = prepare({
      closureInspection,
      currentTargetHash: target.targetStateHash,
      operations: input.operations,
      preconditions: input.preconditions ?? [],
      baseRecords: input.baseRecords ?? [],
      operationRegistry: this.#handoff.registryValues.operationRegistry,
      ...time,
    });
    const snapshot = await this.#custody.initialize({
      feature: input.feature,
      receiptHash: input.receiptHash,
      plan,
      baseRecords: input.baseRecords ?? [],
    });
    const status = await this.status(String(plan.planId));
    return Object.freeze({
      ok: true,
      operation: 'landing.prepare',
      authority: 'none',
      effects: [],
      ownerActionRequired: true,
      plan: structuredClone(snapshot.plan),
      status,
    });
  }

  async show(planId: string): Promise<Readonly<Record<string, unknown>>> {
    const snapshot = await this.#custody.read(planId);
    const show = landingFunction<
      (input: Record<string, unknown>) => Readonly<Record<string, unknown>>
    >(this.#handoff.landingApi, 'showLanding');
    return show({ plan: await this.#bound(snapshot), events: snapshot.events });
  }

  async status(planId: string): Promise<Readonly<Record<string, unknown>>> {
    const snapshot = await this.#custody.read(planId);
    const status = landingFunction<
      (input: Record<string, unknown>) => Readonly<Record<string, unknown>>
    >(this.#handoff.landingApi, 'landingStatus');
    return status({ plan: await this.#bound(snapshot), events: snapshot.events });
  }

  async advance(input: LandingAdvanceInputV1): Promise<Readonly<Record<string, unknown>>> {
    if (input.json || input.yes || input.agent || input.hook) {
      throw new LandingServiceError(
        'E_LANDING_MACHINE_AUTHORITY_FORBIDDEN',
        'Landing effects cannot be authorized by JSON, --yes, an agent, or a hook.',
        'Run the exact command in a fresh owner-controlled terminal without automation flags.',
      );
    }
    if (!input.ownerInteractive || !process.stdin.isTTY || !process.stderr.isTTY) {
      throw new LandingServiceError(
        'E_LANDING_OWNER_INTERACTIVE_REQUIRED',
        'Landing advance requires a fresh owner-controlled OS terminal.',
        'Open an owner-controlled terminal and review the neutral docket.',
      );
    }
    const snapshot = await this.#custody.read(input.planId);
    const plan = await this.#bound(snapshot);
    const operation = operationFor(plan, input.operationId);
    const adapterId = registryOperationId(operation);
    const callbacks = {
      snapshot: async () => {
        const stored = await this.#custody.read(input.planId);
        const currentTarget = await this.#operations.inspect(adapterId, {
          kind: 'landing-target-inspection',
          schemaVersion: '1.0.0',
          authority: 'none',
          projectRoot: this.#projectDir,
          operation,
        });
        return Object.freeze({
          candidateDigest: stored.candidateDigest,
          repositoryHeads: stored.repositoryHeads,
          targetStateHash: currentTarget.targetStateHash,
          events: stored.events,
          journalHead: stored.journalHead,
          landingReceipt: stored.landingReceipt,
          pendingIntent: stored.pendingIntent,
          phaseReceiptHeadHash: stored.phaseReceiptHeadHash,
          phaseReceipts: stored.phaseReceipts,
          confirmations: stored.confirmations,
          evidenceRecordsByOperation: stored.evidenceRecordsByOperation,
          evidenceContextsByOperation: stored.evidenceContextsByOperation,
          startedAt: stored.startedAt,
        });
      },
      commitIntent: (request: Readonly<Record<string, unknown>>) =>
        this.#custody.commitIntent(input.planId, request),
      dispatch: (request: Readonly<Record<string, unknown>>) =>
        this.#operations.dispatch(adapterId, request),
      reconcile: (request: Readonly<Record<string, unknown>>) =>
        this.#operations.reconcile(adapterId, request),
      commitOutcome: (request: Readonly<Record<string, unknown>>) =>
        this.#custody.commitOutcome(input.planId, request),
    };
    const createHost = landingFunction<
      (value: typeof callbacks) => Readonly<Record<string, unknown>>
    >(this.#handoff.landingApi, 'createLandingOwnerRuntimeHost');
    const advance = landingFunction<
      (value: Record<string, unknown>) => Promise<Readonly<Record<string, unknown>>>
    >(this.#handoff.landingApi, 'advanceLanding');
    const host = createHost(callbacks);
    return advance({ host, plan, operationId: input.operationId, now: input.now });
  }
}
