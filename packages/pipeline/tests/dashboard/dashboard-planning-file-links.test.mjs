import assert from 'node:assert/strict';
import * as childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { readGraph } from '../../lib/dashboard/graph-reader.mjs';
import { assertPlanningFileLinkEnvelope } from '../../lib/dashboard/planning-file-link-contracts.mjs';
import {
  declaredPlanningFiles,
  resolvePlanningFileLink,
} from '../../lib/dashboard/server/planning-file-links.mjs';
import { createPlanningState } from '../../lib/dashboard/server/planning-state.mjs';
import { handleDashboardRequest } from '../../lib/dashboard/server/routes.mjs';

const projectId = `sha256:${'a'.repeat(64)}`;
const actorId = 'file-link-owner';
const nodeId = 'SPEC-001/T-001';
const sourcePath = '.planr/specs/SPEC-001-example/tasks/T-001-example.md';

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'planning-file-links-'));
  const outside = fs.mkdtempSync(join(tmpdir(), 'planning-file-outside-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const declared = [
    'src/hello #?.ts',
    'src/missing.ts',
    'src/missing-parent/file.ts',
    'src/external.ts',
    'src/external-dir/missing.ts',
    'src/internal.ts',
    'src/directory',
    'src/dangling.ts',
  ];
  fs.mkdirSync(dirname(join(root, sourcePath)), { recursive: true });
  fs.mkdirSync(join(root, 'src/directory'), { recursive: true });
  fs.writeFileSync(join(root, 'src/hello #?.ts'), 'private target body');
  fs.writeFileSync(join(root, 'src/unlisted.ts'), 'private unlisted body');
  fs.writeFileSync(join(outside, 'secret.ts'), 'private outside body');
  fs.symlinkSync(join(outside, 'secret.ts'), join(root, 'src/external.ts'));
  fs.symlinkSync(outside, join(root, 'src/external-dir'));
  fs.symlinkSync(join(root, 'src/hello #?.ts'), join(root, 'src/internal.ts'));
  fs.symlinkSync(join(outside, 'absent.ts'), join(root, 'src/dangling.ts'));
  fs.writeFileSync(
    join(root, sourcePath),
    `---\nid: T-001\ntitle: File links\nstatus: pending\n---\n\n## Files\n### Modify\n${declared.map((path) => `- \`${path}\``).join('\n')}\n## Notes\n- \`src/unlisted.ts\`\n`,
  );
  fs.writeFileSync(
    join(dirname(join(root, sourcePath)), 'T-002-unrelated.md'),
    '---\nid: T-002\ntitle: Unrelated artifact\nstatus: pending\n---\n## Files\n- `src/unlisted.ts`\n',
  );
  const planrDir = join(root, '.planr');
  const planning = createPlanningState({ planrDir, getGraph: undefined, getNode: undefined });
  const dashboard = {
    planrDir,
    project: { projectId },
    planningActorId: actorId,
    planning,
  };
  const request = async (file, options = {}) => {
    const params = new URLSearchParams({
      projectId,
      scopeId: 'planning',
      domainId: 'planning',
      domainVersion: '1.0.0',
      generation: '3',
      ...(options.detail
        ? {}
        : { file, sourceViewHash: options.sourceViewHash ?? planning.cursor().viewHash }),
      ...options.params,
    });
    if (options.append) params.append(...options.append);
    const subject = options.subject ?? encodeURIComponent(nodeId);
    const req = {
      method: 'GET',
      url: `/api/planning/${options.detail ? 'detail' : 'file-link'}/${subject}?${params}`,
      headers: { host: 'localhost:7473', 'x-openplanr-actor': options.actor ?? actorId },
      socket: { localPort: 7473, remoteAddress: '127.0.0.1' },
    };
    const res = {
      status: null,
      headersSent: false,
      body: '',
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
        this.headersSent = true;
      },
      end(body) {
        this.body = body;
      },
    };
    await handleDashboardRequest(dashboard, req, res);
    return { ...res, json: JSON.parse(res.body) };
  };
  return { root, outside, dashboard, request };
}

function assertSafeRefusal(result, root, outside) {
  assert.notEqual(result.json.state, 'available');
  assert.equal(result.json.editorUrl ?? null, null);
  assert.equal(result.body.includes(root), false);
  assert.equal(result.body.includes(outside), false);
  assert.equal(result.body.includes('private target body'), false);
  assert.equal(result.body.includes('private outside body'), false);
  assert.ok(result.json.reason || result.json.error?.code);
}

test('file-link GET reads only selected declaration metadata and never target content, writes or processes', async (t) => {
  const { root, outside, dashboard, request } = fixture(t);
  assert.equal((await request('', { detail: true })).status, 200);
  const operations = [];
  const declarations = [];
  const canonicalSource = fs.realpathSync(join(root, sourcePath));
  const readFile = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (path, ...args) => {
    assert.equal(path, canonicalSource, 'only the selected artifact supplies declaration metadata');
    declarations.push(path);
    return readFile(path, ...args);
  });
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', (path, flags, ...args) => {
    assert.equal(path, canonicalSource);
    assert.equal(flags, 'r');
    return open(path, flags, ...args);
  });
  for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'unlinkSync']) {
    t.mock.method(fs, name, () => {
      operations.push(name);
      throw new Error('Forbidden content or write operation');
    });
  }
  for (const name of [
    'spawn',
    'spawnSync',
    'exec',
    'execSync',
    'execFile',
    'execFileSync',
    'fork',
  ]) {
    t.mock.method(childProcess.default, name, () => {
      operations.push(name);
      throw new Error('Forbidden process operation');
    });
  }
  syncBuiltinESMExports();
  try {
    for (const file of ['src/hello #?.ts', 'src/internal.ts', sourcePath]) {
      const response = await request(file);
      assert.equal(response.status, 200);
      assert.equal(response.headers['cache-control'], 'no-store');
      const current = dashboard.planning.cursor();
      const value = assertPlanningFileLinkEnvelope(response.json, {
        binding: {
          actorId,
          projectId,
          scopeId: 'planning',
          domainId: 'planning',
          domainVersion: '1.0.0',
          generation: 3,
        },
        cursor: current,
        nodeId,
        path: file,
      });
      assert.equal(value.state, 'available');
      assert.equal(value.reason, null);
      assert.equal(value.path, file);
      assert.ok(value.editorUrl.startsWith('vscode://file/'));
      assert.equal(new URL(value.editorUrl).search, '');
      assert.equal(new URL(value.editorUrl).hash, '');
      assert.equal(Object.hasOwn(value, 'projectRoot'), false);
      assert.ok(Buffer.byteLength(response.body) <= 16 * 1024);
    }
    for (const file of ['src/external.ts', 'src/external-dir/missing.ts']) {
      const result = await request(file);
      assertSafeRefusal(result, root, outside);
      assert.match(result.json.reason, /outside/u);
    }
    for (const file of [
      'src/missing.ts',
      'src/missing-parent/file.ts',
      'src/dangling.ts',
      'src/directory',
    ]) {
      const result = await request(file);
      assertSafeRefusal(result, root, outside);
      assert.equal(result.json.path, file);
    }
    assert.deepEqual(operations, []);
    assert.equal(declarations.length, 9);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('file links reject unsafe, unlisted, foreign and stale inputs through the registered route', async (t) => {
  const { root, outside, dashboard, request } = fixture(t);
  await request('', { detail: true });
  for (const file of [
    '../secret.ts',
    'src/../unlisted.ts',
    'src/./hello.ts',
    '/etc/passwd',
    '//server/share',
    'C:/Windows/win.ini',
    'C:\\Windows\\win.ini',
    'src\\hello.ts',
    '%2e%2e/secret.ts',
    '..%2fsecret.ts',
    '%252e%252e%252fsecret.ts',
    'src%5cexternal.ts',
    'src/unlisted.ts',
    'src/not-declared.ts',
    'a'.repeat(1025),
    'src/hello\0.ts',
    '',
  ]) {
    const result = await request(file);
    assert.equal(result.status, 200, file);
    assertSafeRefusal(result, root, outside);
    assert.equal(result.json.path, null, file);
  }
  for (const options of [
    { actor: 'foreign-owner' },
    { params: { projectId: `sha256:${'b'.repeat(64)}` } },
    { params: { scopeId: 'foreign' } },
    { params: { generation: '-1' } },
    { params: { extra: 'ignored' } },
    { append: ['file', 'src/unlisted.ts'] },
    { append: ['sourceViewHash', dashboard.planning.cursor().viewHash] },
    { params: { sourceViewHash: `sha256:${'b'.repeat(64)}` } },
    { subject: encodeURIComponent('SPEC-002/T-001') },
    { subject: 'SPEC-001/T-001' },
    { subject: '%ZZ' },
  ]) {
    const result = await request('src/hello #?.ts', options);
    assert.ok(result.status >= 400);
    assertSafeRefusal(result, root, outside);
  }
  const response = await request('src/hello #?.ts');
  const expected = { binding: response.json.binding, cursor: response.json.cursor, nodeId };
  for (const mutation of [
    { projectRoot: root },
    { sourceViewHash: `sha256:${'b'.repeat(64)}` },
    { nodeId: 'SPEC-002/T-001' },
    { reason: 'invented success' },
    { errorCode: 'EACCES' },
    { state: 'error', reason: 'Failure', editorUrl: null, errorCode: 'PRIVATE_ERROR' },
    { editorUrl: 'vscode://file/tmp/../secret' },
    { editorUrl: 'https://example.com' },
    { editorUrl: `${response.json.editorUrl}?command=run` },
    { path: '../secret' },
    { binding: { ...response.json.binding, actorId: 'foreign-owner' } },
    {
      cursor: {
        ...response.json.cursor,
        eventHead: { sequence: 1, hash: `sha256:${'b'.repeat(64)}` },
      },
    },
  ]) {
    assert.throws(() =>
      assertPlanningFileLinkEnvelope({ ...response.json, ...mutation }, expected),
    );
  }
});

test('file links load declarations on demand and reject mismatched graph revisions', async (t) => {
  const { dashboard, request } = fixture(t);
  assert.equal((await request('src/hello #?.ts')).json.state, 'available');
  const node = dashboard.planning.ensureGraph().nodes[0];
  const prepared = dashboard.planning.preparePatch({
    updated: [{ ...node, title: 'New title' }],
    added: [],
    removed: [],
    edges: { added: [], removed: [] },
  });
  dashboard.planning.commitPatch(prepared);
  assert.equal((await request('src/hello #?.ts')).status, 409);
  assert.equal((await request('', { detail: true })).status, 409);
});

test('only visible file declarations inside the Files section grant access', () => {
  const node = {
    body: [
      '## Files',
      '### Modify',
      '- `src/allowed.ts`',
      '    - src/indented.ts',
      '<!--',
      '- src/comment.ts',
      '-->',
      '```md',
      '- src/fenced.ts',
      '```',
      'Other section',
      '=============',
      '- src/outside.ts',
      '<!--',
      '## Files',
      '- src/hidden-section.ts',
      '-->',
    ].join('\n'),
  };
  assert.deepEqual([...declaredPlanningFiles(node)], ['src/allowed.ts']);
});

test('file-link checks the exact final canonical target after a concurrent symlink change', (t) => {
  const { root, outside } = fixture(t);
  const realpath = fs.realpathSync;
  let reads = 0;
  t.mock.method(fs, 'realpathSync', (path) => {
    reads += 1;
    return reads === 4 ? join(outside, 'secret.ts') : realpath(path);
  });
  syncBuiltinESMExports();
  try {
    const result = resolvePlanningFileLink(root, 'src/hello #?.ts');
    assert.equal(result.state, 'unavailable');
    assert.equal(result.editorUrl, null);
    assert.match(result.reason, /outside/u);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('a cold file-link GET never initializes content readers or subprocesses', async (t) => {
  const { request } = fixture(t);
  const operations = [];
  t.mock.method(fs, 'readFileSync', () => {
    operations.push('read');
    throw new Error('Forbidden content read');
  });
  t.mock.method(childProcess.default, 'spawnSync', () => {
    operations.push('spawn');
    throw new Error('Forbidden subprocess');
  });
  syncBuiltinESMExports();
  try {
    const result = await request('src/hello #?.ts', { sourceViewHash: `sha256:${'a'.repeat(64)}` });
    assert.equal(result.status, 409);
    assert.deepEqual(operations, []);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('file-link bindings remain exact without a shared detail cache between readers', async (t) => {
  const { request } = fixture(t);
  const initial = await request('src/hello #?.ts');
  const next = await request('src/hello #?.ts', { params: { generation: '4' } });
  assert.equal(next.json.state, 'available');
  assert.equal(next.json.binding.generation, 4);
  assert.throws(() =>
    assertPlanningFileLinkEnvelope(next.json, {
      binding: initial.json.binding,
      cursor: initial.json.cursor,
      nodeId,
    }),
  );
});

test('file-link GET sees body-only declaration changes without a graph or detail refresh', async (t) => {
  const { root, dashboard, request } = fixture(t);
  await request('', { detail: true });
  const cursor = dashboard.planning.cursor();
  const source = join(root, sourcePath);
  fs.writeFileSync(
    source,
    fs.readFileSync(source, 'utf8').replace('- `src/hello #?.ts`', '- `src/unlisted.ts`'),
  );
  assert.deepEqual(dashboard.planning.cursor(), cursor);
  assert.equal((await request('src/hello #?.ts')).json.state, 'unavailable');
  assert.equal((await request('src/unlisted.ts')).json.state, 'available');
});

test('metadata read errors expose only a bounded error with manual-copy path', async (t) => {
  const { root, outside, request } = fixture(t);
  await request('', { detail: true });
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (path, ...args) => {
    if (path.endsWith('/src/hello #?.ts'))
      throw Object.assign(new Error(`private failure ${outside}`), { code: 'EACCES' });
    return lstat(path, ...args);
  });
  syncBuiltinESMExports();
  try {
    const result = await request('src/hello #?.ts');
    assert.equal(result.status, 200);
    assert.equal(result.json.state, 'error');
    assert.equal(result.json.errorCode, 'EACCES');
    assert.equal(result.json.path, 'src/hello #?.ts');
    assertSafeRefusal(result, root, outside);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('raw HTML cannot turn hidden bullets or headings into file declarations', () => {
  for (const body of [
    '## Files\n- src/allowed.ts\n<div hidden>\n- src/hidden.ts\n</div>',
    '<div hidden>\n## Files\n- src/hidden.ts\n</div>',
    '## Files\n- src/allowed.ts\n<script>\n\n## Files\n- src/hidden.ts\n</script>',
  ]) {
    const files = declaredPlanningFiles({ body });
    assert.equal(files.has('src/hidden.ts'), false);
  }
});

test('graph and detail reads perform no filesystem stat or realpath for file links', (t) => {
  const { root } = fixture(t);
  const planrDir = join(root, '.planr');
  readGraph(planrDir);
  const stats = [];
  const stat = fs.statSync;
  t.mock.method(fs, 'statSync', (path, ...args) => {
    stats.push(path);
    assert.equal(
      path,
      planrDir,
      'only the native artifact directory check belongs to graph/detail reads',
    );
    return stat(path, ...args);
  });
  for (const name of ['lstatSync', 'realpathSync']) {
    t.mock.method(fs, name, () =>
      assert.fail(`${name} must remain lazy until a file-link request`),
    );
  }
  syncBuiltinESMExports();
  try {
    const planning = createPlanningState({ planrDir, getGraph: () => readGraph(planrDir) });
    assert.equal(planning.ensureGraph().nodes[0].id, nodeId);
    assert.equal(planning.readNode(nodeId).id, nodeId);
    planning.readFreshGraph();
    planning.ensureGraph();
    assert.deepEqual(stats, [planrDir, planrDir, planrDir]);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('filesystem diagnostics preserve known codes and never echo arbitrary error data', (t) => {
  const { root, outside } = fixture(t);
  for (const [code, expected] of [
    ['EACCES', 'EACCES'],
    ['EIO', 'EIO'],
    [outside, 'UNKNOWN'],
  ]) {
    t.mock.method(fs, 'realpathSync', () => {
      throw Object.assign(new Error(`private error ${outside}`), { code });
    });
    syncBuiltinESMExports();
    try {
      assert.deepEqual(resolvePlanningFileLink(root, 'src/hello #?.ts'), {
        state: 'error',
        reason: 'The declared file could not be checked.',
        errorCode: expected,
        editorUrl: null,
      });
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
  }
});

test('canonical frontmatter source identity wins over filename lookalikes and duplicate summaries', async (t) => {
  const { root, request } = fixture(t);
  const alias = '.planr/specs/SPEC-001-example/tasks/T-000-alias.md';
  fs.writeFileSync(join(root, alias), fs.readFileSync(join(root, sourcePath)));
  fs.writeFileSync(
    join(root, sourcePath),
    fs
      .readFileSync(join(root, sourcePath), 'utf8')
      .replace('- `src/hello #?.ts`', '- `src/unlisted.ts`'),
  );
  await request('', { detail: true });
  assert.equal((await request('src/unlisted.ts')).json.state, 'unavailable');
  assert.equal((await request('src/hello #?.ts')).json.state, 'available');
  assert.equal((await request(alias)).json.state, 'available');
  assert.equal((await request(sourcePath)).json.state, 'unavailable');
});

test('selected-source read failures retain safe diagnostics without opening target bodies', async (t) => {
  const { root, outside, request } = fixture(t);
  await request('', { detail: true });
  const source = fs.realpathSync(join(root, sourcePath));
  t.mock.method(fs, 'readFileSync', (path) => {
    assert.equal(path, source);
    throw Object.assign(new Error(`private source failure ${outside}`), { code: 'EACCES' });
  });
  syncBuiltinESMExports();
  try {
    const result = await request('src/hello #?.ts');
    assert.equal(result.json.state, 'error');
    assert.equal(result.json.errorCode, 'EACCES');
    assert.equal(result.json.path, null);
    assertSafeRefusal(result, root, outside);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
