import { describe, expect, it, vi } from 'vitest';
import { createPlanningActions } from '../../../../apps/dashboard/src/features/operate/planning/planning-actions.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';

const HASH = `sha256:${'a'.repeat(64)}`;
const PROPOSAL_HASH = `sha256:${'b'.repeat(64)}`;
const CONTENT_HASH = `sha256:${'c'.repeat(64)}`;
const ORIGIN_HASH = `sha256:${'d'.repeat(64)}`;
const RECEIPT_HASH = `sha256:${'e'.repeat(64)}`;
const PROPOSAL_ID = 'oprop_1234567890abcdef1234567890abcdef';

describe('dashboard planning handoff transport', () => {
  it('binds preview and creation to exact launch custody and makes proof loss terminal', async () => {
    const identity = createDashboardQueryIdentity({
      route: '#/operate/actions/act_planning_0001/planning',
      productArea: 'operate',
      projectId: HASH,
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
      actorId: 'owner-test',
      cycleId: 'cyc_planning_0001',
      subjectId: 'act_planning_0001',
      eventHead: { sequence: 8, hash: HASH },
      viewHash: HASH,
      generation: 1,
    });
    const proposal = {
      proposalId: PROPOSAL_ID,
      proposalHash: PROPOSAL_HASH,
      scopeId: identity.scopeId,
      domainId: identity.domainId,
      domainVersion: identity.domainVersion,
      eventHead: identity.eventHead,
      actor: { actorId: identity.actorId },
      action: { actionId: 'act_planning_0001', revision: 1, actionHash: HASH },
      preview: {
        digest: HASH,
        expiresAt: '2099-08-12T08:10:00.000Z',
      },
    };
    const specPreview = {
      specId: 'SPEC-001',
      contentHash: CONTENT_HASH,
      proposalId: PROPOSAL_ID,
      proposalHash: PROPOSAL_HASH,
      eventHead: identity.eventHead,
      previewDigest: HASH,
      status: 'shaping',
    };
    const creation = {
      receipt: {
        specId: 'SPEC-001',
        slug: 'planning-handoff',
        transactionId: 'txn_planning_0001',
        contentHash: CONTENT_HASH,
        originHash: ORIGIN_HASH,
        receiptHash: RECEIPT_HASH,
        proposalId: PROPOSAL_ID,
        proposalHash: PROPOSAL_HASH,
        correlationId: 'corr_planning_0001',
        provenanceEventId: 'prv_planning_0001',
        planningHref: '#/detail/SPEC-001',
      },
      origin: {
        specId: 'SPEC-001',
        proposalId: PROPOSAL_ID,
        proposalRevision: 2,
        proposalHash: PROPOSAL_HASH,
        correlationId: 'corr_planning_0001',
        originHash: ORIGIN_HASH,
        actor: { actorId: identity.actorId, kind: 'human' },
        scopeId: identity.scopeId,
        domainId: identity.domainId,
        domainVersion: identity.domainVersion,
        cycleId: identity.cycleId,
        eventHead: identity.eventHead,
        spec: { specId: 'SPEC-001', contentHash: CONTENT_HASH },
        action: { id: 'act_planning_0001', revision: 1, hash: HASH },
        decision: { id: 'dec_planning_0001' },
      },
      progress: { nodes: [{ kind: 'spec', state: 'shaping' }] },
      nextCommands: ['planr spec show SPEC-001', '$planr:plan SPEC-001', '/planr:plan SPEC-001'],
    };
    const calls: string[] = [];
    let losePreviewProof = false;
    let returnForeignCreation = false;
    let foreignTrace: 'actor' | 'scope' | 'domain' | 'version' | null = null;
    let holdPreview = false;
    let releaseHeldPreview: ((response: Response) => void) | null = null;
    const fetcher = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/api/operate/session')) {
        return new Response(
          JSON.stringify({
            kind: 'operate-command-session',
            schemaVersion: '1.0.0',
            protocolVersion: '2.0.0',
            sessionId: 'opsess_planning_12345678',
            sessionCapability: 'A'.repeat(43),
            issuedAt: '2026-08-11T08:00:00.000Z',
            expiresAt: '2026-08-11T08:10:00.000Z',
            binding: {
              actorId: identity.actorId,
              scopeId: identity.scopeId,
              domainId: identity.domainId,
              domainVersion: identity.domainVersion,
              cycleId: identity.cycleId,
              eventHead: identity.eventHead,
              sourceViewHash: identity.viewHash,
              actionLocator: {
                subjectId: 'act_planning_0001',
                actionDigest: HASH,
                revision: 1,
              },
            },
            allowedActions: [],
            readOnly: false,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/api/operate/planning/preview')) {
        if (holdPreview) {
          return await new Promise<Response>((resolve) => {
            releaseHeldPreview = resolve;
          });
        }
        if (losePreviewProof) throw new TypeError('connection lost after POST');
        return new Response(JSON.stringify({ proposal, specPreview }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/operate/planning/create-spec')) {
        const response = structuredClone(creation);
        if (returnForeignCreation) response.origin.actor.actorId = 'foreign-owner';
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/operate/planning/trace/')) {
        const response = structuredClone(creation);
        if (foreignTrace === 'actor') response.origin.actor.actorId = 'foreign-owner';
        if (foreignTrace === 'scope') response.origin.scopeId = 'foreign-scope';
        if (foreignTrace === 'domain') response.origin.domainId = 'foreign-domain';
        if (foreignTrace === 'version') response.origin.domainVersion = '9.9.9';
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    });
    const actions = createPlanningActions({
      origin: 'http://127.0.0.1:7473',
      fetcher,
    });
    actions.bind(identity, {
      subjectId: 'act_planning_0001',
      actionDigest: HASH,
      revision: 1,
    });
    const preview = await actions.preview('act_planning_0001');
    expect(preview.specPreview.specId).toBe('SPEC-001');

    losePreviewProof = true;
    await expect(actions.preview('act_planning_0001')).rejects.toMatchObject({
      name: 'OPERATION_UNCERTAIN',
    });
    await expect(actions.createSpec(PROPOSAL_ID, HASH)).rejects.toMatchObject({
      name: 'OPERATION_UNCERTAIN',
    });

    actions.reconcile(identity);
    losePreviewProof = false;
    await actions.preview('act_planning_0001');
    returnForeignCreation = true;
    await expect(actions.createSpec(PROPOSAL_ID, HASH)).rejects.toMatchObject({
      name: 'OPERATION_UNCERTAIN',
    });
    await expect(actions.createSpec(PROPOSAL_ID, HASH)).rejects.toMatchObject({
      name: 'OPERATION_UNCERTAIN',
    });

    actions.reconcile(identity);
    returnForeignCreation = false;
    await actions.preview('act_planning_0001');
    const created = await actions.createSpec(PROPOSAL_ID, HASH);
    expect(created.receipt.specId).toBe('SPEC-001');
    await expect(actions.trace('SPEC-001')).resolves.toMatchObject({
      receipt: { specId: 'SPEC-001' },
    });
    for (foreignTrace of ['actor', 'scope', 'domain', 'version'] as const) {
      await expect(actions.trace('SPEC-001')).rejects.toMatchObject({
        name: 'OPERATE_RESPONSE_INVALID',
        message: expect.not.stringContaining(CONTENT_HASH),
      });
    }
    expect(calls.filter((url) => url.includes('planning/preview'))).toHaveLength(4);
    expect(calls.filter((url) => url.includes('planning/create-spec'))).toHaveLength(2);

    holdPreview = true;
    const stalePreview = actions.preview('act_planning_0001');
    await vi.waitFor(() => expect(releaseHeldPreview).not.toBeNull());
    actions.bind(
      createDashboardQueryIdentity({ ...identity, generation: identity.generation + 1 }),
      { subjectId: 'act_planning_0001', actionDigest: HASH, revision: 1 },
    );
    releaseHeldPreview?.(
      new Response(JSON.stringify({ stale: 'must-not-parse-or-retain' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(stalePreview).rejects.toMatchObject({ name: 'AbortError' });
  });
});
