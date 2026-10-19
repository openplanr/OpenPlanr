import { fileURLToPath } from 'node:url';
import { PLANNING_DIAGNOSTICS_MAX_BYTES } from '@openplanr/protocol/dashboard/planning-diagnostics-contracts.mjs';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchPlanningDiagnostics,
  parsePlanningDiagnosticsJson,
  parsePlanningGraphEnvelope,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { getPlanningReadModel } from '../../../pipeline/lib/dashboard/graph-engine.mjs';
import { handlePlanningDiagnostics } from '../../../pipeline/lib/dashboard/server/planning-routes.mjs';
import { createPlanningState } from '../../../pipeline/lib/dashboard/server/planning-state.mjs';

const planrDir = fileURLToPath(
  new URL('../../../pipeline/conformance/fixtures/dashboard-identity/.planr/', import.meta.url),
);
const model = getPlanningReadModel(planrDir);
const planning = createPlanningState({ planrDir, getGraph: () => model.graph });
const binding = {
  actorId: 'diagnostics-reader',
  projectId: `sha256:${'e'.repeat(64)}`,
  scopeId: 'planning',
  domainId: 'planning',
  domainVersion: '1.0.0',
  generation: 2,
};
const identity = createDashboardQueryIdentity({
  ...binding,
  productArea: 'planning',
  route: '#/home',
  cycleId: null,
  subjectId: null,
  eventHead: planning.cursor().eventHead,
  viewHash: planning.cursor().viewHash,
});
const snapshot = parsePlanningGraphEnvelope(planning.graphEnvelope(binding), identity);
const otherHash = `sha256:${'a'.repeat(64)}`;

function serverResponse(input?: URL | string, init?: RequestInit) {
  const url = new URL(input ?? 'http://127.0.0.1:7473/api/planning/diagnostics');
  if (!input) {
    for (const [key, value] of Object.entries(binding)) {
      if (key !== 'actorId') url.searchParams.set(key, String(value));
    }
    url.searchParams.set('sourceViewHash', snapshot.cursor.viewHash);
  }
  let status = 0;
  let headers = {};
  let body = '';
  handlePlanningDiagnostics({
    dashboard: {
      planrDir,
      planning,
      project: { projectId: binding.projectId },
      planningActorId: binding.actorId,
    },
    req: {
      headers: {
        'x-openplanr-actor': new Headers(init?.headers).get('x-openplanr-actor') ?? binding.actorId,
      },
    },
    res: {
      writeHead(code: number, values: Record<string, string>) {
        status = code;
        headers = values;
      },
      end(value: string) {
        body = value;
      },
    },
    url,
    pathname: url.pathname,
  });
  return { status, headers, body };
}
function parse(value: unknown) {
  return parsePlanningDiagnosticsJson(JSON.stringify(value), identity, snapshot);
}

describe('Planning diagnostics producer and client contract without sockets', () => {
  it('accepts real handler output while preserving corrected identities and authored chronology', () => {
    const response = serverResponse();
    expect(response.status).toBe(200);
    const accepted = parsePlanningDiagnosticsJson(response.body, identity, snapshot);
    expect(accepted.state).toBe('available');
    expect(accepted.totalCount).toBe(model.diagnostics.length);
    expect(accepted.diagnostics).toContainEqual({
      nodeId: 'SPRINT-002',
      sourcePath: '.planr/sprints/SPRINT-002-impossible.md',
      field: 'closedAt',
      reason: 'closed-before-start',
      classification: 'source-data',
    });
    expect(snapshot.graph.nodes.find((node) => node.id === 'ADR-024')).toMatchObject({
      title: 'Native-first delegation',
    });
    expect(snapshot.graph.nodes.some((node) => node.id.includes('README'))).toBe(false);
    expect(
      model.references.find((ref) => ref.nodeId === 'SPRINT-001' && ref.authoredRef === 'T-055'),
    ).toMatchObject({ targetId: 'SPEC-015/T-055', reason: null });
    expect(
      snapshot.graph.nodes.find((node) => node.id === 'SPRINT-002')?.frontmatter.closedAt,
    ).toBe('2026-10-02');
    expect(response.body).not.toContain(planrDir);
    expect(Object.isFrozen(accepted.diagnostics)).toBe(true);
  });

  it.each(['actorId', 'projectId', 'scopeId', 'domainId', 'domainVersion', 'generation'])(
    'rejects a foreign %s',
    (field) => {
      const value = JSON.parse(serverResponse().body);
      value.binding[field] = field === 'generation' ? 3 : 'foreign';
      expect(() => parse(value)).toThrow();
    },
  );

  it.each([
    (value: Record<string, unknown>) => {
      value.sourceViewHash = otherHash;
    },
    (value: Record<string, unknown>) => {
      value.cursor = { ...snapshot.cursor, eventHead: { sequence: 1, hash: otherHash } };
    },
    (value: Record<string, unknown>) => {
      value.extra = true;
    },
    (value: Record<string, unknown>) => {
      value.schemaVersion = '2.0.0';
    },
    (value: Record<string, unknown>) => {
      value.diagnostics = [{ ...model.diagnostics[0], sourcePath: '/private/source.md' }];
    },
  ])('rejects unbound or open producer output', (mutate) => {
    const value = JSON.parse(serverResponse().body);
    mutate(value);
    expect(() => parse(value)).toThrow();
  });

  it('rejects duplicate JSON keys, oversized wire payloads and foreign snapshots', () => {
    const body = serverResponse().body;
    expect(() =>
      parsePlanningDiagnosticsJson(
        body.replace('"kind":', '"kind":"foreign","kind":'),
        identity,
        snapshot,
      ),
    ).toThrow();
    expect(() =>
      parsePlanningDiagnosticsJson(
        ' '.repeat(PLANNING_DIAGNOSTICS_MAX_BYTES) + body,
        identity,
        snapshot,
      ),
    ).toThrow();
    expect(() =>
      parsePlanningDiagnosticsJson(body, { ...identity, generation: 3 }, snapshot),
    ).toThrow();
  });

  it('sends the exact read-only actor, binding and graph commitment and forwards cancellation', async () => {
    const fetcher = vi.fn(async (input: URL | string, init: RequestInit) => {
      const response = serverResponse(input, init);
      return new Response(response.body, { status: response.status, headers: response.headers });
    });
    const controller = new AbortController();
    await expect(
      fetchPlanningDiagnostics({
        origin: 'http://127.0.0.1:7473',
        identity,
        snapshot,
        signal: controller.signal,
        fetcher: fetcher as typeof fetch,
      }),
    ).resolves.toMatchObject({ state: 'available' });
    const call = fetcher.mock.calls[0];
    if (!call) throw new Error('Expected read');
    const [url, init] = call;
    expect(new URL(url).pathname).toBe('/api/planning/diagnostics');
    expect(new URL(url).searchParams.get('sourceViewHash')).toBe(snapshot.cursor.viewHash);
    expect(new Headers(init.headers).get('x-openplanr-actor')).toBe(binding.actorId);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBe(controller.signal);
  });
});
