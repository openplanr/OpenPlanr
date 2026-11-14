import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validNodeId as pipelineValidNodeId } from '../../../pipeline/lib/dashboard/graph-read-model.mjs';
import { createPlanningState } from '../../../pipeline/lib/dashboard/server/planning-state.mjs';
import { handleDashboardRequest } from '../../../pipeline/lib/dashboard/server/routes.mjs';
import { readGraph, readPlanningModel, validNodeId } from '../../src/services/graph-service.js';

const binding = {
  actorId: 'node-id-findings',
  projectId: `sha256:${'d'.repeat(64)}`,
  scopeId: 'planning',
  domainId: 'planning',
  domainVersion: '1.0.0',
  generation: 3,
};
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'planr-node-id-findings-'));
  roots.push(root);
  mkdirSync(join(root, 'backlog'));
  writeFileSync(
    join(root, 'backlog', 'BL-001-plain.md'),
    '---\nid: BL-001\ntitle: Healthy\nstatus: outstanding\n---\n',
  );
  writeFileSync(join(root, 'backlog', 'x\\y-5.md'), '---\ntitle: Backslash\n---\n');
  writeFileSync(join(root, 'backlog', 'x\u0001y-6.md'), '---\ntitle: Control\n---\n');
  return root;
}

/** Serves the Planning routes from the CLI reader's graph and nodes. */
function serve(planrDir: string) {
  const planning = createPlanningState({
    planrDir,
    getGraph: () => readGraph(planrDir),
    getNode: (id: string) =>
      readGraph(planrDir, { includeBody: true }).nodes.find((node) => node.id === id) ?? null,
  });
  const dashboard = {
    planrDir,
    project: { projectId: binding.projectId },
    planningActorId: binding.actorId,
    planning,
  };
  const request = async (pathname: string, params: Record<string, string> = {}) => {
    const query = new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(binding)
          .filter(([key]) => key !== 'actorId')
          .map(([key, value]) => [key, String(value)]),
      ),
      ...params,
    });
    const req = {
      method: 'GET',
      url: `${pathname}?${query}`,
      headers: { host: 'localhost:7473', 'x-openplanr-actor': binding.actorId },
      socket: { localPort: 7473, remoteAddress: '127.0.0.1' },
    };
    const res = {
      status: 0,
      body: '',
      headers: {} as Record<string, string>,
      writeHead(status: number, headers: Record<string, string>) {
        this.status = status;
        this.headers = headers;
      },
      end(body = '') {
        this.body = body;
      },
    };
    await handleDashboardRequest(dashboard, req, res);
    return { status: res.status, json: JSON.parse(res.body) };
  };
  return { planning, request };
}

describe('a file name that cannot be a node id', () => {
  it('is an unrecognized-identity finding, and Board, Detail and Data health still load', async () => {
    const planrDir = project();
    const { planning, request } = serve(planrDir);
    const graph = await request('/api/planning/graph');
    expect(graph.status).toBe(200);
    expect(graph.json.graph.nodes.map((node: { id: string }) => node.id)).toEqual(['BL-001']);
    const detail = await request('/api/planning/detail/BL-001');
    expect(detail.status).toBe(200);
    expect(detail.json.node.id).toBe('BL-001');
    const diagnostics = await request('/api/planning/diagnostics', {
      sourceViewHash: planning.cursor().viewHash,
    });
    expect(diagnostics.json.state).toBe('available');
    expect(
      diagnostics.json.diagnostics.map(
        (entry: { reason: string; nodeId: string; sourcePath: string }) => [
          entry.reason,
          entry.nodeId,
          entry.sourcePath,
        ],
      ),
    ).toEqual([
      ['unrecognized-identity', 'x\uFFFDy-6', '.planr/backlog/x\uFFFDy-6.md'],
      ['unrecognized-identity', 'x\\y-5', '.planr/backlog/x\uFFFDy-5.md'],
    ]);
    expect(readGraph(planrDir).nodes.map((node) => node.id)).toEqual(['BL-001']);
    expect(
      readPlanningModel(planrDir)
        .diagnostics.map((entry) => [entry.reason, entry.nodeId, entry.sourcePath])
        .sort((a, b) => a.join().localeCompare(b.join())),
    ).toEqual([
      ['unrecognized-identity', 'x\\y-5', 'backlog/x\uFFFDy-5.md'],
      ['unrecognized-identity', 'x\u0001y-6', 'backlog/x\u0001y-6.md'],
    ]);
  });

  it('follows the same node-id rule in the CLI and the pipeline', () => {
    const cases = [
      'BL-001',
      'SPEC-001/US-001',
      'x\\y-5',
      'x\u0001y-6',
      'x\u007fy-7',
      'x\ud800y-8',
      'x\udc00y-9',
      '\ud83d\ude80-10',
      '.',
      '..',
      '',
      'a'.repeat(256),
      'a'.repeat(257),
      `SPEC-001/${'a'.repeat(248)}`,
      42,
      null,
    ];
    for (const value of cases)
      expect(validNodeId(value), JSON.stringify(value)).toBe(pipelineValidNodeId(value));
    expect(cases.filter((value) => validNodeId(value))).toEqual([
      'BL-001',
      'SPEC-001/US-001',
      '\ud83d\ude80-10',
      'a'.repeat(256),
    ]);
  });
});
