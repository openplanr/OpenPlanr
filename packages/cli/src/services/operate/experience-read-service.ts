import type { JsonRecord } from './composition.js';
import { isOperatePublicId } from './identity-contract.js';

const EXPERIENCE_READER_MODULE = 'planr-pipeline/dashboard/operate-experience-reader';

export type OperateReadActor = Readonly<{
  actorId: string;
  kind: 'agent' | 'human';
  runtime: string;
}>;

type ReadRefusalCode =
  | 'CAPABILITY_DENIED'
  | 'CONTRACT_VERSION_UNSUPPORTED'
  | 'RESULT_CONTRACT_INVALID';

type Refuse = (code: ReadRefusalCode, message: string) => never;

type ReadEnvelope =
  | Readonly<{ ok: true; data: unknown }>
  | Readonly<{ ok: false; [key: string]: unknown }>;

export type OperateExperienceReaderOwner = Readonly<{
  buildOperateExperienceTransportView(view: JsonRecord): JsonRecord;
  resolveOperateExperienceSearchDestination(
    view: JsonRecord,
    value: unknown,
  ): { route: string; surface: string; subjectId: string | null } | null;
  selectOperateExperienceSurface(view: JsonRecord, options: JsonRecord): unknown;
  selectOperateExperienceAuditDisplaySurface(view: JsonRecord, options: JsonRecord): unknown;
  selectOperateCycleDisplayWorkspace(
    view: JsonRecord,
    cycleRead: unknown,
    options: JsonRecord,
  ): unknown;
  selectOperateExecutiveBoardDisplay(view: JsonRecord, options: JsonRecord): unknown;
  selectOperateActionDisplayWorkspace(view: JsonRecord, options: JsonRecord): unknown;
  selectOperateRecoveryDisplay(
    view: JsonRecord,
    recoveryRead: unknown,
    options: JsonRecord,
  ): unknown;
}>;

let readerOwnerPromise: Promise<OperateExperienceReaderOwner> | null = null;

/** Load and verify the complete public reader once; no package-private projection is used. */
export async function loadOperateExperienceReaderOwner(
  refuse: Refuse,
): Promise<OperateExperienceReaderOwner> {
  readerOwnerPromise ??= import(EXPERIENCE_READER_MODULE).then((value) => {
    const candidate = value as Partial<OperateExperienceReaderOwner>;
    for (const name of [
      'buildOperateExperienceTransportView',
      'resolveOperateExperienceSearchDestination',
      'selectOperateExperienceSurface',
      'selectOperateExperienceAuditDisplaySurface',
      'selectOperateCycleDisplayWorkspace',
      'selectOperateExecutiveBoardDisplay',
      'selectOperateActionDisplayWorkspace',
      'selectOperateRecoveryDisplay',
    ] as const) {
      if (typeof candidate[name] !== 'function') {
        refuse(
          'CONTRACT_VERSION_UNSUPPORTED',
          'The installed operating experience reader is incompatible.',
        );
      }
    }
    return candidate as OperateExperienceReaderOwner;
  });
  return await readerOwnerPromise;
}

function readRecord(value: unknown, refuse: Refuse): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    refuse('RESULT_CONTRACT_INVALID', 'The accepted lifecycle result is not a JSON object.');
  }
  return value as JsonRecord;
}

function binding(view: JsonRecord): JsonRecord {
  return {
    actorId: String(view.actorId),
    scopeId: String(view.scopeId),
    domainId: String(view.domainId),
    domainVersion: String(view.domainVersion),
    generatedAt: String(view.generatedAt),
    eventHead: view.eventHead as JsonRecord,
    viewHash: String(view.viewHash),
  };
}

function assertPublicId(value: string, label: string, refuse: Refuse): void {
  if (!isOperatePublicId(value)) {
    refuse('RESULT_CONTRACT_INVALID', `The ${label} identifier is invalid.`);
  }
}

function assertActor(actor: OperateReadActor, label: string, refuse: Refuse): void {
  if (!actor || typeof actor.actorId !== 'string' || actor.actorId.length === 0) {
    refuse('CAPABILITY_DENIED', `An exact ${label} actor is required.`);
  }
}

type ExperienceRead = (input: {
  cycleId: string;
  actor: OperateReadActor;
}) => Promise<ReadEnvelope>;

export async function readOperateCycleWorkspace(input: {
  cycleId: string;
  actor: OperateReadActor;
  readExperience: ExperienceRead;
  readCycle: (cycleId: string) => Promise<ReadEnvelope>;
  refuse: Refuse;
}): Promise<unknown> {
  assertPublicId(input.cycleId, 'Cycle', input.refuse);
  assertActor(input.actor, 'Cycle', input.refuse);
  const experience = await input.readExperience({ cycleId: input.cycleId, actor: input.actor });
  if (!experience.ok) return experience;
  const cycleRead = await input.readCycle(input.cycleId);
  if (!cycleRead.ok) return cycleRead;
  const view = readRecord(experience.data, input.refuse);
  const owner = await loadOperateExperienceReaderOwner(input.refuse);
  return owner.selectOperateCycleDisplayWorkspace(view, cycleRead, {
    binding: { ...binding(view), cycleId: input.cycleId, subjectId: input.cycleId },
    subjectId: input.cycleId,
  });
}

export async function readOperateActionWorkspace(input: {
  actionId: string;
  cycleId: string;
  actor: OperateReadActor;
  readExperience: ExperienceRead;
  refuse: Refuse;
}): Promise<unknown> {
  assertPublicId(input.actionId, 'Action', input.refuse);
  assertPublicId(input.cycleId, 'Cycle', input.refuse);
  assertActor(input.actor, 'Action', input.refuse);
  const experience = await input.readExperience({ cycleId: input.cycleId, actor: input.actor });
  if (!experience.ok) return experience;
  const view = readRecord(experience.data, input.refuse);
  const owner = await loadOperateExperienceReaderOwner(input.refuse);
  return owner.selectOperateActionDisplayWorkspace(view, {
    binding: { ...binding(view), actionId: input.actionId, subjectId: input.actionId },
    subjectId: input.actionId,
  });
}

export async function readOperateRecoveryDisplay(input: {
  cycleId: string;
  actor: OperateReadActor;
  readExperience: ExperienceRead;
  inspectRecovery: () => Promise<ReadEnvelope>;
  refuse: Refuse;
}): Promise<unknown> {
  assertPublicId(input.cycleId, 'Cycle', input.refuse);
  assertActor(input.actor, 'recovery', input.refuse);
  const experience = await input.readExperience({ cycleId: input.cycleId, actor: input.actor });
  if (!experience.ok) return experience;
  const recoveryRead = await input.inspectRecovery();
  if (!recoveryRead.ok) return recoveryRead;
  const view = readRecord(experience.data, input.refuse);
  const owner = await loadOperateExperienceReaderOwner(input.refuse);
  return owner.selectOperateRecoveryDisplay(view, recoveryRead, { binding: binding(view) });
}

export async function readOperateExecutiveBoardDisplay(input: {
  cycleId: string;
  actor: OperateReadActor;
  readExperience: ExperienceRead;
  refuse: Refuse;
}): Promise<unknown> {
  assertPublicId(input.cycleId, 'Cycle', input.refuse);
  assertActor(input.actor, 'Cycle', input.refuse);
  const experience = await input.readExperience({ cycleId: input.cycleId, actor: input.actor });
  if (!experience.ok) return experience;
  const view = readRecord(experience.data, input.refuse);
  const owner = await loadOperateExperienceReaderOwner(input.refuse);
  return owner.selectOperateExecutiveBoardDisplay(view, {
    binding: { ...binding(view), cycleId: input.cycleId, subjectId: input.cycleId },
    subjectId: input.cycleId,
  });
}
