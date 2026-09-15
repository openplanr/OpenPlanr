import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { describe, expect, it } from 'vitest';
import { fetchOperateSearchHits } from '../../../../apps/dashboard/src/features/search/operate-search-api.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { resolvePipelinePackageRoot } from '../helpers/pipeline-package-root.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;

function auditView(pipelineRoot: string) {
  const emptyView = JSON.parse(
    readFileSync(
      join(pipelineRoot, 'conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json'),
      'utf8',
    ),
  )['operate-experience-view'] as Record<string, unknown>;

  const value = {
    ...structuredClone(emptyView),
    cycles: [
      {
        cycleId: 'cycle-1',
        state: 'approved',
        health: 'normal',
        focus: ['Keep audit reads evidence-bound.'],
        createdAt: '2026-08-11T07:00:00Z',
        updatedAt: emptyView.generatedAt,
        stages: ['observe', 'understand', 'decide', 'govern', 'act', 'verify', 'learn'].map(
          (id, index) => ({
            id,
            state: index < 4 ? 'complete' : index === 4 ? 'current' : 'waiting',
            reason: null,
            inputArtifactIds: [],
            outputArtifactIds: [],
            gates: [],
            evidenceGapIds: [],
            uncertaintyIds: [],
            persistentActionIds: [],
          }),
        ),
        assignments: [],
        lensAbsences: [],
        executiveBoard: null,
        dependencies: [],
        blockers: [],
        persistentActionIds: ['act_00000001'],
        replayCheckpoint: null,
        deepLink: '#/operate/cycles/cycle-1',
      },
    ],
    actions: [
      {
        actionId: 'act_00000001',
        revision: 1,
        actionHash: HASH_A,
        title: 'Measure retention',
        state: 'completed',
        ownerActorId: emptyView.actorId,
        expectedResult: 'Retention remains evidence-bound.',
        verificationPlanId: 'verify-1',
        deliveryRoute: {
          kind: 'operating-delivery-route',
          schemaVersion: '1.0.0',
          protocolVersion: '2.0.0',
          routeId: 'droute_00000001',
          scopeId: emptyView.scopeId,
          domainId: emptyView.domainId,
          domainVersion: emptyView.domainVersion,
          action: {
            actionId: 'act_00000001',
            revision: 1,
            actionHash: HASH_A,
          },
          eventHead: structuredClone(emptyView.eventHead),
          route: 'observe-only',
          rationale: 'The audit surface is read-only.',
          createdAt: emptyView.generatedAt,
          routeHash: HASH_B,
        },
        dependencyActionIds: [],
        executions: [],
        rollbacks: [],
        deepLink: '#/operate/actions/act_00000001',
      },
    ],
    replay: {
      ...(structuredClone(emptyView.replay) as Record<string, unknown>),
      parityProof: {
        ...(emptyView.replay as { parityProof: Record<string, unknown> }).parityProof,
        stateParityVerified: true,
      },
    },
  };
  const { viewHash: _ignored, ...withoutHash } = value;
  return { ...value, viewHash: sha256Jcs(withoutHash) };
}

describe('dashboard operate search server integration', () => {
  it('serves search hits with callable action deep links', async () => {
    const pipelineRoot = resolvePipelinePackageRoot();
    const { createDashboardServer } = await import(
      pathToFileURL(join(pipelineRoot, 'lib/dashboard/server.mjs')).href
    );
    const view = auditView(pipelineRoot);
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'openplanr-search-server-'));
    const planrDir = join(temporaryRoot, 'project', '.planr');
    mkdirSync(planrDir, { recursive: true });
    writeFileSync(
      join(planrDir, 'config.json'),
      JSON.stringify({ projectName: 'Search server integration' }),
    );
    const dashboard = createDashboardServer({
      planrDir,
      watch: false,
      getOperatingCommandGateway: () => null,
      getOperatingExperience: () => ({
        available: true,
        readOnly: true,
        status: 'ready',
        view,
        reasonCodes: [],
      }),
    });
    try {
      const port = await dashboard.listen(0, {
        env: { ...process.env, PLANR_HOME: join(temporaryRoot, 'home') },
      });
      const origin = `http://127.0.0.1:${port}`;
      const identity = createDashboardQueryIdentity({
        route: '#/operate/cycles/cycle-1',
        productArea: 'operate',
        projectId: HASH_C,
        scopeId: view.scopeId as string,
        domainId: view.domainId as string,
        domainVersion: view.domainVersion as string,
        actorId: view.actorId as string,
        cycleId: 'cycle-1',
        subjectId: 'cycle-1',
        eventHead: view.eventHead as { sequence: number; hash: string },
        viewHash: view.viewHash as string,
        generation: 1,
      });
      const hits = await fetchOperateSearchHits({
        origin,
        identity,
        query: 'Measure retention',
      });
      expect(hits.some((hit) => hit.deepLink === '#/operate/actions/act_00000001')).toBe(true);
    } finally {
      await dashboard.close();
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
