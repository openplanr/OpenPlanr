import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPlanningDetail,
  fetchPlanningFileLink,
  fetchPlanningGraph,
  parsePlanningDetailJson,
  parsePlanningGraphJson,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { createPlanningState } from '../../../pipeline/lib/dashboard/server/planning-state.mjs';
import { handleDashboardRequest } from '../../../pipeline/lib/dashboard/server/routes.mjs';

const origin = 'http://localhost:7473';
const binding = {
  actorId: 'native-detail-contract',
  projectId: `sha256:${'a'.repeat(64)}`,
  scopeId: 'planning',
  domainId: 'planning',
  domainVersion: '1.0.0',
  generation: 7,
};
const artifacts = [
  {
    id: 'QT-071',
    type: 'quick',
    path: 'quick/QT-071-native-detail.md',
    title: 'Quick native detail',
    body: '\n## Acceptance Criteria\n- Read quick task details from disk.\n',
  },
  {
    id: 'SPEC-027/T-121',
    type: 'task',
    path: 'specs/SPEC-027-native-detail/tasks/T-121-detail.md',
    title: 'Scoped native detail',
    body: '\n## Acceptance Criteria\n- Read the scoped task exactly.\n\n## Files\n- `src/detail #?.ts`\n',
  },
  {
    id: 'SPEC-027',
    type: 'spec',
    path: 'specs/SPEC-027-native-detail/SPEC-027-native-detail.md',
    title: 'Specification native detail',
    body: '\n## Acceptance Criteria\n- Read the specification body.\n',
  },
] as const;
const roots: string[] = [];

function source(artifact: (typeof artifacts)[number], title: string = artifact.title) {
  return `---\nid: ${artifact.id.split('/').at(-1)}\ntitle: ${title}\nstatus: pending\ngithubIssue: 123\nlinearIssueIdentifier: OPR-121\n---\n${artifact.body}`;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'planning-native-detail-contract-'));
  roots.push(root);
  const planrDir = join(root, '.planr');
  for (const artifact of artifacts) {
    const path = join(planrDir, artifact.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source(artifact));
  }
  // Exclude the optional installed CLI so these reads exercise the native disk reader.
  vi.stubEnv('PATH', '');
  const planning = createPlanningState({ planrDir });
  const dashboard = {
    planrDir,
    project: { projectId: binding.projectId },
    planningActorId: binding.actorId,
    planning,
  };
  const requests: Array<{ url: string; method: string }> = [];
  const request = async (url: URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const req = {
      method: init.method ?? 'GET',
      url: `${url.pathname}${url.search}`,
      headers: {
        host: 'localhost:7473',
        'x-openplanr-actor': headers.get('x-openplanr-actor') ?? binding.actorId,
      },
      socket: { localPort: 7473, remoteAddress: '127.0.0.1' },
    };
    requests.push({ url: req.url, method: req.method });
    const res = {
      status: 0,
      headersSent: false,
      body: '',
      headers: {} as Record<string, string>,
      writeHead(status: number, responseHeaders: Record<string, string>) {
        this.status = status;
        this.headers = responseHeaders;
        this.headersSent = true;
      },
      end(body = '') {
        this.body = body;
      },
    };
    await handleDashboardRequest(dashboard, req, res);
    return res;
  };
  const fetcher: typeof fetch = async (input, init) => {
    const res = await request(new URL(String(input)), init);
    return new Response(res.body, { status: res.status, headers: res.headers });
  };
  const urlFor = (path: string) => {
    const url = new URL(path, origin);
    for (const [key, value] of Object.entries(binding))
      if (key !== 'actorId') url.searchParams.set(key, String(value));
    return url;
  };
  const identity = createDashboardQueryIdentity({
    ...binding,
    productArea: 'planning',
    route: '#/list',
    subjectId: null,
    cycleId: null,
    eventHead: null,
    viewHash: null,
  });
  return { planrDir, planning, request, requests, fetcher, urlFor, identity };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('native Planning server and detail client contract', () => {
  it('accepts an explicitly selected canonical task from the exact collection graph', async () => {
    const current = fixture();
    const snapshot = await fetchPlanningGraph({
      origin,
      identity: current.identity,
      fetcher: current.fetcher,
    });
    const nodeId = artifacts[1].id;
    const identity = createDashboardQueryIdentity({
      ...current.identity,
      eventHead: snapshot.cursor.eventHead,
      viewHash: snapshot.cursor.viewHash,
    });
    const accepted = await fetchPlanningDetail({
      origin,
      identity,
      snapshot,
      nodeId,
      fetcher: current.fetcher,
    });
    expect(identity.subjectId).toBeNull();
    expect(identity.route).toBe('#/list');
    expect(accepted.subjectId).toBe(nodeId);
    expect(accepted.binding).toEqual(snapshot.binding);
    expect(accepted.cursor).toEqual(snapshot.cursor);
    expect(accepted.nodeHash).toBe(sha256Jcs(accepted.node as never));
    const { body, ...summary } = accepted.node;
    expect(body).toBe(artifacts[1].body);
    expect(summary).toEqual(snapshot.graph.nodes.find((node) => node.id === nodeId));
    expect(parsePlanningDetailJson(JSON.stringify(accepted), identity, snapshot, nodeId)).toEqual(
      accepted,
    );
    expect(current.requests.at(-1)?.url.split('?')[0]).toBe(
      '/api/planning/detail/SPEC-027%2FT-121',
    );
  });

  it('reads an opaque authored native identity as one encoded transport segment without inventing a public detail route', async () => {
    const current = fixture();
    const nodeId = 'specs/fixture-1/T-001';
    const path = join(current.planrDir, 'tasks/T-001-opaque.md');
    const body = '\n## Acceptance Criteria\n- The collection owns this opaque artifact.\n';
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `---\nid: ${nodeId}\ntitle: Opaque native task\nstatus: pending\n---\n${body}`,
    );
    const snapshot = await fetchPlanningGraph({
      origin,
      identity: current.identity,
      fetcher: current.fetcher,
    });
    const accepted = await fetchPlanningDetail({
      origin,
      identity: current.identity,
      snapshot,
      nodeId,
      fetcher: current.fetcher,
    });
    expect(accepted.subjectId).toBe(nodeId);
    expect(accepted.node.id).toBe(nodeId);
    expect(accepted.node.body).toBe(body);
    expect(accepted.nodeHash).toBe(sha256Jcs(accepted.node as never));
    const { body: _body, ...summary } = accepted.node;
    expect(summary).toEqual(snapshot.graph.nodes.find((node) => node.id === nodeId));
    expect(current.requests.at(-1)?.url.split('?')[0]).toBe(
      '/api/planning/detail/specs%2Ffixture-1%2FT-001',
    );
  });

  it('rejects foreign explicit selections and contradictory routed identities before transport', async () => {
    const current = fixture();
    const snapshot = await fetchPlanningGraph({
      origin,
      identity: current.identity,
      fetcher: current.fetcher,
    });
    const routed = createDashboardQueryIdentity({
      ...current.identity,
      route: '#/detail/QT-071',
      subjectId: 'QT-071',
      eventHead: snapshot.cursor.eventHead,
      viewHash: snapshot.cursor.viewHash,
    });
    const fetcher = vi.fn(current.fetcher);
    for (const options of [
      { identity: current.identity, nodeId: undefined },
      { identity: current.identity, nodeId: 'SPEC-027/T-999' },
      { identity: routed, nodeId: artifacts[1].id },
      {
        identity: createDashboardQueryIdentity({ ...current.identity, generation: 8 }),
        nodeId: artifacts[1].id,
      },
    ])
      await expect(
        fetchPlanningDetail({ origin, snapshot, fetcher, ...options }),
      ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('retains exact node, cursor, body and binding commitments for collection-selected detail responses', async () => {
    const current = fixture();
    const snapshot = await fetchPlanningGraph({
      origin,
      identity: current.identity,
      fetcher: current.fetcher,
    });
    const selectedNodeId = artifacts[1].id;
    const accepted = await fetchPlanningDetail({
      origin,
      identity: current.identity,
      snapshot,
      nodeId: selectedNodeId,
      fetcher: current.fetcher,
    });
    const wrongNode = await fetchPlanningDetail({
      origin,
      identity: current.identity,
      snapshot,
      nodeId: artifacts[0].id,
      fetcher: current.fetcher,
    });
    const altered = { ...accepted.node, body: 'Altered after the native read' };
    const cases = [
      wrongNode,
      { ...accepted, node: altered },
      { ...accepted, nodeHash: `sha256:${'0'.repeat(64)}` },
      { ...accepted, cursor: { ...accepted.cursor, viewHash: `sha256:${'0'.repeat(64)}` } },
      {
        ...accepted,
        cursor: {
          ...accepted.cursor,
          eventHead: { sequence: 1, hash: `sha256:${'b'.repeat(64)}` },
        },
      },
      { ...accepted, binding: { ...accepted.binding, actorId: 'other-reader' } },
      { ...accepted, unexpectedField: true },
    ];
    for (const value of cases) {
      const text = JSON.stringify(value);
      expect(() =>
        parsePlanningDetailJson(text, current.identity, snapshot, selectedNodeId),
      ).toThrow();
      await expect(
        fetchPlanningDetail({
          origin,
          identity: current.identity,
          snapshot,
          nodeId: selectedNodeId,
          fetcher: async () =>
            new Response(text, { headers: { 'content-type': 'application/json' } }),
        }),
      ).rejects.toThrow();
    }
    const routed = createDashboardQueryIdentity({
      ...current.identity,
      route: '#/detail/QT-071',
      subjectId: 'QT-071',
    });
    expect(() =>
      parsePlanningDetailJson(JSON.stringify(accepted), routed, snapshot, selectedNodeId),
    ).toThrow();
  });

  it('resolves a declared file for the selected collection member through the native file-link route', async () => {
    const current = fixture();
    const path = 'src/detail #?.ts';
    const target = join(current.planrDir, '..', path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'File contents are not a detail response.');
    const snapshot = await fetchPlanningGraph({
      origin,
      identity: current.identity,
      fetcher: current.fetcher,
    });
    const result = await fetchPlanningFileLink({
      origin,
      identity: current.identity,
      snapshot,
      nodeId: artifacts[1].id,
      path,
      fetcher: current.fetcher,
    });
    expect(result).toMatchObject({
      state: 'available',
      nodeId: artifacts[1].id,
      path,
      binding: snapshot.binding,
      cursor: snapshot.cursor,
      sourceViewHash: snapshot.cursor.viewHash,
    });
    expect(result.editorUrl).toMatch(/^vscode:\/\/file\//u);
    expect(current.requests.at(-1)?.url.split('?')[0]).toBe(
      '/api/planning/file-link/SPEC-027%2FT-121',
    );
  });

  it('rejects a previously valid detail after the native graph commits a newer cursor', async () => {
    const current = fixture();
    const priorSnapshot = await fetchPlanningGraph({
      origin,
      identity: current.identity,
      fetcher: current.fetcher,
    });
    const nodeId = artifacts[1].id;
    const priorDetail = await fetchPlanningDetail({
      origin,
      identity: current.identity,
      snapshot: priorSnapshot,
      nodeId,
      fetcher: current.fetcher,
    });
    writeFileSync(
      join(current.planrDir, artifacts[2].path),
      source(artifacts[2], 'Updated specification on disk'),
    );
    const nativeGraph = current.planning.readFreshGraph({ preferNative: true });
    const changedSpec = nativeGraph.nodes.find(
      (node: { id: string }) => node.id === artifacts[2].id,
    );
    current.planning.commitPatch(
      current.planning.preparePatch({
        updated: [changedSpec],
        added: [],
        removed: [],
        edges: { added: [], removed: [] },
      }),
    );
    const snapshot = await fetchPlanningGraph({
      origin,
      identity: current.identity,
      fetcher: current.fetcher,
    });
    expect(snapshot.cursor.eventHead.sequence).toBe(priorSnapshot.cursor.eventHead.sequence + 1);
    const accepted = await fetchPlanningDetail({
      origin,
      identity: current.identity,
      snapshot,
      nodeId,
      fetcher: current.fetcher,
    });
    expect(accepted.node).toEqual(priorDetail.node);
    expect(accepted.cursor).toEqual(snapshot.cursor);
    expect(() =>
      parsePlanningDetailJson(JSON.stringify(priorDetail), current.identity, snapshot, nodeId),
    ).toThrow();
    await expect(
      fetchPlanningDetail({
        origin,
        identity: current.identity,
        snapshot,
        nodeId,
        fetcher: async () =>
          new Response(JSON.stringify(priorDetail), {
            headers: { 'content-type': 'application/json' },
          }),
      }),
    ).rejects.toThrow();
  });

  it.each(artifacts)(
    'accepts the real graph and $type detail for $id without injected readers',
    async (artifact) => {
      const current = fixture();
      const graphResponse = await current.request(current.urlFor('/api/planning/graph'));
      expect(graphResponse.status, graphResponse.body).toBe(200);
      expect(graphResponse.headers['cache-control']).toBe('no-store');
      const snapshot = parsePlanningGraphJson(graphResponse.body, current.identity);
      expect(snapshot.binding).toEqual(binding);
      expect(snapshot.cursor).toEqual({
        eventHead: { sequence: 0, hash: null },
        viewHash: sha256Jcs(snapshot.graph as never),
      });
      const identity = createDashboardQueryIdentity({
        ...current.identity,
        route: `#/detail/${encodeURIComponent(artifact.id)}`,
        subjectId: artifact.id,
        eventHead: snapshot.cursor.eventHead,
        viewHash: snapshot.cursor.viewHash,
      });
      const detailResponse = await current.request(
        current.urlFor(`/api/planning/detail/${encodeURIComponent(artifact.id)}`),
      );
      expect(detailResponse.status, detailResponse.body).toBe(200);
      const accepted = parsePlanningDetailJson(detailResponse.body, identity, snapshot);
      const { body, ...summary } = accepted.node;
      expect(accepted.binding).toEqual(binding);
      expect(accepted.cursor).toEqual(snapshot.cursor);
      expect(accepted.subjectId).toBe(artifact.id);
      expect(summary).toEqual(snapshot.graph.nodes.find((node) => node.id === artifact.id));
      expect(summary).toMatchObject({
        id: artifact.id,
        type: artifact.type,
        title: artifact.title,
        status: 'outstanding',
      });
      expect(body).toBe(artifact.body);
      expect(accepted.nodeHash).toBe(sha256Jcs(accepted.node as never));
      expect(accepted.node.githubIssue).toBe(123);
      expect(accepted.node.linearIssueIdentifier).toBe('OPR-121');
      await expect(
        fetchPlanningGraph({ origin, identity: current.identity, fetcher: current.fetcher }),
      ).resolves.toEqual(snapshot);
      await expect(
        fetchPlanningDetail({ origin, identity, snapshot, fetcher: current.fetcher }),
      ).resolves.toEqual(accepted);
      expect(current.requests.every((request) => request.method === 'GET')).toBe(true);
      expect(current.requests.at(-1)?.url.split('?')[0]).toBe(
        `/api/planning/detail/${encodeURIComponent(artifact.id)}`,
      );
    },
  );

  it('rejects tampered body, summary, cursor, binding and node commitments in real route responses', async () => {
    const current = fixture();
    const graphResponse = await current.request(current.urlFor('/api/planning/graph'));
    const snapshot = parsePlanningGraphJson(graphResponse.body, current.identity);
    const artifact = artifacts[1];
    const identity = createDashboardQueryIdentity({
      ...current.identity,
      route: `#/detail/${encodeURIComponent(artifact.id)}`,
      subjectId: artifact.id,
      eventHead: snapshot.cursor.eventHead,
      viewHash: snapshot.cursor.viewHash,
    });
    const actual = await current.request(
      current.urlFor(`/api/planning/detail/${encodeURIComponent(artifact.id)}`),
    );
    expect(actual.status, actual.body).toBe(200);
    const envelope = JSON.parse(actual.body);
    const changedNode = { ...envelope.node, title: 'A foreign summary' };
    for (const tampered of [
      { ...envelope, node: { ...envelope.node, body: 'Uncommitted body' } },
      { ...envelope, node: changedNode, nodeHash: sha256Jcs(changedNode) },
      { ...envelope, nodeHash: `sha256:${'0'.repeat(64)}` },
      { ...envelope, cursor: { ...envelope.cursor, viewHash: `sha256:${'0'.repeat(64)}` } },
      { ...envelope, binding: { ...envelope.binding, generation: 8 } },
      { ...envelope, subjectId: artifacts[0].id },
    ])
      expect(() => parsePlanningDetailJson(JSON.stringify(tampered), identity, snapshot)).toThrow();
  });

  it('refuses disk summary changes after the graph read instead of returning a divergent detail', async () => {
    const current = fixture();
    const snapshot = await fetchPlanningGraph({
      origin,
      identity: current.identity,
      fetcher: current.fetcher,
    });
    const artifact = artifacts[0];
    writeFileSync(
      join(current.planrDir, artifact.path),
      source(artifact, 'Changed after the snapshot'),
    );
    const actual = await current.request(
      current.urlFor(`/api/planning/detail/${encodeURIComponent(artifact.id)}`),
    );
    expect(actual.status).toBe(409);
    expect(JSON.parse(actual.body)).toMatchObject({
      error: { code: 'DASHBOARD_RESPONSE_INVALID' },
    });
    const identity = createDashboardQueryIdentity({
      ...current.identity,
      route: `#/detail/${encodeURIComponent(artifact.id)}`,
      subjectId: artifact.id,
      eventHead: snapshot.cursor.eventHead,
      viewHash: snapshot.cursor.viewHash,
    });
    await expect(
      fetchPlanningDetail({ origin, identity, snapshot, fetcher: current.fetcher }),
    ).rejects.toThrow();
  });
});
