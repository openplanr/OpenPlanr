import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { acquireStartLock } from '@openplanr/artifact/internal/server-util.mjs';
import { atomicJson, currentDesign, renderDesignDocument } from '../lib/design/document.mjs';
import { designUtility, readDesignViewContext } from '../lib/design/utility.mjs';
import { saveDesignViewContext, validateDesignViewContext } from '../lib/design/view-context.mjs';
import { designFixture } from './design-fixture.mjs';
import { fetch, startDesignReview } from './studio-http-fixture.mjs';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'planr-view-context-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { file } = designFixture(root, {
    count: 2,
    frames: [{ id: 'desktop', label: 'Desktop', width: 600, height: 450 }],
  });
  await renderDesignDocument(file);
  const current = currentDesign(file);
  const boards = current.entries.map(({ screenId, frameId, variantId }) => ({
    screenId,
    frameId,
    variantId,
  }));
  const input = {
    revision: current.revision,
    view: 'canvas',
    visibleScreens: boards,
    selected: { ...boards[0], planrId: 'action-1' },
    dirty: false,
  };
  return { root, file, current, input, path: join(root, '.design/view-context.json') };
}

async function server(t, f) {
  const session = await startDesignReview(f.file, {
    env: { ...process.env, PLANR_HOME: join(f.root, 'home') },
    port: 0,
  });
  t.after(() => session.close());
  const url = `${session.url}api/design-view-context`;
  const headers = {
    'content-type': 'application/json',
    'x-openplanr-design': '1',
    origin: new URL(session.url).origin,
  };
  return {
    url,
    headers,
    put: (input, options = {}) =>
      fetch(url, { method: 'PUT', headers, body: JSON.stringify(input), ...options }),
  };
}

test('view context saves use the supplied clock and reject stale writes without overwriting', async (t) => {
  const f = await fixture(t);
  const updatedAt = '2026-10-20T10:00:00.000Z';
  const clock = () => new Date(updatedAt);
  assert.deepEqual(saveDesignViewContext(f.file, f.input, clock), { ok: true });
  assert.deepEqual(JSON.parse(readFileSync(f.path, 'utf8')), {
    kind: 'openplanr-design-view-context',
    schemaVersion: '1.0.0',
    ...f.input,
    updatedAt,
  });
  assert.equal(currentDesign(f.file).revision, f.current.revision);
  const before = readFileSync(f.path, 'utf8');
  assert.throws(
    () => saveDesignViewContext(f.file, { ...f.input, revision: 'stale-revision' }, clock),
    (error) => error.statusCode === 409,
  );
  assert.equal(readFileSync(f.path, 'utf8'), before);
});

test('studio view context persists viewer selection without changing the design revision', async (t) => {
  const f = await fixture(t);
  const s = await server(t, f);
  for (const view of ['canvas', 'prototype', 'walkthrough']) {
    const input = { ...f.input, view, dirty: view !== 'canvas' };
    const before = Date.now();
    const response = await s.put(input);
    assert.equal(response.status, 200, await response.text());
    const saved = JSON.parse(readFileSync(f.path, 'utf8'));
    assert.deepEqual(saved, {
      kind: 'openplanr-design-view-context',
      schemaVersion: '1.0.0',
      ...input,
      updatedAt: saved.updatedAt,
    });
    assert.ok(Date.parse(saved.updatedAt) >= before);
    assert.ok(Date.parse(saved.updatedAt) <= Date.now());
    assert.equal(currentDesign(f.file).revision, f.current.revision);
  }
  const response = await s.put({
    ...f.input,
    visibleScreens: [],
    selected: { ...f.input.selected, planrId: null },
  });
  assert.equal(response.status, 200, await response.text());
  assert.deepEqual(JSON.parse(readFileSync(f.path, 'utf8')).visibleScreens, []);
});

test('view context writes remain available while the design render lock is held', async (t) => {
  const f = await fixture(t);
  const s = await server(t, f);
  const release = await acquireStartLock(join(f.root, '.design/render.lock'));
  try {
    const response = await s.put(f.input);
    assert.equal(response.status, 200, await response.text());
    assert.deepEqual(JSON.parse(readFileSync(f.path, 'utf8')).selected, f.input.selected);
  } finally {
    release();
  }
});

test('view context validation checks the view, exact board identity, anchor length and revision', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(validateDesignViewContext(f.input, f.current), f.input);
  for (const input of [
    { ...f.input, view: 'unknown' },
    { ...f.input, selected: { ...f.input.selected, screenId: 'unknown' } },
    { ...f.input, selected: { ...f.input.selected, frameId: 'unknown' } },
    { ...f.input, selected: { ...f.input.selected, variantId: 'unknown' } },
    { ...f.input, selected: { ...f.input.selected, planrId: 'x'.repeat(129) } },
    { ...f.input, selected: { ...f.input.selected, planrId: 'not an anchor' } },
    { ...f.input, visibleScreens: [...f.input.visibleScreens, f.input.visibleScreens[0]] },
  ])
    assert.throws(() => validateDesignViewContext(input, f.current), /view context/i);
  assert.throws(
    () => validateDesignViewContext({ ...f.input, revision: 'stale-revision' }, f.current),
    (error) => error.statusCode === 409 && /revision/i.test(error.message),
  );
});

test('view context rejects invalid views, exact board identities, anchors and shapes without overwriting', async (t) => {
  const f = await fixture(t);
  const s = await server(t, f);
  assert.equal((await s.put(f.input)).status, 200);
  const before = readFileSync(f.path, 'utf8');
  const invalid = [
    { ...f.input, view: 'unknown' },
    { ...f.input, selected: { ...f.input.selected, screenId: 'unknown' } },
    { ...f.input, selected: { ...f.input.selected, frameId: 'unknown' } },
    { ...f.input, selected: { ...f.input.selected, variantId: 'unknown' } },
    { ...f.input, selected: { ...f.input.selected, planrId: 'x'.repeat(129) } },
    { ...f.input, selected: { ...f.input.selected, planrId: 'not an anchor' } },
    { ...f.input, selected: { ...f.input.selected, planrId: 3 } },
    { ...f.input, selected: { ...f.input.selected, instructions: 'ignored' } },
    { ...f.input, visibleScreens: [{ ...f.input.visibleScreens[0], screenId: 'unknown' }] },
    { ...f.input, visibleScreens: [...f.input.visibleScreens, f.input.visibleScreens[0]] },
    { ...f.input, visibleScreens: [f.input.visibleScreens[0], f.input.visibleScreens[0]] },
    { ...f.input, visibleScreens: null },
    { ...f.input, dirty: 'false' },
    { ...f.input, instructions: 'ignored' },
  ];
  for (const input of invalid) {
    const response = await s.put(input);
    assert.equal(response.status, 400, `${JSON.stringify(input)}: ${await response.text()}`);
    assert.equal(readFileSync(f.path, 'utf8'), before);
  }
  const stale = await s.put({ ...f.input, revision: 'stale-revision' });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /revision|changed|stale/i);
  assert.equal(readFileSync(f.path, 'utf8'), before);
});

test('view context requires an owner session, same origin, JSON and the design header', async (t) => {
  const f = await fixture(t);
  const s = await server(t, f);
  const unauthenticated = await s.put(f.input, { credentials: 'omit' });
  assert.equal(unauthenticated.status, 404, await unauthenticated.text());
  assert.equal(existsSync(f.path), false);
  for (const options of [
    { headers: { ...s.headers, 'x-openplanr-design': '' } },
    { headers: { ...s.headers, 'content-type': 'text/plain' } },
    { headers: { ...s.headers, origin: 'https://outside.example' } },
    { headers: { ...s.headers, origin: 'null' } },
    { headers: { 'content-type': 'application/json', 'x-openplanr-design': '1' } },
  ]) {
    const response = await s.put(f.input, options);
    assert.equal(response.status, 403, await response.text());
    assert.equal(existsSync(f.path), false);
  }
  const oversized = await s.put({ ...f.input, padding: 'x'.repeat(128 * 1024) });
  assert.equal(oversized.status, 400);
  assert.deepEqual(await oversized.json(), {
    ok: false,
    error: 'Request body exceeds 131072 bytes.',
  });
  assert.equal(existsSync(f.path), false);
});

test('view context reader resolves the selected anchor and utility returns the same viewer data', async (t) => {
  const f = await fixture(t);
  const context = {
    kind: 'openplanr-design-view-context',
    schemaVersion: '1.0.0',
    ...f.input,
    updatedAt: new Date().toISOString(),
  };
  atomicJson(f.path, context);
  const result = readDesignViewContext(f.file, { requestTime: context.updatedAt });
  assert.deepEqual(result, context);
  assert.deepEqual(
    { screen: result.selected.screenId, planrId: result.selected.planrId },
    { screen: 'screen-1', planrId: 'action-1' },
    'a request for this button resolves to the selected anchor on its selected screen',
  );
  const output = [];
  assert.deepEqual(
    await designUtility(['view-context', f.file, '--json'], {
      stdout: (value) => output.push(value),
    }),
    context,
  );
  assert.deepEqual(output, [context]);
});

test('view context reader states why missing, stale, older and malformed viewer data is unusable', async (t) => {
  const f = await fixture(t);
  const missing = readDesignViewContext(f.file);
  assert.equal(missing.viewContext, null);
  assert.match(missing.reason, /missing|found|exist|ENOENT/i);
  const context = {
    kind: 'openplanr-design-view-context',
    schemaVersion: '1.0.0',
    ...f.input,
    updatedAt: '2026-10-20T10:00:00.000Z',
  };
  atomicJson(f.path, { ...context, revision: 'stale-revision' });
  const stale = readDesignViewContext(f.file);
  assert.equal(stale.viewContext, null);
  assert.match(stale.reason, /revision/i);
  atomicJson(f.path, context);
  const older = readDesignViewContext(f.file, { requestTime: '2026-10-20T10:00:00.001Z' });
  assert.equal(older.viewContext, null);
  assert.match(older.reason, /request|older/i);
  const output = [];
  const command = await designUtility(
    ['view-context', f.file, '--json', '--request-time', '2026-10-20T10:00:00.001Z'],
    { stdout: (value) => output.push(value) },
  );
  assert.deepEqual(command, older);
  assert.deepEqual(output, [older]);
  writeFileSync(f.path, '{invalid json');
  const malformed = readDesignViewContext(f.file);
  assert.equal(malformed.viewContext, null);
  assert.match(malformed.reason, /JSON|parse|invalid/i);
  atomicJson(f.path, { ...context, selected: { ...context.selected, screenId: 'unknown' } });
  const invalid = readDesignViewContext(f.file);
  assert.equal(invalid.viewContext, null);
  assert.match(invalid.reason, /screen|board|invalid/i);
});
