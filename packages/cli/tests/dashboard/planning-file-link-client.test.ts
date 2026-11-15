import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchPlanningFileLink,
  type PlanningGraph,
  parsePlanningFileLinkJson,
  parsePlanningGraphEnvelope,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import { planningDetailHref } from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';

const nodeId = 'SPEC-020/T-022';
const file = 'src/hello #?.ts';
const otherHash = `sha256:${'a'.repeat(64)}`;
const graph: PlanningGraph = {
  nodes: [
    {
      id: nodeId,
      type: 'task',
      title: 'Safe file links',
      status: 'in-progress',
      frontmatter: { id: 'T-022' },
    },
  ],
  edges: [],
};
const cursor = {
  eventHead: { sequence: 4, hash: `sha256:${'b'.repeat(64)}` },
  viewHash: sha256Jcs(graph as never),
};
const identity = createDashboardQueryIdentity({
  productArea: 'planning',
  route: planningDetailHref(nodeId),
  actorId: 'owner-file-link',
  projectId: `sha256:${'e'.repeat(64)}`,
  scopeId: 'planning',
  domainId: 'planning',
  domainVersion: '1.0.0',
  cycleId: null,
  subjectId: nodeId,
  eventHead: cursor.eventHead,
  viewHash: cursor.viewHash,
  generation: 8,
});
const binding = {
  actorId: identity.actorId,
  projectId: identity.projectId,
  scopeId: 'planning',
  domainId: 'planning',
  domainVersion: '1.0.0',
  generation: identity.generation,
};
const snapshot = parsePlanningGraphEnvelope(
  {
    kind: 'planning-graph-snapshot',
    schemaVersion: '1.0.0',
    binding,
    cursor,
    mode: 'empty',
    graph,
  },
  identity,
);

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'planning-file-link',
    schemaVersion: '1.0.0',
    binding,
    cursor,
    sourceViewHash: cursor.viewHash,
    nodeId,
    state: 'available',
    reason: null,
    errorCode: null,
    path: file,
    editorUrl: 'vscode://file/Users/example/project/src/hello%20%23%3F.ts',
    ...overrides,
  };
}

function parse(value = envelope()) {
  return parsePlanningFileLinkJson(JSON.stringify(value), identity, snapshot, file);
}

function jsonResponse(text: string, options: ResponseInit = {}) {
  return new Response(text, { headers: { 'content-type': 'application/json' }, ...options });
}

describe('Planning file-link client validation', () => {
  it('accepts and freezes available links bound to the selected artifact and source snapshot', () => {
    const accepted = parse();
    expect(accepted).toEqual(envelope());
    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(accepted.binding)).toBe(true);
    expect(Object.isFrozen(accepted.cursor.eventHead)).toBe(true);
  });

  it.each([
    {
      state: 'unavailable',
      reason: 'The selected artifact does not declare this file.',
      errorCode: null,
      path: null,
    },
    { state: 'unavailable', reason: 'The target is not available.', errorCode: null, path: file },
    {
      state: 'error',
      reason: 'The target could not be inspected.',
      errorCode: 'EACCES',
      path: file,
    },
    {
      state: 'error',
      reason: 'The selected artifact could not be read.',
      errorCode: 'ENOENT',
      path: null,
    },
  ])('retains safe $state outcomes and their error code', (outcome) => {
    expect(parse(envelope({ ...outcome, editorUrl: null }))).toMatchObject(outcome);
  });

  it.each([
    ['actor', { binding: { ...binding, actorId: 'foreign-owner' } }],
    ['project', { binding: { ...binding, projectId: otherHash } }],
    ['scope', { binding: { ...binding, scopeId: 'other' } }],
    ['domain', { binding: { ...binding, domainId: 'other' } }],
    ['domain version', { binding: { ...binding, domainVersion: '2.0.0' } }],
    ['generation', { binding: { ...binding, generation: 9 } }],
    ['source hash', { sourceViewHash: otherHash }],
    ['cursor view hash', { cursor: { ...cursor, viewHash: otherHash } }],
    ['cursor sequence', { cursor: { ...cursor, eventHead: { ...cursor.eventHead, sequence: 5 } } }],
    [
      'cursor event hash',
      { cursor: { ...cursor, eventHead: { ...cursor.eventHead, hash: otherHash } } },
    ],
    ['node', { nodeId: 'SPEC-021/T-022' }],
    ['requested path', { path: 'src/other.ts' }],
    ['unknown field', { targetContents: 'untrusted' }],
    ['unsupported schema', { schemaVersion: '2.0.0' }],
    ['unsupported kind', { kind: 'file-link' }],
    ['unsupported state', { state: 'ready' }],
    ['available error code', { errorCode: 'EIO' }],
    ['available reason', { reason: 'unexpected' }],
    ['available missing path', { path: null }],
  ])('rejects mismatched or open %s', (_label, override) => {
    expect(() => parse(envelope(override))).toThrow();
  });

  it.each([
    'javascript:alert(1)',
    'https://example.com/file',
    'file:///tmp/file',
    'vscode://file/Users/example/../secret',
    'vscode://file/Users/example/%2E%2E/secret',
    'vscode://file/Users/example/%2Fsecret',
    'vscode://file/Users/example/%5Csecret',
    'vscode://file/Users/example/%00secret',
    'vscode://file/Users/example/file?command=run',
    'vscode://file/Users/example/file#fragment',
    'vscode://file//Users/example/file',
    'vscode://file/Users/example/hello%20%23%3f.ts',
  ])('rejects unsafe or noncanonical editor URL %s', (editorUrl) => {
    expect(() => parse(envelope({ editorUrl }))).toThrow();
  });

  it.each([
    { state: 'error', errorCode: null },
    { state: 'error', errorCode: 'EUNKNOWN' },
    { state: 'unavailable', errorCode: 'EIO' },
    { state: 'unavailable', reason: '' },
    { state: 'error', errorCode: 'EIO', reason: 'x'.repeat(501) },
  ])('rejects malformed refusal/error states %j', (outcome) => {
    expect(() => parse(envelope({ reason: 'Unavailable', editorUrl: null, ...outcome }))).toThrow();
  });

  it('rejects editor links attached to a refusal or error', () => {
    for (const state of ['unavailable', 'error']) {
      expect(() =>
        parse(
          envelope({ state, reason: 'Unavailable', errorCode: state === 'error' ? 'EIO' : null }),
        ),
      ).toThrow();
    }
  });

  it('rejects invalid JSON, duplicate keys and responses above the 16KiB wire budget', () => {
    const valid = JSON.stringify(envelope());
    const duplicate = valid.replace(
      '"state":"available"',
      '"state":"unavailable","state":"available"',
    );
    for (const text of ['{', 'null', '[]', duplicate, `${' '.repeat(16 * 1024)}${valid}`]) {
      expect(() => parsePlanningFileLinkJson(text, identity, snapshot, file)).toThrow();
    }
  });

  it('rejects a snapshot from another generation and an artifact missing from the source graph', () => {
    expect(() =>
      parsePlanningFileLinkJson(
        JSON.stringify(envelope()),
        identity,
        { ...snapshot, binding: { ...snapshot.binding, generation: 9 } },
        file,
      ),
    ).toThrow();
    const missingGraph = { nodes: [], edges: [] };
    const missingCursor = { ...cursor, viewHash: sha256Jcs(missingGraph as never) };
    const missing = parsePlanningGraphEnvelope(
      { ...snapshot, mode: 'empty', graph: missingGraph, cursor: missingCursor },
      identity,
    );
    expect(() =>
      parsePlanningFileLinkJson(
        JSON.stringify(envelope({ cursor: missingCursor, sourceViewHash: missingCursor.viewHash })),
        identity,
        missing,
        file,
      ),
    ).toThrow();
  });
});

describe('Planning file-link GET transport', () => {
  it('encodes scoped node IDs and paths, binds the actor and source, and forwards cancellation', async () => {
    const fetcher = vi.fn(async () => jsonResponse(JSON.stringify(envelope())));
    const controller = new AbortController();
    await expect(
      fetchPlanningFileLink({
        origin: 'http://127.0.0.1:7473',
        identity,
        snapshot,
        path: file,
        fetcher: fetcher as typeof fetch,
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({ state: 'available' });
    expect(fetcher).toHaveBeenCalledOnce();
    const [input, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    const url = new URL(String(input));
    expect(url.origin).toBe('http://127.0.0.1:7473');
    expect(url.pathname).toBe('/api/planning/file-link/SPEC-020%2FT-022');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      projectId: identity.projectId,
      scopeId: 'planning',
      domainId: 'planning',
      domainVersion: '1.0.0',
      generation: '8',
      sourceViewHash: cursor.viewHash,
      file,
    });
    expect(url.search).toContain('file=src%2Fhello+%23%3F.ts');
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBe(controller.signal);
    expect(new Headers(init.headers).get('x-openplanr-actor')).toBe(identity.actorId);
    expect(new Headers(init.headers).get('accept')).toBe('application/json');
  });

  it.each([
    '',
    '../secret',
    '/absolute',
    'src/../secret',
    'src//file',
    'src/./file',
    'src\\file',
    'src/%2E%2E/file',
    'C:/file',
    'src/\u0000file',
    '\ud800',
    'a'.repeat(1025),
    'é'.repeat(200),
  ])('does not send unsafe or oversized requested path %j', async (path) => {
    const fetcher = vi.fn();
    await expect(
      fetchPlanningFileLink({
        origin: 'http://localhost:7473',
        identity,
        snapshot,
        path,
        fetcher: fetcher as typeof fetch,
      }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    'https://localhost:7473',
    'http://example.com:7473',
    'http://localhost:7473/path',
    'http://localhost:7473/?foreign=1',
    'http://localhost:7473/#fragment',
  ])('does not send to a noncanonical loopback origin %s', async (origin) => {
    const fetcher = vi.fn();
    await expect(
      fetchPlanningFileLink({
        origin,
        identity,
        snapshot,
        path: file,
        fetcher: fetcher as typeof fetch,
      }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    () => jsonResponse(JSON.stringify(envelope()), { status: 409 }),
    () => new Response(JSON.stringify(envelope()), { headers: { 'content-type': 'text/html' } }),
    () => jsonResponse(' '.repeat(16 * 1024) + JSON.stringify(envelope())),
    () => jsonResponse(JSON.stringify(envelope({ sourceViewHash: otherHash }))),
  ])('fails closed on unavailable, unexpected or unbound responses', async (response) => {
    await expect(
      fetchPlanningFileLink({
        origin: 'http://localhost:7473',
        identity,
        snapshot,
        path: file,
        fetcher: vi.fn(async () => response()) as typeof fetch,
      }),
    ).rejects.toThrow();
  });
});
