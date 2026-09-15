import { readFileSync } from 'node:fs';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { describe, expect, it, vi } from 'vitest';

const { assertWorkspace, selectWorkspace } = vi.hoisted(() => ({
  assertWorkspace: vi.fn((value) => value),
  selectWorkspace: vi.fn(),
}));

vi.mock('planr-pipeline/dashboard/operate-review-display-workspace-contract', () => ({
  assertOperateReviewDisplayWorkspaceV1: assertWorkspace,
}));

vi.mock('planr-pipeline/dashboard/operate-experience-reader', () => ({
  selectOperateReviewDisplayWorkspace: selectWorkspace,
}));

import { createOperateClient } from '../../src/services/operate/client.js';
import { createOperatingReviewReadGatewayV1 } from '../../src/services/operate/review-read-gateway.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const request = {
  cycleId: 'cyc_gateway_00000001',
  reviewId: 'rev_gateway_00000001',
  actorId: 'owner-gateway',
  scopeId: 'scope-gateway',
  domainId: 'business',
  domainVersion: '1.0.0',
};
const eventHead = { sequence: 4, hash: HASH_A };

function pendingSource() {
  return {
    kind: 'operating-review-read',
    cycleId: request.cycleId,
    eventHead,
    review: { reviewId: request.reviewId },
    readAt: '2026-08-20T12:00:00.000Z',
  };
}

function terminalSource() {
  return {
    kind: 'operating-review-receipt',
    cycleId: request.cycleId,
    readEventHead: eventHead,
    eventHead: { sequence: 5, hash: HASH_B },
    review: { reviewId: request.reviewId },
    committedAt: '2026-08-20T12:01:00.000Z',
  };
}

function display(source: ReturnType<typeof pendingSource> | ReturnType<typeof terminalSource>) {
  const sourceReadEventHead =
    source.kind === 'operating-review-read' ? source.eventHead : source.readEventHead;
  return {
    kind: 'operate-review-display-workspace',
    payload: {
      actorId: request.actorId,
      scopeId: request.scopeId,
      domainId: request.domainId,
      domainVersion: request.domainVersion,
      cycleId: request.cycleId,
      reviewId: request.reviewId,
      sourceArtifactKind: source.kind,
      sourceArtifactHash: sha256Jcs(source as never),
      sourceEventHead: source.eventHead,
      sourceReadEventHead,
      sourceViewHash: HASH_A,
    },
  };
}

describe('OpenPlanr Review read gateway', () => {
  it('has no browser-facing dependency on private Store or credential custody', () => {
    const source = readFileSync(
      new URL('../../src/services/operate/review-read-gateway.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/from\s+['"][^'"]*\/store(?:\.js)?['"]/u);
    expect(source).not.toContain('.planr/operate');
    expect(source).not.toContain('/Users/');
    expect(source).not.toMatch(/process\.env|password|accessToken|refreshToken/u);
  });

  it('reconstructs an exact nonzero retained base head with zero replay Events', async () => {
    const baseHead = { sequence: 5, hash: HASH_A };
    const baseState = { eventHead: baseHead, eventReplayIndex: [{ sequence: 5 }] };
    const artifacts = new Map([['art_base_head_0001', new Uint8Array([1, 2, 3])]]);
    const runtime = {
      generation: 'gen_1234567890abcdef1234567890abcdef',
      baseState,
      state: { eventHead: { sequence: 7, hash: HASH_B } },
      events: [
        { sequence: 5, eventHash: HASH_A },
        { sequence: 6, eventHash: HASH_B },
        { sequence: 7, eventHash: HASH_B },
      ],
      artifacts,
      preferences: {},
    };
    const client = createOperateClient('/tmp/openplanr-review-base-head');
    const historical = await (
      client as unknown as {
        runtimeAtEventHead(
          selected: typeof runtime,
          head: typeof baseHead,
        ): Promise<typeof runtime>;
      }
    ).runtimeAtEventHead(runtime, baseHead);

    expect(historical.state).toEqual(baseState);
    expect(historical.state).not.toBe(baseState);
    expect(historical.events).toEqual([]);
    expect(historical.artifacts).toBe(artifacts);
  });

  it('returns only the validated pending display workspace with exact request custody', async () => {
    const source = pendingSource();
    const workspace = display(source);
    selectWorkspace.mockReturnValueOnce(workspace);
    const client = {
      dispatch: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          operation: 'operate.review.get',
          data: source,
          allowedActions: [],
        })
        .mockResolvedValueOnce({
          ok: true,
          operation: 'operate.experience.get',
          data: { viewHash: HASH_A },
          allowedActions: [],
        }),
      readCommittedReviewReceipt: vi.fn(),
      readExperienceAtEventHead: vi.fn(),
    };

    await expect(
      createOperatingReviewReadGatewayV1({ client: client as never })(request),
    ).resolves.toEqual(workspace);
    const serialized = JSON.stringify(workspace);
    expect(serialized).not.toContain('.planr/operate');
    expect(serialized).not.toContain('/Users/');
    expect(serialized).not.toMatch(/password|accessToken|refreshToken/u);
    expect(client.readCommittedReviewReceipt).not.toHaveBeenCalled();
    expect(client.readExperienceAtEventHead).not.toHaveBeenCalled();
    expect(selectWorkspace).toHaveBeenCalledWith({ viewHash: HASH_A }, source, {
      subjectId: request.reviewId,
      binding: expect.objectContaining({
        ...request,
        generatedAt: source.readAt,
        sourceArtifactKind: source.kind,
        sourceArtifactHash: sha256Jcs(source as never),
        sourceEventHead: source.eventHead,
        sourceReadEventHead: source.eventHead,
        sourceViewHash: HASH_A,
      }),
    });
    expect(assertWorkspace).toHaveBeenCalledTimes(1);
  });

  it('falls back only from REVIEW_NOT_PENDING to the exact committed receipt', async () => {
    const source = terminalSource();
    const workspace = display(source);
    selectWorkspace.mockReturnValueOnce(workspace);
    const client = {
      dispatch: vi.fn().mockResolvedValueOnce({
        ok: false,
        operation: 'operate.review.get',
        error: {
          code: 'REVIEW_NOT_PENDING',
          message: 'terminal',
          retryable: false,
          context: {},
        },
        allowedActions: [],
      }),
      readCommittedReviewReceipt: vi.fn().mockResolvedValue({
        ok: true,
        operation: 'operate.review.submit',
        data: source,
        allowedActions: [],
      }),
      readExperienceAtEventHead: vi.fn().mockResolvedValue({
        ok: true,
        operation: 'operate.experience.get',
        data: { viewHash: HASH_A },
        allowedActions: [],
      }),
    };

    await expect(
      createOperatingReviewReadGatewayV1({ client: client as never })(request),
    ).resolves.toEqual(workspace);
    expect(client.readCommittedReviewReceipt).toHaveBeenCalledWith({
      reviewId: request.reviewId,
      cycleId: request.cycleId,
      actor: { actorId: request.actorId, kind: 'human', runtime: 'openplanr' },
      scope: {
        scopeId: request.scopeId,
        domainId: request.domainId,
        domainVersion: request.domainVersion,
      },
    });
    expect(client.readExperienceAtEventHead).toHaveBeenCalledWith(
      {
        cycleId: request.cycleId,
        actor: { actorId: request.actorId, kind: 'human', runtime: 'openplanr' },
        actionBinding: { cycleId: request.cycleId, actorId: request.actorId },
      },
      source.eventHead,
    );
    expect(selectWorkspace).toHaveBeenCalledWith(
      { viewHash: HASH_A },
      source,
      expect.objectContaining({
        binding: expect.objectContaining({
          generatedAt: source.committedAt,
          sourceEventHead: source.eventHead,
          sourceReadEventHead: source.readEventHead,
        }),
      }),
    );
  });

  it('does not probe committed receipts after an authorization refusal', async () => {
    const client = {
      dispatch: vi.fn().mockResolvedValue({
        ok: false,
        operation: 'operate.review.get',
        error: {
          code: 'REVIEW_NOT_AUTHORIZED',
          message: 'refused',
          retryable: false,
          context: {},
        },
        allowedActions: [],
      }),
      readCommittedReviewReceipt: vi.fn(),
      readExperienceAtEventHead: vi.fn(),
    };
    await expect(
      createOperatingReviewReadGatewayV1({ client: client as never })(request),
    ).rejects.toMatchObject({ code: 'REVIEW_NOT_AUTHORIZED' });
    expect(client.readCommittedReviewReceipt).not.toHaveBeenCalled();
  });
});
