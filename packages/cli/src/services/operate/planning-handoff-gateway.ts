import { readFile } from 'node:fs/promises';
import { assertOperateExperienceArtifactV2 } from 'planr-pipeline/protocol';
import { parseMarkdown } from '../../utils/markdown.js';
import type { OperateClient } from './client.js';
import type { JsonRecord } from './composition.js';
import {
  assertPlanningFraming,
  buildOperatingSpecPreviewFromProposal,
  buildPlanningHandoffCreation,
  readPlanningHandoffSourceAuthority,
  readPlanningHandoffTrace,
} from './planning-handoff-service.js';
import type { OperateSessionBindingV2 } from './session-capability.js';
import type { OperatingSpecCreationReceipt } from './spec-operating-origin-service.js';
import { readSpecOperatingOrigin } from './spec-operating-origin-service.js';

type EventHead = { sequence: number; hash: string | null };

export class OperatePlanningGatewayErrorV2 extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = code;
  }
}

export type OperatePlanningGatewayActorV2 = {
  actorId: string;
  kind: 'human';
  runtime?: string;
};

export type OperatePlanningPreviewRequestV2 = {
  actionId: string;
  framing?: JsonRecord;
  actor: OperatePlanningGatewayActorV2;
  binding: OperateSessionBindingV2;
};

export type OperatePlanningCreateSpecRequestV2 = {
  proposalId: string;
  confirmDigest: string;
  actor: OperatePlanningGatewayActorV2;
  binding: OperateSessionBindingV2;
};

export type OperatePlanningTraceRequestV2 = {
  specId: string;
  actor: OperatePlanningGatewayActorV2;
  binding: Pick<OperateSessionBindingV2, 'actorId' | 'scopeId' | 'domainId' | 'domainVersion'>;
};

function eventHead(value: unknown): EventHead {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperatePlanningGatewayErrorV2(
      'OPERATE_BINDING_MISMATCH',
      'The Planning binding event head is invalid.',
      403,
    );
  }
  const candidate = value as JsonRecord;
  if (
    !Number.isSafeInteger(candidate.sequence) ||
    (candidate.sequence as number) < 0 ||
    (candidate.hash !== null &&
      (typeof candidate.hash !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(candidate.hash)))
  ) {
    throw new OperatePlanningGatewayErrorV2(
      'OPERATE_BINDING_MISMATCH',
      'The Planning binding event head is invalid.',
      403,
    );
  }
  return {
    sequence: candidate.sequence as number,
    hash: candidate.hash as string | null,
  };
}

function sameHead(left: EventHead, right: EventHead): boolean {
  return left.sequence === right.sequence && left.hash === right.hash;
}

function assertTraceBinding(
  request: OperatePlanningTraceRequestV2,
  source: Awaited<ReturnType<typeof readPlanningHandoffSourceAuthority>>,
): void {
  if (
    request.actor.kind !== 'human' ||
    request.actor.actorId !== request.binding.actorId ||
    request.actor.actorId !== source.actorId ||
    request.binding.scopeId !== source.scopeId ||
    request.binding.domainId !== source.domainId ||
    request.binding.domainVersion !== source.domainVersion
  ) {
    throw new OperatePlanningGatewayErrorV2(
      'E_OPERATE_PLANNING_ACCESS',
      'Planning trace requires the exact owner and source operating scope.',
      403,
    );
  }
}

export class OperatePlanningGateway {
  constructor(
    private readonly client: OperateClient,
    private readonly projectDir: string,
  ) {}

  private async currentView(cycleId: string, actorId: string): Promise<JsonRecord> {
    const envelope = await this.client.dispatch({
      operation: 'operate.experience.get',
      request: {
        cycleId,
        actor: { actorId, kind: 'human', runtime: 'openplanr' },
        actionBinding: { cycleId, actorId },
      },
    });
    if (!envelope.ok) {
      throw new OperatePlanningGatewayErrorV2(
        envelope.error.code,
        envelope.error.message,
        envelope.error.code === 'CAPABILITY_DENIED' ? 403 : 409,
      );
    }
    const view = envelope.data as JsonRecord;
    assertOperateExperienceArtifactV2('operate-experience-view', view);
    return view;
  }

  private assertSessionBinding(binding: OperateSessionBindingV2, view: JsonRecord): void {
    const cycles = Array.isArray(view.cycles) ? (view.cycles as JsonRecord[]) : [];
    if (
      binding.actorId !== String(view.actorId) ||
      binding.scopeId !== String(view.scopeId) ||
      binding.domainId !== String(view.domainId) ||
      binding.domainVersion !== String(view.domainVersion) ||
      !cycles.some((cycle) => String(cycle.cycleId) === binding.cycleId)
    ) {
      throw new OperatePlanningGatewayErrorV2(
        'OPERATE_BINDING_MISMATCH',
        'The Planning session does not match the current operating scope.',
        403,
      );
    }
    if (
      !sameHead(binding.eventHead, eventHead(view.eventHead)) ||
      binding.sourceViewHash !== String(view.viewHash)
    ) {
      throw new OperatePlanningGatewayErrorV2(
        'OPERATE_SESSION_STALE',
        'Actor, scope, Cycle, or Event head changed. Refresh before requesting another Planning preview.',
        409,
      );
    }
  }

  private failure(
    _operation: string,
    envelope: { ok: false; error: { code: string; message: string } },
  ): never {
    const status =
      envelope.error.code === 'E_OPERATE_PLANNING_ACCESS' ||
      envelope.error.code === 'CAPABILITY_DENIED'
        ? 403
        : 409;
    throw new OperatePlanningGatewayErrorV2(envelope.error.code, envelope.error.message, status);
  }

  private assertBoundActionId(actionId: string, binding: OperateSessionBindingV2): void {
    if (actionId !== binding.actionLocator.subjectId) {
      throw new OperatePlanningGatewayErrorV2(
        'OPERATE_BINDING_MISMATCH',
        'The Planning request must target the bound Action identity.',
        403,
      );
    }
  }

  async preview(request: OperatePlanningPreviewRequestV2): Promise<JsonRecord> {
    if (request.actor.kind !== 'human' || request.actor.actorId !== request.binding.actorId) {
      throw new OperatePlanningGatewayErrorV2(
        'E_OPERATE_PLANNING_ACCESS',
        'Planning preview requires the exact current human Action owner.',
        403,
      );
    }
    this.assertBoundActionId(request.actionId, request.binding);
    const view = await this.currentView(request.binding.cycleId, request.binding.actorId);
    this.assertSessionBinding(request.binding, view);
    const envelope = await this.client.dispatch({
      operation: 'operate.planning.preview',
      request: {
        actionId: request.actionId,
        actor: { actorId: request.actor.actorId, kind: 'human', runtime: 'openplanr' },
        framing: request.framing ? assertPlanningFraming(request.framing) : undefined,
      },
    });
    if (!envelope.ok) this.failure('operate.planning.preview', envelope);
    const proposal = envelope.data as JsonRecord;
    const specPreview = await buildOperatingSpecPreviewFromProposal({
      projectDir: this.projectDir,
      proposal,
    });
    return Object.freeze({ proposal, specPreview });
  }

  async createSpec(request: OperatePlanningCreateSpecRequestV2): Promise<JsonRecord> {
    if (request.actor.kind !== 'human' || request.actor.actorId !== request.binding.actorId) {
      throw new OperatePlanningGatewayErrorV2(
        'E_OPERATE_PLANNING_ACCESS',
        'Planning confirmation requires the exact human actor bound by the preview.',
        403,
      );
    }
    const view = await this.currentView(request.binding.cycleId, request.binding.actorId);
    this.assertSessionBinding(request.binding, view);
    const envelope = await this.client.dispatch({
      operation: 'operate.planning.create-spec',
      request: {
        proposalId: request.proposalId,
        confirmDigest: request.confirmDigest,
        actor: { actorId: request.actor.actorId, kind: 'human', runtime: 'openplanr' },
      },
    });
    if (!envelope.ok) this.failure('operate.planning.create-spec', envelope);
    const receipt = envelope.data as OperatingSpecCreationReceipt;
    const origin = await readSpecOperatingOrigin(receipt.specDir);
    const parsed = parseMarkdown(await readFile(receipt.specFile, 'utf8'));
    const title = String(parsed.data.title ?? receipt.specId);
    return buildPlanningHandoffCreation({
      receipt,
      origin,
      title,
    });
  }

  async trace(request: OperatePlanningTraceRequestV2): Promise<JsonRecord> {
    const source = await readPlanningHandoffSourceAuthority({
      projectDir: this.projectDir,
      specId: request.specId,
    });
    assertTraceBinding(request, source);
    const view = await this.currentView(source.cycleId, source.actorId);
    const cycles = Array.isArray(view.cycles) ? (view.cycles as JsonRecord[]) : [];
    if (
      String(view.actorId) !== source.actorId ||
      String(view.scopeId) !== source.scopeId ||
      String(view.domainId) !== source.domainId ||
      String(view.domainVersion) !== source.domainVersion ||
      !cycles.some((cycle) => String(cycle.cycleId) === source.cycleId)
    ) {
      throw new OperatePlanningGatewayErrorV2(
        'E_OPERATE_PLANNING_ACCESS',
        'Planning trace source membership is no longer authorized.',
        403,
      );
    }
    return await readPlanningHandoffTrace({
      projectDir: this.projectDir,
      specId: request.specId,
      authority: source,
    });
  }
}

export function createOperatePlanningGateway(input: {
  client: OperateClient;
  projectDir: string;
}): OperatePlanningGateway {
  return new OperatePlanningGateway(input.client, input.projectDir);
}
