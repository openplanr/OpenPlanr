import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import { renderArtifactShellDocument } from '@openplanr/artifact/ui/shell.mjs';
import { mountArtifactStage } from '@openplanr/artifact/ui/stage.mjs';
import {
  createDesignStudioEntries,
  designStudioArtifactId,
  renderDesignStudio,
} from '../lib/design/studio.mjs';

const cliRequire = createRequire(new URL('../../cli/package.json', import.meta.url));
const { JSDOM } = cliRequire('jsdom');
const runtime = readFileSync(new URL('../templates/studio/studio.js', import.meta.url), 'utf8');

function moveBoard(app, key = 'ArrowRight') {
  app.stage
    .getPanel(app.entries[0].artifactId)
    .querySelector('[data-design-drag]')
    .dispatchEvent(new app.window.KeyboardEvent('keydown', { key, bubbles: true }));
}

function undoBoard(app, redo = false) {
  app.documentNode.body.dispatchEvent(
    new app.window.KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      shiftKey: redo,
      bubbles: true,
    }),
  );
}

test('layout failures retain Retry when view context also fails and persist pending moves', async (t) => {
  const data = fixture({ count: 1 });
  data.revision = 'initial';
  data.contentIdentity = 'authored';
  const app = await mount({
    data,
    options: {
      viewContextUrl: '/api/design-view-context',
      saveLayout: async () => {
        throw new Error('Offline layout');
      },
    },
    fetchImpl: async () => {
      throw new Error('Offline context');
    },
  });
  t.after(() => app.close());
  moveBoard(app);
  assert.doesNotMatch(
    app.documentNode.querySelector('[data-design-save-state]').textContent,
    /All changes saved/u,
  );
  await app.studio.flush();
  await delay(300);
  assert.match(
    app.documentNode.querySelector('[data-design-notice-message]').textContent,
    /Offline layout/u,
  );
  assert.ok(app.documentNode.querySelector('[data-design-retry-layout]'));
  const draft = JSON.parse(app.window.localStorage.getItem('openplanr.design-studio.fieldwork'));
  assert.equal(draft.pendingLayout.contentIdentity, 'authored');
  assert.deepEqual(draft.pendingLayout.operations, [
    {
      revision: 'initial',
      boards: { 'screen-1/desktop/editorial': { x: 8, y: 72 } },
    },
  ]);
  assert.doesNotMatch(
    app.documentNode.querySelector('[data-design-save-state]').textContent,
    /All changes saved/u,
  );
});

for (const foreign of [false, true]) {
  test(`stored layout moves ${foreign ? 'drop when authored content changes' : 'replay on the current revision before saved state'}`, async (t) => {
    const data = fixture({ count: 1 });
    data.revision = 'current';
    data.contentIdentity = foreign ? 'changed' : 'authored';
    const inputs = [];
    const app = await mount({
      data,
      stored: {
        pendingLayout: {
          contentIdentity: 'authored',
          operations: [
            {
              revision: 'old',
              boards: { 'screen-1/desktop/editorial': { x: 200, y: 300 } },
            },
          ],
        },
      },
      options: {
        saveLayout: async (input) => {
          inputs.push(input);
          return { revision: 'replayed' };
        },
      },
    });
    t.after(() => app.close());
    await delay(0);
    await app.studio.flush();
    if (foreign) {
      assert.equal(inputs.length, 0);
      assert.match(
        app.documentNode.querySelector('[data-design-notice-message]').textContent,
        /moves were dropped.*authored content changed/u,
      );
    } else {
      assert.equal(inputs.length, 1);
      assert.equal(inputs[0].revision, 'current');
      assert.equal(app.studio.getLayout().boards['screen-1/desktop/editorial'].x, 200);
      assert.equal(app.studio.getRevision(), 'replayed');
    }
    const draft = JSON.parse(app.window.localStorage.getItem('openplanr.design-studio.fieldwork'));
    assert.equal(draft.pendingLayout, undefined);
  });
}

test('a missing layout session keeps pending moves and offers Reload', async (t) => {
  const app = await mount({
    options: { layoutUrl: '/api/design-layout' },
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Session not found' }),
    }),
  });
  t.after(() => app.close());
  moveBoard(app);
  await app.studio.flush();
  assert.match(
    app.documentNode.querySelector('[data-design-notice-message]').textContent,
    /Studio restarted/u,
  );
  assert.ok(app.documentNode.querySelector('[data-design-reload-studio]'));
  assert.equal(app.studio.getSaveState().dirty, true);
});

test('migration readiness waits for the adopted layout revision', async (t) => {
  const data = fixture({ count: 1 });
  data.revision = 'initial';
  data.state = { positions: { [data.entries[0].artifactId]: { x: 100, y: 200 } } };
  let finish;
  const saved = new Promise((resolve) => {
    finish = resolve;
  });
  const ready = [];
  const app = await mount({
    data,
    options: { saveLayout: () => saved, onReady: (detail) => ready.push(detail) },
  });
  t.after(() => app.close());
  await delay(80);
  assert.equal(ready.length, 0, 'readiness cannot post the pre-migration revision');
  finish({ revision: 'migrated' });
  await app.studio.flush();
  await delay(80);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].revision, 'migrated');
  assert.equal(data.document.schemaVersion, '1.0.0');
});

for (const foreign of [false, true]) {
  test(`layout conflict ${foreign ? 'preserves foreign authored content' : 'rebases absolute moves'}`, async (t) => {
    const data = fixture({ count: 1 });
    data.revision = 'initial';
    data.contentIdentity = 'authored';
    const inputs = [];
    const app = await mount({
      data,
      options: {
        statusUrl: '/api/design-status',
        saveLayout: async (input) => {
          inputs.push(input);
          if (inputs.length === 1)
            throw Object.assign(new Error('Stale layout'), { conflict: true });
          return { revision: 'saved' };
        },
      },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          revision: 'concurrent',
          contentIdentity: foreign ? 'new-authored' : 'authored',
        }),
      }),
    });
    t.after(() => app.close());
    moveBoard(app);
    await app.studio.flush();
    if (foreign) {
      assert.match(
        app.documentNode.querySelector('[data-design-notice-message]').textContent,
        /new design revision is ready/i,
      );
      assert.equal(inputs.length, 1);
      await app.studio.flush();
      assert.equal(inputs.length, 1, 'foreign content blocks stale layout retries');
    } else {
      assert.equal(
        inputs.length,
        2,
        'the stale move is resent after fetching the current revision',
      );
      assert.equal(inputs[1].revision, 'concurrent');
      assert.deepEqual(inputs[1].boards, inputs[0].boards);
      assert.equal(app.studio.getRevision(), 'saved');
      assert.match(
        app.documentNode.querySelector('[data-design-notice-message]').textContent,
        /rebased/i,
      );
    }
  });
}

test('layout conflict drops stale restore operations and retains concurrent board positions', async (t) => {
  const data = fixture({ count: 1 });
  data.revision = 'initial';
  data.contentIdentity = 'authored';
  const key = 'screen-1/desktop/editorial';
  const concurrent = { x: 400, y: 500 };
  const inputs = [];
  const app = await mount({
    data,
    options: {
      statusUrl: '/api/design-status',
      saveLayout: async (input) => {
        inputs.push(input);
        if (Object.hasOwn(input, 'restoreRevision'))
          throw Object.assign(new Error('Stale restore'), { conflict: true });
        return { revision: 'moved' };
      },
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        revision: 'concurrent',
        contentIdentity: 'authored',
        layout: { boards: { [key]: concurrent } },
      }),
    }),
  });
  t.after(() => app.close());
  moveBoard(app);
  await app.studio.flush();
  undoBoard(app);
  await app.studio.flush();
  assert.equal(inputs.length, 2, 'a stale restore is not resent');
  assert.match(
    app.documentNode.querySelector('[data-design-notice-message]').textContent,
    /Stale undo and redo operations were dropped/u,
  );
  assert.equal(app.studio.getRevision(), 'concurrent');
  assert.equal(JSON.stringify(app.studio.getLayout().boards[key]), JSON.stringify(concurrent));
  assert.equal(app.studio.getSaveState().dirty, false);
});

for (const trigger of ['Retry', 'online']) {
  test(`layout network error retries through ${trigger}`, async (t) => {
    const inputs = [];
    const app = await mount({
      options: {
        saveLayout: async (input) => {
          inputs.push(input);
          if (inputs.length === 1) throw new Error('Network unavailable');
          return { revision: 'saved' };
        },
      },
    });
    t.after(() => app.close());
    moveBoard(app);
    await app.studio.flush();
    assert.match(
      app.documentNode.querySelector('[data-design-notice-message]').textContent,
      /Network unavailable/u,
    );
    const retry = app.documentNode.querySelector('[data-design-retry-layout]');
    assert.ok(retry && !retry.hidden, 'layout failure provides a Retry action');
    if (trigger === 'Retry') retry.click();
    else app.window.dispatchEvent(new app.window.Event('online'));
    await app.studio.flush();
    assert.equal(inputs.length, 2);
    assert.equal(app.studio.getSaveState().dirty, false);
  });
}

test('undo and redo of an unsaved move never restore a null revision', async (t) => {
  const inputs = [];
  let failing = true;
  const app = await mount({
    options: {
      saveLayout: async (input) => {
        inputs.push(input);
        if (failing) throw new Error('Offline');
        return { revision: 'saved' };
      },
    },
  });
  t.after(() => app.close());
  const original = app.studio.getLayout();
  moveBoard(app);
  await app.studio.flush();
  const moved = app.studio.getLayout();
  undoBoard(app);
  await delay(0);
  assert.deepEqual(app.studio.getLayout(), original);
  assert.equal(inputs.length, 1, 'undo rewrites the failed move locally');
  assert.equal(app.studio.getSaveState().dirty, true);
  failing = false;
  undoBoard(app, true);
  await app.studio.flush();
  assert.deepEqual(app.studio.getLayout(), moved);
  assert.equal(inputs.length, 2);
  assert.ok(inputs.every((input) => !Object.hasOwn(input, 'restoreRevision')));
});

test('portable legacy positions migrate only into session layout', async (t) => {
  const data = fixture({ count: 1 });
  const id = data.entries[0].artifactId;
  const stored = { state: { positions: { [id]: { x: 31.6, y: -42.3 } } } };
  const app = await mount({ data, stored });
  t.after(() => app.close());
  assert.equal(
    JSON.stringify(app.studio.getLayout().boards['screen-1/desktop/editorial']),
    JSON.stringify({ x: 32, y: -42 }),
  );
  assert.equal(Object.hasOwn(app.studio.getState(), 'positions'), false);
});

test('legacy server positions migrate before local positions and are removed only after saving', async (t) => {
  const data = fixture({ count: 1 });
  data.revision = 'initial';
  const keys = data.entries.map((entry) => `${entry.screenId}/${entry.frameId}/${entry.variantId}`);
  const ids = data.entries.map((entry) => entry.artifactId);
  data.document.layout = { boards: { [keys[2]]: { x: 50, y: 60, title: 'Authored' } } };
  const stored = {
    state: {
      positions: {
        [ids[0]]: { x: 999, y: 999 },
        [ids[1]]: { x: 20.2, y: 30.9 },
      },
    },
  };
  const inputs = [],
    personal = [];
  let fail = true;
  const options = {
    stateUrl: '/api/design-state',
    saveLayout: async (input) => {
      inputs.push(input);
      if (fail) throw new Error('Offline migration');
      return { revision: 'migrated' };
    },
    savePersonalState: async (state) => {
      personal.push(state);
      return { stateVersion: 2 };
    },
  };
  const app = await mount({
    data,
    stored,
    options,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        revision: 'initial',
        stateVersion: 1,
        state: { positions: { [ids[0]]: { x: 10.8, y: -5.2 }, [ids[2]]: { x: 0, y: 0 } } },
      }),
    }),
  });
  t.after(() => app.close());
  await delay(0);
  assert.equal(
    JSON.stringify(app.studio.getLayout().boards[keys[0]]),
    JSON.stringify({ x: 11, y: -5 }),
  );
  assert.equal(
    JSON.stringify(app.studio.getLayout().boards[keys[1]]),
    JSON.stringify({ x: 20, y: 31 }),
  );
  assert.equal(app.studio.getLayout().boards[keys[2]].title, 'Authored');
  assert.equal(inputs.length, 1);
  assert.deepEqual(Object.keys(inputs[0].boards), keys.slice(0, 2));
  const draft = () =>
    JSON.parse(app.window.localStorage.getItem('openplanr.design-studio.fieldwork'));
  assert.ok(draft().state.positions, 'a failed migration keeps legacy coordinates recoverable');
  app.studio.setPanels({ navOpen: false });
  await app.studio.flush();
  assert.ok(personal.at(-1).positions, 'personal saves keep coordinates until migration succeeds');
  const failedAttempts = inputs.length;
  fail = false;
  app.documentNode.querySelector('[data-design-retry-layout]').click();
  await app.studio.flush();
  await app.studio.flush();
  assert.equal(Object.hasOwn(draft().state, 'positions'), false);
  assert.equal(Object.hasOwn(personal.at(-1), 'positions'), false);
  data.document.layout = JSON.parse(JSON.stringify(app.studio.getLayout()));
  data.revision = 'migrated';
  const reloaded = await mount({
    data,
    stored: draft(),
    options,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ state: personal.at(-1), revision: 'migrated', stateVersion: 2 }),
    }),
  });
  t.after(() => reloaded.close());
  await reloaded.studio.flush();
  assert.equal(inputs.length, failedAttempts + 1, 'reload does not enqueue another migration');
});

test('undo while a move is saving retains an absolute correction for uncertain results', async (t) => {
  for (const succeeds of [false, true]) {
    const inputs = [];
    let finish;
    const pending = new Promise((resolve, reject) => {
      finish = succeeds ? resolve : reject;
    });
    const app = await mount({
      options: {
        saveLayout: async (input) => {
          inputs.push(input);
          if (inputs.length === 1) return pending;
          return { revision: 'restored' };
        },
      },
    });
    t.after(() => app.close());
    const original = JSON.stringify(app.studio.getLayout());
    moveBoard(app);
    await delay(0);
    undoBoard(app);
    finish(succeeds ? { revision: 'moved' } : new Error('Offline'));
    await delay(0);
    if (!succeeds) {
      assert.equal(app.studio.getSaveState().dirty, true);
      app.documentNode.querySelector('[data-design-retry-layout]').click();
    }
    await app.studio.flush();
    assert.equal(JSON.stringify(app.studio.getLayout()), original);
    assert.equal(inputs.length, 2);
    assert.equal(inputs[1].boards['screen-1/desktop/editorial'], null);
    assert.ok(inputs.every((input) => input.restoreRevision !== null));
    assert.equal(app.studio.getSaveState().dirty, false);
  }
});

test('startup migration preserves positions authored after the HTML response', async (t) => {
  const data = fixture({ count: 1 });
  data.revision = 'initial';
  data.contentIdentity = 'authored';
  const entry = data.entries[0];
  const key = `${entry.screenId}/${entry.frameId}/${entry.variantId}`;
  data.state = { positions: { [entry.artifactId]: { x: 10, y: 20 } } };
  const inputs = [];
  const app = await mount({
    data,
    options: {
      stateUrl: '/api/design-state',
      statusUrl: '/api/design-status',
      saveLayout: async (input) => {
        inputs.push(input);
        return { revision: 'saved' };
      },
      savePersonalState: async () => ({ stateVersion: 2 }),
    },
    fetchImpl: async (url) => ({
      ok: true,
      json: async () =>
        url.endsWith('design-state')
          ? { revision: 'concurrent', stateVersion: 1, state: data.state }
          : {
              revision: 'concurrent',
              contentIdentity: 'authored',
              layout: { boards: { [key]: { x: 90, y: 80 } } },
            },
    }),
  });
  t.after(() => app.close());
  await app.studio.flush();
  assert.equal(inputs.length, 0, 'startup reconciles layout before collecting missing exact keys');
  assert.equal(app.studio.getLayout().boards[key].x, 90);
});

test('undo reconciles a committed move whose response was lost', async (t) => {
  const data = fixture({ count: 1 });
  data.revision = 'initial';
  data.contentIdentity = 'authored';
  const key = 'screen-1/desktop/editorial';
  let serverPoint = null,
    rejectResponse;
  const lost = new Promise((_resolve, reject) => {
    rejectResponse = reject;
  });
  const inputs = [];
  const app = await mount({
    data,
    options: {
      statusUrl: '/api/design-status',
      saveLayout: async (input) => {
        inputs.push(input);
        if (inputs.length === 2)
          throw Object.assign(new Error('Committed revision changed'), { conflict: true });
        serverPoint = input.boards[key];
        if (inputs.length === 1) return lost;
        return { revision: 'reconciled' };
      },
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        revision: 'committed',
        contentIdentity: 'authored',
        layout: { boards: { [key]: serverPoint } },
      }),
    }),
  });
  t.after(() => app.close());
  moveBoard(app);
  await delay(0);
  undoBoard(app);
  rejectResponse(new Error('Response lost after commit'));
  await delay(0);
  assert.equal(
    app.studio.getSaveState().dirty,
    true,
    'an unknown save outcome keeps an absolute correction pending',
  );
  assert.equal(inputs.length, 1, 'undo itself stays local');
  app.documentNode.querySelector('[data-design-retry-layout]').click();
  await app.studio.flush();
  assert.equal(serverPoint, null);
  assert.equal(inputs.length, 3);
  assert.equal(app.studio.getSaveState().dirty, false);
});

test('live view context debounces changes, serializes requests and drains the latest unsaved state', async (t) => {
  const data = fixture({ count: 1 });
  data.revision = 'a'.repeat(64);
  const requests = [];
  let save;
  const saved = new Promise((resolve) => {
    save = resolve;
  });
  const app = await mount({
    data,
    options: { viewContextUrl: '/api/design-view-context', saveState: () => saved },
    fetchImpl: (url, init) => new Promise((resolve) => requests.push({ url, init, resolve })),
  });
  t.after(() => app.close());
  const scroll = app.documentNode.querySelector('.planr-stage-scroll');
  Object.defineProperties(scroll, { clientWidth: { value: 600 }, clientHeight: { value: 500 } });
  app.studio.setCamera({ x: 0, y: 0, zoom: 1 });
  const waitForRequests = async (count) => {
    for (let i = 0; i < 100 && requests.length < count; i++) await delay(10);
    assert.equal(requests.length, count);
  };
  await delay(100);
  app.studio.setCamera({ x: -10000, y: 0, zoom: 1 });
  await delay(180);
  assert.equal(requests.length, 0, 'the trailing debounce restarts after a visibility change');
  await waitForRequests(1);
  assert.deepEqual(JSON.parse(requests[0].init.body).visibleScreens, []);
  assert.equal(requests[0].init.method, 'PUT');
  assert.equal(requests[0].init.headers['x-openplanr-design'], '1');
  app.studio.setView('prototype');
  app.studio.setView('walkthrough');
  app.documentNode.querySelector('[data-design-rating="4"]').click();
  await delay(280);
  assert.equal(requests.length, 1, 'only one context request can be in flight');
  const respond = (index) =>
    requests[index].resolve({ ok: true, json: async () => ({ ok: true }) });
  respond(0);
  await waitForRequests(2);
  const latest = JSON.parse(requests[1].init.body);
  assert.equal(latest.view, 'walkthrough');
  assert.equal(latest.dirty, true);
  assert.deepEqual(latest.visibleScreens, [
    { screenId: 'screen-1', frameId: 'desktop', variantId: 'editorial' },
  ]);
  assert.deepEqual(latest.selected, { ...latest.visibleScreens[0], planrId: null });
  respond(1);
  save({ revision: data.revision });
  await app.studio.flush();
  await waitForRequests(3);
  assert.equal(JSON.parse(requests[2].init.body).dirty, false);
  respond(2);
});

for (const conflictAfterAdoption of [false, true]) {
  test(`view context retries a layout revision conflict received ${conflictAfterAdoption ? 'after' : 'before'} revision adoption`, async (t) => {
    const data = fixture({ count: 1 });
    data.revision = 'initial';
    const requests = [];
    let saveLayout;
    const layoutSaved = new Promise((resolve) => {
      saveLayout = resolve;
    });
    const app = await mount({
      data,
      options: {
        viewContextUrl: '/api/design-view-context',
        saveLayout: () => layoutSaved,
      },
      fetchImpl: (_url, init) =>
        new Promise((resolve) => requests.push({ input: JSON.parse(init.body), resolve })),
    });
    t.after(() => app.close());
    const waitForRequests = async (count) => {
      for (let i = 0; i < 100 && requests.length < count; i++) await delay(10);
      assert.equal(requests.length, count);
    };
    await waitForRequests(1);
    requests[0].resolve({ ok: true, json: async () => ({ ok: true }) });
    const panel = app.stage.getPanel(app.entries[0].artifactId);
    const handle = panel.querySelector('[data-design-drag]');
    const scroll = app.documentNode.querySelector('.planr-stage-scroll');
    for (const [target, type, x] of [
      [handle, 'pointerdown', 100],
      [scroll, 'pointermove', 140],
      [scroll, 'pointerup', 140],
    ])
      target.dispatchEvent(
        new app.window.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 100 }),
      );
    await waitForRequests(2);
    assert.equal(requests[1].input.revision, 'initial');
    assert.equal(requests[1].input.dirty, true);
    if (conflictAfterAdoption) {
      saveLayout({ revision: 'moved' });
      await app.studio.flush();
    }
    requests[1].resolve({
      ok: false,
      status: 409,
      json: async () => ({ error: 'The design revision changed.' }),
    });
    await delay(0);
    if (!conflictAfterAdoption) {
      app.studio.setView('prototype');
      await delay(300);
      assert.equal(requests.length, 2, 'a conflicting revision is not retried before adoption');
      saveLayout({ revision: 'moved' });
      await app.studio.flush();
    }
    await waitForRequests(3);
    assert.equal(requests[2].input.revision, 'moved');
    assert.equal(requests[2].input.dirty, false);
    assert.doesNotMatch(
      app.documentNode.querySelector('[data-design-notice-message]').textContent,
      /View context could not/u,
    );
    requests[2].resolve({ ok: true, json: async () => ({ ok: true }) });
  });
}

test('view context failures show a temporary notice and retry on the next camera change', async (t) => {
  const requests = [];
  const app = await mount({
    options: { viewContextUrl: '/api/design-view-context' },
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return { ok: requests.length > 1, status: 503, json: async () => ({ error: 'Unavailable' }) };
    },
  });
  t.after(() => app.close());
  const setTimeout = app.window.setTimeout.bind(app.window);
  let dismiss;
  app.window.setTimeout = (callback, ms, ...args) => {
    if (ms === 6000) dismiss = callback;
    return setTimeout(callback, ms, ...args);
  };
  await delay(300);
  assert.equal(requests.length, 1);
  assert.match(
    app.documentNode.querySelector('[data-design-notice-message]').textContent,
    /Unavailable/u,
  );
  assert.equal(typeof dismiss, 'function');
  dismiss();
  assert.equal(app.documentNode.querySelector('.design-notice').hidden, true);
  const { camera, zoom } = app.studio.getState();
  app.studio.setCamera({ ...camera, zoom });
  await delay(300);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
});

test('portable studios do not post live view context', async (t) => {
  const requests = [];
  const app = await mount({ fetchImpl: (url) => requests.push(url) });
  t.after(() => app.close());
  app.studio.setView('prototype');
  app.studio.setView('canvas');
  app.studio.setCamera({ x: -10000, y: 0, zoom: 1 });
  await delay(300);
  assert.deepEqual(requests, []);
});

test('live view context uses measured auto heights and the public inspection event', async (t) => {
  const data = fixture({ count: 1 });
  data.document.frames[0].height = 'auto';
  const contexts = [];
  const app = await mount({
    data,
    options: { viewContextUrl: '/api/design-view-context' },
    fetchImpl: async (_url, init) => {
      contexts.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  t.after(() => app.close());
  const scroll = app.documentNode.querySelector('.planr-stage-scroll');
  Object.defineProperties(scroll, { clientWidth: { value: 600 }, clientHeight: { value: 500 } });
  app.studio.setCamera({ x: 0, y: -1000, zoom: 1 });
  await delay(300);
  assert.deepEqual(contexts.at(-1).visibleScreens, []);
  const selected = {
    screenId: 'screen-1',
    frameId: 'desktop',
    variantId: 'editorial',
    planrId: 'main',
  };
  const active = data.entries.find(
    (entry) =>
      entry.screenId === selected.screenId &&
      entry.frameId === selected.frameId &&
      entry.variantId === selected.variantId,
  );
  app.window.dispatchEvent(
    new app.window.MessageEvent('message', {
      origin: 'null',
      source: app.stage.getFrame(active.artifactId).contentWindow,
      data: {
        type: 'openplanr:design-size',
        screenId: selected.screenId,
        width: 1280,
        height: 2400,
      },
    }),
  );
  app.documentNode
    .querySelector('.planr-shell')
    .dispatchEvent(
      new app.window.CustomEvent('planr:design-inspection-change', { detail: selected }),
    );
  await delay(300);
  assert.deepEqual(contexts.at(-1).selected, selected);
  assert.deepEqual(contexts.at(-1).visibleScreens, [
    { screenId: 'screen-1', frameId: 'desktop', variantId: 'editorial' },
  ]);
});

function fixture({ count = 3, title = 'Fieldwork operations' } = {}) {
  const document = {
    kind: 'openplanr-design-document',
    schemaVersion: '1.0.0',
    id: 'fieldwork',
    title,
    brief: {
      text: 'Schedule field crews and review the delivery.',
      source: 'describe',
      provenance: 'inferred',
    },
    frames: [
      { id: 'desktop', label: 'Desktop', width: 1280, height: 800 },
      { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
    ],
    screens: Array.from({ length: count }, (_, index) => ({
      id: `screen-${index + 1}`,
      title: `Screen ${index + 1}`,
      description: `Journey step ${index + 1}.`,
      source: { html: `screens/screen-${index + 1}.html` },
    })),
    screenOrder: Array.from({ length: count }, (_, index) => `screen-${index + 1}`),
    variants: [
      { id: 'editorial', label: 'Editorial', status: 'ready' },
      { id: 'compact', label: 'Compact', status: 'ready' },
      {
        id: 'unfinished',
        label: 'Unfinished',
        status: 'failed',
        issue: 'Generation interrupted.',
      },
    ],
    selectedVariant: 'editorial',
    defaultView: 'canvas',
  };
  const artifacts = document.variants
    .filter(({ status }) => status === 'ready')
    .flatMap((variant) =>
      document.screens.flatMap((screen) =>
        document.frames.map((frame) => ({
          id: designStudioArtifactId(variant.id, screen.id, frame.id),
          title: `${screen.title} / ${variant.label} / ${frame.label}`,
          html: `<!doctype html><html><body><main data-planr-id="main"><h1>${screen.title}</h1><button>Primary action</button></main></body></html>`,
          viewport: { width: frame.width, height: frame.height },
        })),
      ),
    );
  const envelope = createArtifactEnvelope({
    artifacts,
    viewer: { mode: 'variants', presentation: 'canvas' },
  });
  const entries = createDesignStudioEntries(document, envelope);
  return { document, envelope, entries };
}

async function mount({
  data = fixture(),
  options = {},
  stored = null,
  experience = false,
  hash = '',
  stageOptions = {},
  fetchImpl,
} = {}) {
  const html = renderDesignStudio(data);
  const dom = new JSDOM(html, {
    url: `http://127.0.0.1/review/studio/${hash}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.TextDecoder = TextDecoder;
  if (fetchImpl) window.fetch = fetchImpl;
  window.Blob = Blob;
  window.URL.createObjectURL = () => `blob:http://127.0.0.1/${Math.random()}`;
  window.URL.revokeObjectURL = () => {};
  window.HTMLElement.prototype.scrollTo = function (value) {
    this.scrollLeft = value.left ?? this.scrollLeft;
    this.scrollTop = value.top ?? this.scrollTop;
  };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.structuredClone = structuredClone;
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  if (stored)
    window.localStorage.setItem(
      `openplanr.design-studio.${data.document.id}`,
      JSON.stringify(stored),
    );
  window.__OPENPLANR_DESIGN_STUDIO_OPTIONS__ = options;
  const stage = mountArtifactStage({
    document: window.document,
    window,
    frameBudget: null,
    async resolveArtifactSource(artifact, { frame }) {
      setTimeout(() => frame.dispatchEvent(new window.Event('load')), 0);
      return data.envelope.artifacts.find(({ id }) => id === artifact.id).html;
    },
    ...stageOptions,
  });
  window.eval(runtime);
  await stage.ready;
  if (!stage.frameBudget) await stage.ensureFrames(data.entries.map((entry) => entry.artifactId));
  for (let index = 0; index < 20 && !window.__openPlanrDesignStudio; index += 1) await delay(10);
  assert.ok(window.__openPlanrDesignStudio, 'studio boots after artifact stage');
  if (experience) await delay(20);
  return {
    ...data,
    window,
    documentNode: window.document,
    stage,
    studio: window.__openPlanrDesignStudio,
    close() {
      window.__openPlanrDesignStudio.destroy();
      stage.destroy();
      window.close();
    },
  };
}

for (const transition of [
  'normal',
  'canceled navigation',
  'persisted return',
  'queued canceled navigation',
]) {
  test(`background frame demand respects ${transition} without retiring ready state`, {
    timeout: 5000,
  }, async (t) => {
    const data = fixture();
    const sources = [];
    const app = await mount({
      data,
      stageOptions: {
        frameBudget: 3,
        resolveArtifactSource(artifact, { frame }) {
          sources.push(artifact.id);
          setTimeout(
            () => frame.dispatchEvent(new frame.ownerDocument.defaultView.Event('load')),
            0,
          );
          return data.envelope.artifacts.find(({ id }) => id === artifact.id).html;
        },
      },
    });
    const { window, documentNode: document, stage, studio } = app;
    const root = document.querySelector('.planr-shell');
    const scheduleTimeout = window.setTimeout.bind(window);
    const cancelTimeout = window.clearTimeout.bind(window);
    const demands = new Map();
    let timerId = 1_000_000;
    t.after(() => {
      app.close();
      window.setTimeout = scheduleTimeout;
      window.clearTimeout = cancelTimeout;
    });
    if (root.dataset.designReady !== 'true')
      await new Promise((resolve) => {
        const observer = new window.MutationObserver(() => {
          if (root.dataset.designReady === 'true') {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(root, { attributes: true, attributeFilter: ['data-design-ready'] });
      });
    const activeId = stage.getState().activeArtifactId;
    const readyFrame = stage.getFrame(activeId);
    const readyWindow = readyFrame.contentWindow;
    const readySource = readyFrame.src;
    const camera = studio.getState().camera;
    const laterId = designStudioArtifactId('editorial', 'screen-2', 'desktop');
    assert.equal(sources.includes(laterId), false);
    const box = { left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500 };
    document.querySelector('.planr-stage-scroll').getBoundingClientRect = () => box;
    for (const entry of data.entries)
      stage.getPanel(entry.artifactId).getBoundingClientRect = () =>
        entry.artifactId === laterId ? box : { ...box, left: 10000, right: 10500 };
    window.setTimeout = (callback, ms, ...args) => {
      if (ms !== 120) return scheduleTimeout(callback, ms, ...args);
      const id = ++timerId;
      demands.set(id, () => callback(...args));
      return id;
    };
    window.clearTimeout = (id) => {
      if (!demands.delete(id)) cancelTimeout(id);
    };
    const runDemand = () => {
      const scheduled = [...demands.values()];
      demands.clear();
      for (const callback of scheduled) callback();
    };
    window.dispatchEvent(new window.Event('resize'));
    assert.ok(demands.size > 0, 'Normal geometry schedules background demand');
    if (transition !== 'normal') {
      const before = [...sources];
      if (transition === 'queued canceled navigation') runDemand();
      window.dispatchEvent(new window.Event('beforeunload', { cancelable: true }));
      runDemand();
      await delay(0);
      assert.deepEqual(sources, before, 'The scheduled source cannot start after beforeunload');
      if (transition === 'persisted return') {
        window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: true }));
        window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
      }
      assert.equal(window.__openPlanrDesignStudio, studio);
      assert.equal(stage.getFrame(activeId), readyFrame);
      assert.equal(readyFrame.contentWindow, readyWindow);
      assert.equal(readyFrame.src, readySource);
      assert.deepEqual(studio.getState().camera, camera);
      assert.equal(root.dataset.designReady, 'true');
      // Staying in the document or returning from cache still allows a normal
      // viewport change to demand an unloaded source using the same owners.
      window.dispatchEvent(new window.Event('resize'));
    }
    const ready = new Promise((resolve) =>
      window.addEventListener('planr:artifact-frame-state', function loaded(event) {
        if (event.detail.artifactId === laterId && event.detail.status === 'ready') {
          window.removeEventListener('planr:artifact-frame-state', loaded);
          resolve();
        }
      }),
    );
    runDemand();
    await ready;
    assert.ok(sources.includes(laterId), 'Later viewport demand resolves the real unloaded source');
    assert.equal(stage.getFrame(activeId), readyFrame);
    assert.equal(readyFrame.contentWindow, readyWindow);
    assert.equal(stage.getState().status, 'ready');
  });
}

test('rapid screen, frame, direction and step choices retain the pending identity during real frame loading', {
  timeout: 30_000,
}, async () => {
  const data = fixture({ count: 5 });
  data.document.defaultView = 'walkthrough';
  let hold = false;
  const queued = [],
    waiters = [],
    gates = [];
  const nextSource = () =>
    queued.length
      ? Promise.resolve(queued.shift())
      : new Promise((resolve) => waiters.push(resolve));
  const f = await mount({
    data,
    stageOptions: {
      frameBudget: 3,
      resolveArtifactSource(artifact, { frame }) {
        const html = data.envelope.artifacts.find(({ id }) => id === artifact.id).html;
        const release = (resolve) => {
          const window = frame.ownerDocument.defaultView;
          setTimeout(() => frame.dispatchEvent(new window.Event('load')), 0);
          resolve(html);
        };
        if (!hold) return new Promise(release);
        return new Promise((resolve) => {
          let released = false;
          const gate = {
            artifactId: artifact.id,
            release() {
              if (released) return;
              released = true;
              release(resolve);
            },
            loaded: new Promise((resolve) =>
              frame.addEventListener('load', resolve, { once: true }),
            ),
          };
          gates.push(gate);
          if (waiters.length) waiters.shift()(gate);
          else queued.push(gate);
        });
      },
    },
  });
  try {
    hold = true;
    const { documentNode: document, window, studio } = f;
    document.querySelector('[data-design-screen="screen-2"]').click();
    const first = await nextSource();
    assert.equal(first.artifactId, designStudioArtifactId('editorial', 'screen-2', 'desktop'));
    assert.equal(studio.getState().screenId, 'screen-1', 'The first source is still held');
    const frame = document.querySelector('[data-design-frame]');
    frame.value = 'mobile';
    frame.dispatchEvent(new window.Event('change'));
    const direction = document.querySelector('[data-design-variant]');
    direction.value = 'compact';
    direction.dispatchEvent(new window.Event('change'));
    document.querySelector('[data-design-screen="screen-3"]').click();
    document.querySelector('[data-design-step-change="1"]').click();
    document.body.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
    const settled = new Promise((resolve) => {
      const observer = new window.MutationObserver(() => {
        if (!document.querySelector('[data-design-screen-loading]')) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(document.documentElement, {
        attributes: true,
        subtree: true,
        attributeFilter: ['data-design-screen-loading'],
      });
    });
    for (let index = 0; index < 5; index++) {
      const gate = index === 0 ? first : await nextSource();
      gate.release();
      await gate.loaded;
    }
    await settled;
    assert.deepEqual(
      Object.fromEntries(
        ['screenId', 'variantId', 'frameId'].map((key) => [key, studio.getState()[key]]),
      ),
      { screenId: 'screen-3', variantId: 'compact', frameId: 'mobile' },
      'Every subsequent UI choice changes only the requested dimension',
    );
    assert.equal(
      f.stage.getState().activeArtifactId,
      designStudioArtifactId('compact', 'screen-3', 'mobile'),
    );
    assert.ok(f.stage.getLoadedArtifactIds().length <= 3);
  } finally {
    hold = false;
    for (const gate of gates) gate.release();
    f.close();
  }
});

test('walkthrough queued steps preserve the requested screen when frame and direction change', async () => {
  const f = await mount({ data: fixture({ count: 5 }) });
  try {
    const { documentNode: document, window, studio } = f;
    studio.setView('walkthrough');
    document.querySelector('[data-design-screen="screen-2"]').click();
    assert.ok(document.querySelector('[data-design-transition]'));
    document.querySelector('[data-design-step-change="1"]').click();
    document.querySelector('[data-design-step-change="1"]').click();
    const frame = document.querySelector('[data-design-frame]');
    frame.value = 'mobile';
    frame.dispatchEvent(new window.Event('change'));
    assert.equal(
      studio.getState().screenId,
      'screen-4',
      'Changing the frame preserves the queued screen',
    );
    const direction = document.querySelector('[data-design-variant]');
    direction.value = 'compact';
    direction.dispatchEvent(new window.Event('change'));
    document.body.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    assert.deepEqual(
      Object.fromEntries(
        ['screenId', 'variantId', 'frameId'].map((key) => [key, studio.getState()[key]]),
      ),
      { screenId: 'screen-5', variantId: 'compact', frameId: 'mobile' },
    );
  } finally {
    f.close();
  }
});

test('finishing an older walkthrough animation cannot replace a newer pending frame choice', {
  timeout: 30_000,
}, async () => {
  const data = fixture();
  data.document.defaultView = 'walkthrough';
  const mobileId = designStudioArtifactId('editorial', 'screen-3', 'mobile');
  let hold = false,
    releaseSource,
    sourceStarted;
  const heldSource = new Promise((resolve) => {
    sourceStarted = resolve;
  });
  const f = await mount({
    data,
    stageOptions: {
      frameBudget: 3,
      async resolveArtifactSource(artifact, { frame }) {
        if (hold && artifact.id === mobileId) {
          await new Promise((resolve) => {
            releaseSource = resolve;
            sourceStarted();
          });
        }
        const window = frame.ownerDocument.defaultView;
        setTimeout(() => frame.dispatchEvent(new window.Event('load')), 0);
        return data.envelope.artifacts.find(({ id }) => id === artifact.id).html;
      },
    },
  });
  try {
    await f.stage.ensureFrames(
      data.document.screenOrder.map((screenId) =>
        designStudioArtifactId('editorial', screenId, 'desktop'),
      ),
    );
    const { documentNode: document, window, studio } = f;
    const animations = [];
    const shell = document.querySelector('.planr-shell');
    let started;
    const animationStarted = new Promise((resolve) => {
      started = resolve;
    });
    window.Element.prototype.animate = (_frames, options) => {
      let finish;
      const finished = new Promise((resolve) => {
        finish = resolve;
      });
      animations.push({ finish, options });
      started();
      return { finished, cancel: finish };
    };
    document.querySelector('[data-design-screen="screen-2"]').click();
    await animationStarted;
    assert.equal(shell.dataset.designTransition, 'running');
    assert.equal(
      animations[0].options.duration,
      220,
      'The normal walkthrough animation is retained',
    );
    document.querySelector('[data-design-screen="screen-3"]').click();
    assert.equal(
      studio.getState().screenId,
      'screen-2',
      'The desktop request is queued behind the animation',
    );
    hold = true;
    const frame = document.querySelector('[data-design-frame]');
    frame.value = 'mobile';
    frame.dispatchEvent(new window.Event('change'));
    await heldSource;
    const transitionEnded = new Promise((resolve) => {
      const observer = new window.MutationObserver(() => {
        if (!document.querySelector('[data-design-transition]')) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(shell, {
        attributes: true,
        attributeFilter: ['data-design-transition'],
      });
    });
    for (const animation of animations) animation.finish();
    await transitionEnded;
    assert.ok(
      document.querySelector('[data-design-screen-loading]'),
      'The newer mobile source remains pending after the old animation finishes',
    );
    const settled = new Promise((resolve) => {
      const observer = new window.MutationObserver(() => {
        if (!document.querySelector('[data-design-screen-loading]')) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(shell, {
        attributes: true,
        attributeFilter: ['data-design-screen-loading'],
      });
    });
    releaseSource();
    await settled;
    assert.equal(studio.getState().screenId, 'screen-3');
    assert.equal(
      studio.getState().frameId,
      'mobile',
      'The newest pending frame is not replaced by the older queued desktop',
    );
    assert.equal(f.stage.getState().activeArtifactId, mobileId);
    assert.ok(f.stage.getLoadedArtifactIds().length <= 3);
  } finally {
    hold = false;
    releaseSource?.();
    f.close();
  }
});

for (const nextChoice of ['same screen', 'direction after mode change', 'explicit history']) {
  test(`failed preview choices retain exact retry identity through ${nextChoice}`, {
    timeout: 30_000,
  }, async () => {
    const data = fixture();
    data.document.defaultView = 'prototype';
    const desktopId = designStudioArtifactId('editorial', 'screen-2', 'desktop');
    const mobileId = designStudioArtifactId('editorial', 'screen-2', 'mobile');
    const sourceRequests = [];
    let rejectMobileOnce = false;
    const f = await mount({
      data,
      stageOptions: {
        frameBudget: 3,
        async resolveArtifactSource(artifact, { frame }) {
          sourceRequests.push(artifact.id);
          if (rejectMobileOnce && artifact.id === mobileId) {
            rejectMobileOnce = false;
            throw new Error('Synthetic source unavailable once');
          }
          const window = frame.ownerDocument.defaultView;
          setTimeout(() => frame.dispatchEvent(new window.Event('load')), 0);
          return data.envelope.artifacts.find(({ id }) => id === artifact.id).html;
        },
      },
    });
    try {
      const { documentNode: document, window, studio } = f;
      const shell = document.querySelector('.planr-shell');
      const waitForDom = (predicate) => {
        if (predicate()) return Promise.resolve();
        return new Promise((resolve) => {
          const observer = new window.MutationObserver(() => {
            if (!predicate()) return;
            observer.disconnect();
            resolve();
          });
          observer.observe(shell, { attributes: true, childList: true, subtree: true });
        });
      };
      const selected = (screenId, frameId, variantId = 'editorial') => {
        const state = studio.getState();
        return (
          !shell.hasAttribute('data-design-screen-loading') &&
          state.screenId === screenId &&
          state.frameId === frameId &&
          state.variantId === variantId
        );
      };
      document.querySelector('[data-design-screen="screen-2"]').click();
      await waitForDom(() => selected('screen-2', 'desktop'));
      assert.equal(f.stage.getState().activeArtifactId, desktopId);
      rejectMobileOnce = true;
      const framePicker = document.querySelector('[data-design-frame]');
      framePicker.value = 'mobile';
      framePicker.dispatchEvent(new window.Event('change'));
      const notice = document.querySelector('.design-notice');
      await waitForDom(() => !notice.hidden && !shell.hasAttribute('data-design-screen-loading'));
      assert.equal(studio.getState().screenId, 'screen-2');
      assert.equal(
        studio.getState().frameId,
        'desktop',
        'A failed preview does not replace the committed frame',
      );
      assert.equal(f.stage.getState().activeArtifactId, desktopId);
      assert.equal(framePicker.value, 'mobile', 'The picker identifies the failed choice');
      assert.equal(f.stage.getFrame(mobileId).dataset.planrFrameState, 'error');
      assert.match(notice.textContent, /Select it again to retry/);
      const failedRequests = sourceRequests.filter((id) => id === mobileId).length;
      if (nextChoice === 'same screen') {
        document.querySelector('[data-design-screen="screen-2"]').click();
        await f.stage.ensureFrames([desktopId]);
        assert.equal(
          sourceRequests.filter((id) => id === mobileId).length,
          failedRequests + 1,
          'The same-screen retry loads the failed mobile source',
        );
        await waitForDom(() => selected('screen-2', 'mobile'));
        assert.equal(f.stage.getState().activeArtifactId, mobileId);
      } else if (nextChoice === 'direction after mode change') {
        studio.setView('walkthrough');
        assert.equal(
          framePicker.value,
          'mobile',
          'A mode change preserves the failed frame choice',
        );
        const directionPicker = document.querySelector('[data-design-variant]');
        directionPicker.value = 'compact';
        directionPicker.dispatchEvent(new window.Event('change'));
        await f.stage.ensureFrames([desktopId]);
        const compactMobileId = designStudioArtifactId('compact', 'screen-2', 'mobile');
        assert.ok(
          sourceRequests.includes(compactMobileId),
          'A new direction composes with the failed frame',
        );
        await waitForDom(() => selected('screen-2', 'mobile', 'compact'));
        assert.equal(f.stage.getState().activeArtifactId, compactMobileId);
      } else {
        window.location.hash = '#screen=screen-1&frame=desktop&direction=editorial&view=prototype';
        await waitForDom(() => selected('screen-1', 'desktop'));
        assert.equal(framePicker.value, 'desktop', 'History selects its explicit frame');
        assert.equal(notice.hidden, true, 'History clears the obsolete failed-preview notice');
        document.querySelector('[data-design-screen="screen-2"]').click();
        await waitForDom(() => selected('screen-2', 'desktop'));
        assert.equal(
          sourceRequests.filter((id) => id === mobileId).length,
          failedRequests,
          'A new choice does not retry an obsolete failed frame',
        );
      }
      assert.equal(notice.hidden, true);
      assert.ok(f.stage.getLoadedArtifactIds().length <= 3);
    } finally {
      f.close();
    }
  });
}

test('Notes dismisses without losing context and restores keyboard focus', async () => {
  const fixture = await mount();
  const { documentNode: document, window, studio } = fixture;
  try {
    const notes = document.querySelector('[data-design-notes]');
    const summary = notes.querySelector(':scope > summary');
    const first = document.querySelector('[data-design-note="screen-1"]');
    const second = document.querySelector('[data-design-note="screen-2"]');
    const close = notes.querySelector('[data-design-close-notes]');
    first.focus();
    first.click();
    assert.equal(notes.open, true);
    assert.equal(first.getAttribute('aria-expanded'), 'true');
    close.focus();
    close.click();
    assert.equal(notes.open, false);
    assert.equal(document.activeElement, first);
    assert.equal(first.getAttribute('aria-expanded'), 'false');
    first.click();
    first.click();
    assert.equal(notes.open, false, 'clicking the same screen info toggles Notes closed');
    first.click();
    second.click();
    assert.equal(notes.open, true, 'a different info control keeps Notes open');
    assert.equal(notes.querySelector('[data-design-note-screen="screen-1"]').open, false);
    assert.equal(notes.querySelector('[data-design-note-screen="screen-2"]').open, true);
    assert.equal(second.getAttribute('aria-expanded'), 'true');
    notes.querySelector('[data-design-note-screen="screen-2"] > summary').click();
    assert.equal(notes.open, true, 'accordion interaction does not dismiss the panel');
    close.focus();
    close.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(notes.open, false);
    assert.equal(document.activeElement, second);
    summary.click();
    assert.equal(notes.open, true);
    assert.equal(summary.getAttribute('aria-expanded'), 'true');
    summary.click();
    assert.equal(notes.open, false);
    summary.click();
    document
      .querySelector('.planr-toolbar')
      .dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    assert.equal(notes.open, false);
    summary.click();
    studio.setView('prototype');
    assert.equal(notes.open, false);
    assert.equal(
      notes.querySelectorAll('[data-design-note-screen]').length,
      3,
      'dismissal preserves the notes',
    );
  } finally {
    fixture.close();
  }
});

test('studio composes one toolbar and retains the artifact-owned review, bridge sandbox and failed directions', () => {
  const data = fixture({ title: '</script><img src=x onerror=alert(1)>' });
  const html = renderDesignStudio(data);
  const dom = new JSDOM(html);
  const document = dom.window.document;
  assert.equal(document.querySelectorAll('.planr-toolbar').length, 1);
  assert.equal(document.querySelectorAll('[data-design-view]').length, 3);
  assert.equal(
    document.querySelector('[data-design-toggle-nav]').getAttribute('aria-expanded'),
    'true',
  );
  assert.ok(document.querySelector('[data-planr-action="share"]'));
  assert.ok(document.querySelector('[data-planr-share-dialog]'));
  assert.equal(document.querySelectorAll('[data-planr-slot="feedback-rail"]').length, 1);
  assert.equal(document.querySelectorAll('[data-planr-artifact-frame]').length, 12);
  assert.equal(
    document.querySelector('iframe').getAttribute('sandbox'),
    'allow-scripts allow-forms',
  );
  assert.match(
    document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
    /form-action 'none'/,
  );
  const generic = new JSDOM(renderArtifactShellDocument({ envelope: data.envelope }));
  assert.equal(
    generic.window.document.querySelector('iframe').getAttribute('sandbox'),
    'allow-scripts',
  );
  generic.window.close();
  assert.equal(document.querySelectorAll('[onerror]').length, 0);
  assert.match(
    document.querySelector('.design-failed-variants').textContent,
    /Generation interrupted/,
  );
  assert.equal(document.querySelector('option[value="unfinished"]').disabled, true);
  dom.window.close();
});

test('compact navigation and review rails collapse independently and persist', async () => {
  const saves = [];
  const app = await mount({
    options: {
      saveState: async (state) => {
        saves.push(state);
        return { stateVersion: saves.length };
      },
    },
  });
  try {
    const root = app.documentNode.querySelector('.planr-shell');
    const navigator = app.documentNode.querySelector('.design-navigator');
    const screens = app.documentNode.querySelector('[data-design-toggle-nav]');
    const feedback = app.documentNode.querySelector('[data-planr-action="feedback"]');
    assert.equal(root.dataset.designNavOpen, 'true');
    assert.equal(root.dataset.planrRailOpen, 'true');

    screens.click();
    assert.equal(root.dataset.designNavOpen, 'false');
    assert.equal(screens.getAttribute('aria-expanded'), 'false');
    assert.equal(navigator.getAttribute('aria-hidden'), 'true');
    assert.equal(navigator.inert, true);

    feedback.click();
    assert.equal(root.dataset.planrRailOpen, 'false');
    assert.equal(app.studio.getState().reviewOpen, false);
    await app.studio.flush();
    assert.equal(saves.at(-1).navOpen, false);
    assert.equal(saves.at(-1).reviewOpen, false);

    app.documentNode.querySelector('[data-planr-action="share"]').click();
    assert.equal(app.documentNode.querySelector('[data-planr-share-dialog]').hidden, false);
    app.documentNode.querySelector('[data-planr-share-close]').click();
    assert.equal(app.documentNode.querySelector('[data-planr-share-dialog]').hidden, true);
  } finally {
    app.close();
  }

  const reopened = await mount({ stored: { state: saves.at(-1) } });
  try {
    assert.equal(
      reopened.documentNode.querySelector('.planr-shell').dataset.designNavOpen,
      'false',
    );
    assert.equal(
      reopened.documentNode.querySelector('.planr-shell').dataset.planrRailOpen,
      'false',
    );
  } finally {
    reopened.close();
  }
});

test('stable artifact ids are unambiguous and bounded without losing long source identities', () => {
  assert.notEqual(designStudioArtifactId('a.b', 'c', 'd'), designStudioArtifactId('a', 'b.c', 'd'));
  const long = designStudioArtifactId(
    'variant'.repeat(30),
    'screen'.repeat(30),
    'mobile'.repeat(30),
  );
  assert.ok(long.length <= 128);
  assert.equal(
    long,
    designStudioArtifactId('variant'.repeat(30), 'screen'.repeat(30), 'mobile'.repeat(30)),
  );
  assert.notEqual(
    long,
    designStudioArtifactId('variant'.repeat(30), 'screen'.repeat(30), 'desktop'.repeat(30)),
  );
});

test('three views, responsive frames and variant comparison reuse the original loaded frames', async () => {
  const app = await mount();
  try {
    const frameSources = [...app.documentNode.querySelectorAll('iframe')].map((frame) => frame.src);
    const visible = () =>
      [...app.documentNode.querySelectorAll('.planr-artifact-panel')].filter(
        (panel) => !panel.hidden,
      );
    assert.equal(visible().length, 6);
    app.documentNode.querySelector('[data-design-view="prototype"]').click();
    assert.equal(visible().length, 1);
    const framePicker = app.documentNode.querySelector('[data-design-frame]');
    framePicker.value = 'mobile';
    framePicker.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    assert.equal(app.studio.getState().frameId, 'mobile');
    assert.equal(visible()[0].style.getPropertyValue('--planr-artifact-width'), '390px');
    const compare = app.documentNode.querySelector('[data-design-compare]');
    compare.checked = true;
    compare.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    assert.equal(visible().length, 1, 'focused views show only the selected direction');
    app.documentNode.querySelector('[data-design-view="walkthrough"]').click();
    assert.equal(app.documentNode.querySelector('.design-walkthrough-caption').hidden, false);
    app.documentNode.querySelector('[data-design-step-change="1"]').click();
    assert.equal(app.studio.getState().screenId, 'screen-2');
    assert.equal(
      app.documentNode.querySelector('[data-design-narrative]').textContent,
      'Journey step 2.',
    );
    app.studio.setView('canvas');
    assert.equal(visible().length, 12, 'canvas retains the comparison preference');
    assert.deepEqual(
      [...app.documentNode.querySelectorAll('iframe')].map((frame) => frame.src),
      frameSources,
    );
  } finally {
    app.close();
  }
});

test('canvas camera pans freely, artboards cross the origin, and each view restores its viewport', async () => {
  const app = await mount();
  try {
    const scroll = app.documentNode.querySelector('.planr-stage-scroll');
    const entry = app.entries.find(
      (item) =>
        item.variantId === 'editorial' &&
        item.screenId === 'screen-1' &&
        item.frameId === 'desktop',
    );
    const drag = app.documentNode.querySelector(`[data-design-drag="${entry.artifactId}"]`);
    drag.dispatchEvent(
      new app.window.MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 120,
        clientY: 100,
      }),
    );
    scroll.dispatchEvent(
      new app.window.MouseEvent('pointermove', {
        bubbles: true,
        clientX: 20,
        clientY: 20,
      }),
    );
    scroll.dispatchEvent(new app.window.MouseEvent('pointerup', { bubbles: true, button: 0 }));
    assert.ok(app.studio.getLayout().boards['screen-1/desktop/editorial'].x < 0);
    assert.ok(app.studio.getLayout().boards['screen-1/desktop/editorial'].y < 0);

    const canvasViewport = structuredClone(app.studio.getState().camera);
    scroll.dispatchEvent(
      new app.window.MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 50,
        clientY: 50,
      }),
    );
    scroll.dispatchEvent(
      new app.window.MouseEvent('pointermove', {
        bubbles: true,
        clientX: 170,
        clientY: 140,
      }),
    );
    scroll.dispatchEvent(new app.window.MouseEvent('pointerup', { bubbles: true, button: 0 }));
    assert.equal(app.studio.getState().camera.x, canvasViewport.x + 120);
    assert.equal(app.studio.getState().camera.y, canvasViewport.y + 90);
    const movedCanvasViewport = structuredClone(app.studio.getState().camera);

    app.studio.setView('prototype');
    assert.notDeepEqual(app.studio.getState().camera, movedCanvasViewport);
    app.studio.setView('canvas');
    assert.equal(app.studio.getState().camera.x, movedCanvasViewport.x);
    assert.equal(app.studio.getState().camera.y, movedCanvasViewport.y);
    assert.equal(app.studio.getState().viewports.canvas.x, movedCanvasViewport.x);
    assert.equal(app.studio.getState().viewports.canvas.y, movedCanvasViewport.y);
    assert.equal(app.studio.getState().viewports.canvas.zoom, app.studio.getState().zoom);

    const point = { x: 190, y: 140 };
    const beforeZoom = structuredClone(app.studio.getState());
    const worldPoint = {
      x: (point.x - beforeZoom.camera.x) / beforeZoom.zoom,
      y: (point.y - beforeZoom.camera.y) / beforeZoom.zoom,
    };
    scroll.dispatchEvent(
      new app.window.WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -40,
        clientX: point.x,
        clientY: point.y,
      }),
    );
    const afterZoom = app.studio.getState();
    assert.ok(afterZoom.zoom > beforeZoom.zoom);
    assert.ok(Math.abs((point.x - afterZoom.camera.x) / afterZoom.zoom - worldPoint.x) < 1e-8);
    assert.ok(Math.abs((point.y - afterZoom.camera.y) / afterZoom.zoom - worldPoint.y) < 1e-8);
  } finally {
    app.close();
  }
});

test('screen guidance stays outside product frames in compact tooltips and an accordion', async () => {
  const app = await mount();
  try {
    assert.equal(app.documentNode.querySelectorAll('[data-design-notes]').length, 1);
    const note = app.documentNode.querySelector('[data-design-note="screen-2"]');
    assert.match(note.title, /Journey step 2/);
    note.click();
    const notes = app.documentNode.querySelector('[data-design-notes]');
    const target = app.documentNode.querySelector('[data-design-note-screen="screen-2"]');
    assert.equal(notes.open, true);
    assert.equal(target.open, true);
    assert.equal(target.dataset.active, 'true');
    assert.equal(
      app.documentNode.querySelectorAll('.planr-artifact-panel [data-design-note-screen]').length,
      0,
    );
  } finally {
    app.close();
  }
});

test('walkthroughs do not truncate beyond eight screens and reject unknown navigation', async () => {
  const app = await mount({ data: fixture({ count: 12 }) });
  try {
    app.studio.setView('walkthrough');
    for (let index = 1; index < 12; index += 1)
      app.documentNode.querySelector('[data-design-step-change="1"]').click();
    await delay(500);
    assert.equal(app.studio.getState().screenId, 'screen-12');
    assert.equal(app.documentNode.querySelector('[data-design-step]').textContent, 'Step 12 of 12');
    assert.equal(app.documentNode.querySelector('[data-design-step-change="1"]').disabled, true);
    assert.equal(app.studio.selectScreen('does-not-exist'), false);
    assert.equal(app.studio.getState().screenId, 'screen-12');
  } finally {
    app.close();
  }
});

test('the preview default is not a vote and the first direction can be explicitly selected', async () => {
  const saves = [];
  const app = await mount({
    options: {
      saveState: async (state) => {
        saves.push(state);
        return { stateVersion: saves.length };
      },
    },
  });
  try {
    const select = app.documentNode.querySelector('[data-design-select-direction]');
    assert.equal(select.disabled, false);
    assert.equal(select.textContent, 'Use this direction');
    assert.equal(
      app.documentNode.querySelector('[data-design-selected-direction]').textContent,
      '',
    );
    assert.deepEqual([...app.studio.getState().preferences.selected], []);
    select.click();
    await app.studio.flush();
    assert.deepEqual([...saves.at(-1).preferences.selected], ['editorial']);
    assert.equal(select.textContent, 'Selected direction');
    assert.equal(select.disabled, true);
  } finally {
    app.close();
  }
});

test('ratings, remix, selection and keyboard arrangement persist serially with optimistic state versions', async () => {
  const saves = [];
  const app = await mount({
    options: {
      saveLayout: async () => ({ revision: 'layout-test-revision' }),
      saveState: async (state, context) => {
        saves.push({ state, context });
        return { stateVersion: saves.length };
      },
    },
  });
  try {
    const variant = app.documentNode.querySelector('[data-design-variant]');
    variant.value = 'compact';
    variant.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    app.documentNode.querySelector('[data-design-rating="4"]').click();
    app.documentNode.querySelector('[data-design-select-direction]').click();
    app.documentNode.querySelector('[data-design-remix]').value = 'Keep the compact navigation.';
    app.documentNode.querySelector('[data-design-save-remix]').click();
    const entry = app.entries.find(
      (item) =>
        item.variantId === 'compact' && item.screenId === 'screen-1' && item.frameId === 'desktop',
    );
    const label = app.documentNode.querySelector(`[data-design-drag="${entry.artifactId}"]`);
    label.dispatchEvent(
      new app.window.KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
      }),
    );
    await app.studio.flush();
    const state = saves.at(-1).state;
    assert.equal(state.ratings.compact, 4);
    assert.equal(state.selectedVariant, 'compact');
    assert.equal(state.remix.compact, 'Keep the compact navigation.');
    assert.equal(state.positions, undefined);
    assert.equal(app.studio.getLayout().boards['screen-1/desktop/compact'].x, 8);
    assert.equal(app.studio.getSaveState().dirty, false);
    app.documentNode.querySelector('[data-design-rating="5"]').click();
    await app.studio.flush();
    assert.equal(saves.at(-1).context.stateVersion, 1);
    assert.equal(saves.at(-1).state.ratings.compact, 5);
  } finally {
    app.close();
  }
});

test('save failure keeps an unsaved draft visible and never reports success', async () => {
  const app = await mount({
    options: {
      saveState: async () => {
        throw Object.assign(new Error('conflict'), { conflict: true });
      },
    },
  });
  try {
    app.documentNode.querySelector('[data-design-rating="2"]').click();
    await app.studio.flush();
    assert.equal(app.studio.getSaveState().dirty, true);
    assert.equal(
      app.documentNode.querySelector('[data-design-save-state]').textContent,
      'Save conflict',
    );
    const draft = JSON.parse(app.window.localStorage.getItem('openplanr.design-studio.fieldwork'));
    assert.equal(draft.unsaved, true);
    assert.equal(draft.state.ratings.editorial, 2);
    assert.match(app.documentNode.querySelector('.design-notice').textContent, /another window/);
  } finally {
    app.close();
  }
});

test('personal sync notices dismiss without losing the draft and stay dismissed until recovery', async () => {
  let failing = true;
  const saves = [];
  const app = await mount({
    options: {
      savePersonalState: async (state) => {
        saves.push(state);
        if (failing) throw new Error('offline');
        return { stateVersion: saves.length };
      },
      saveState: async () => {
        throw Object.assign(new Error('conflict'), { conflict: true });
      },
    },
  });
  try {
    const document = app.documentNode;
    const notice = document.querySelector('.design-notice');
    const dismiss = notice.querySelector('[data-design-dismiss-notice]');
    app.studio.setView('prototype');
    await app.studio.flush();
    assert.equal(notice.hidden, false);
    assert.match(notice.textContent, /Canvas preferences could not be synchronized/);
    assert.equal(dismiss.getAttribute('aria-label'), 'Dismiss notification');
    dismiss.focus();
    dismiss.click();
    assert.equal(notice.hidden, true);
    assert.equal(
      document.activeElement,
      document.querySelector('button[data-design-view="prototype"]'),
    );
    assert.equal(app.studio.getSaveState().personalPending, true);
    const draft = () =>
      JSON.parse(app.window.localStorage.getItem('openplanr.design-studio.fieldwork'));
    assert.equal(draft().personalPending, true);
    assert.equal(draft().state.view, 'prototype');

    app.studio.setView('walkthrough');
    await app.studio.flush();
    assert.equal(notice.hidden, true, 'the same failed sync cannot reopen a dismissed notice');
    assert.equal(draft().state.view, 'walkthrough');
    failing = false;
    await app.studio.flush();
    assert.equal(app.studio.getSaveState().personalPending, false);
    assert.equal(draft().personalPending, false);
    failing = true;
    app.studio.setView('prototype');
    await app.studio.flush();
    assert.equal(notice.hidden, false, 'a new failure after recovery is shown');
    dismiss.click();

    document.querySelector('[data-design-rating="2"]').click();
    await app.studio.flush();
    assert.equal(
      notice.hidden,
      false,
      'a dismissed preference warning never hides a review conflict',
    );
    assert.match(notice.textContent, /another window/);
    dismiss.click();
    assert.equal(app.studio.getSaveState().dirty, true);
    assert.equal(draft().unsaved, true);
    assert.equal(draft().state.ratings.editorial, 2);
    assert.equal(document.querySelector('[data-design-save-state]').textContent, 'Save conflict');
  } finally {
    app.close();
  }
});

test('successful preference retry clears the visible failure notice', async () => {
  let failing = true;
  const app = await mount({
    options: {
      savePersonalState: async () => {
        if (failing) throw new Error('offline');
        return { stateVersion: 1 };
      },
    },
  });
  try {
    app.studio.setView('prototype');
    await app.studio.flush();
    const notice = app.documentNode.querySelector('.design-notice');
    assert.equal(notice.hidden, false);
    failing = false;
    await app.studio.flush();
    assert.equal(notice.hidden, true);
    assert.equal(app.studio.getSaveState().personalPending, false);
  } finally {
    app.close();
  }
});

test('dismissing a comment-save failure keeps the unsaved review and retry clears it', async () => {
  const app = await mount({ options: { reviewUrl: '/review' } });
  let failing = true;
  app.window.fetch = async () => ({
    ok: !failing,
    status: failing ? 503 : 200,
    json: async () => (failing ? { message: 'Unavailable' } : {}),
  });
  try {
    app.stage.review.setIdentity({ name: 'Rae' });
    app.stage.review.dispatch({
      type: 'add-pin',
      pin: {
        artifactId: app.entries[0].artifactId,
        viewport: { width: 1280, height: 800 },
        region: { x: 0.2, y: 0.3, w: 0, h: 0 },
        intent: 'improve',
        comment: 'Clarify the next action.',
      },
    });
    await app.studio.flush();
    const notice = app.documentNode.querySelector('.design-notice');
    assert.equal(notice.hidden, false);
    assert.match(notice.textContent, /Comments could not be saved/);
    notice.querySelector('[data-design-dismiss-notice]').click();
    const draft = JSON.parse(
      app.window.localStorage.getItem('openplanr.design-studio.fieldwork.review'),
    );
    assert.equal(draft.unsaved, true);
    assert.equal(draft.review.pins[0].comment, 'Clarify the next action.');
    assert.equal(app.studio.getSaveState().dirty, true);
    assert.equal(
      app.documentNode.querySelector('[data-design-save-state]').textContent,
      'Comments unsaved',
    );
    await app.studio.flush();
    assert.equal(notice.hidden, true);
    failing = false;
    await app.studio.flush();
    assert.equal(app.studio.getSaveState().dirty, false);
    assert.equal(
      JSON.parse(app.window.localStorage.getItem('openplanr.design-studio.fieldwork.review'))
        .unsaved,
      false,
    );
  } finally {
    app.close();
  }
});

test('portable view defaults preserve ratings and migrate legacy browser arrangements on reopen', async () => {
  const data = fixture();
  const artifactId = data.entries[0].artifactId;
  const app = await mount({
    data: { ...data, state: { view: 'walkthrough' } },
    stored: {
      state: {
        view: 'prototype',
        selectedVariant: 'compact',
        ratings: { compact: 5 },
        positions: { [artifactId]: { x: 80, y: 120 } },
      },
    },
  });
  try {
    assert.equal(app.studio.getState().view, 'walkthrough');
    assert.equal(app.studio.getState().selectedVariant, 'compact');
    assert.equal(app.studio.getState().ratings.compact, 5);
    assert.equal(app.studio.getState().positions, undefined);
    app.studio.setView('canvas');
    assert.equal(app.stage.getPanel(artifactId).style.left, '80px');
    assert.equal(app.stage.getPanel(artifactId).style.top, '120px');
  } finally {
    app.close();
  }
});

test('pins remain owned by the artifact review controller across studio navigation', async () => {
  const app = await mount();
  try {
    const entry = app.entries.find(
      (item) =>
        item.screenId === 'screen-2' &&
        item.variantId === 'editorial' &&
        item.frameId === 'desktop',
    );
    app.stage.review.setIdentity({ name: 'Asem' });
    app.stage.review.dispatch({
      type: 'add-pin',
      pin: {
        artifactId: entry.artifactId,
        viewport: { width: 1280, height: 800 },
        region: { x: 0.2, y: 0.3, w: 0, h: 0 },
        intent: 'improve',
        comment: 'Increase the task hierarchy.',
      },
    });
    const before = app.stage.review.getState().review;
    app.studio.setView('prototype');
    app.studio.selectScreen('screen-2');
    app.studio.setView('walkthrough');
    assert.deepEqual(app.stage.review.getState().review, before);
    assert.equal(
      app.documentNode.querySelectorAll('.planr-annotation-layer [data-planr-pin-id]').length,
      1,
    );
    assert.equal(
      app.documentNode.querySelector('[data-design-rating="1"]').getAttribute('aria-pressed'),
      'false',
    );
  } finally {
    app.close();
  }
});

test('review experience preserves read-only modes, welcome context and personal sidebar widths', async () => {
  const value = await mount({
    experience: true,
    options: {
      loadExperience: async () => ({
        capabilities: { owner: false },
        reviewContext: {
          brief: {
            purpose: 'Check the assignment flow.',
            requests: ['Can you find the next action?'],
          },
          implementation: {
            tokens: [{ name: 'accent', value: '#008577' }],
            components: [],
            responsive: ['One column on mobile.'],
            accessibility: ['Labels remain visible.'],
          },
        },
      }),
    },
  });
  try {
    const { documentNode: document, window, studio } = value;
    assert.ok(window.__openPlanrDesignExperience);
    const separator = document.querySelector('[aria-label="Resize screens sidebar"]');
    separator.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    assert.equal(
      document.querySelector('.planr-shell').style.getPropertyValue('--design-nav-width'),
      '248px',
    );
    separator.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    assert.equal(separator.getAttribute('aria-valuenow'), '360');
    document.querySelector('#design-inspect-tab').click();
    assert.equal(document.querySelector('#design-review-panel').hidden, true);
    assert.equal(document.querySelector('#design-inspect-panel').hidden, false);
    assert.match(document.querySelector('#design-inspect-panel').textContent, /accent/);
    document
      .querySelector('#design-inspect-tab')
      .dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.equal(document.querySelector('#design-review-panel').hidden, false);
    window.__openPlanrDesignExperience.about();
    assert.match(document.querySelector('dialog').textContent, /Check the assignment flow/);
    assert.match(document.querySelector('dialog').textContent, /Can you find the next action/);
    [...document.querySelectorAll('dialog button')]
      .find((item) => item.textContent === 'Start walkthrough')
      .click();
    assert.equal(document.querySelector('dialog').dataset.designWelcomeStep, 'profile');
    [...document.querySelectorAll('dialog button')]
      .find((item) => item.textContent === 'Browse first')
      .click();
    assert.equal(studio.getState().view, 'walkthrough');
    assert.equal(studio.getState().screenId, 'screen-1');
    assert.equal(studio.getState().navOpen, false);
    assert.equal(document.querySelector('dialog'), null);
  } finally {
    value.close();
  }
});

test('review filters search and classify without losing unsent reply text', async () => {
  const value = await mount({
    experience: true,
    options: {
      loadExperience: async () => ({
        capabilities: { owner: false },
        metadata: { version: 1, categories: { 'pin-1': 'blocker' }, dispositions: {} },
      }),
    },
  });
  try {
    const { documentNode: document, stage, entries, envelope } = value;
    const { digestArtifactEnvelope } = await import('@openplanr/artifact/envelope.mjs');
    const pin = (id, screen, comment) => ({
      id,
      artifactId: entries.find((item) => item.screenId === screen).artifactId,
      author: { name: 'Rae' },
      intent: 'improve',
      status: 'open',
      comment,
      region: { x: 0.1, y: 0.1, w: 0.05, h: 0.05 },
      viewport: { width: 1280, height: 800 },
      anchor: { planrId: 'main', screen },
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
      replies: [],
    });
    stage.review.replaceReview({
      schemaVersion: '1.0.0',
      reviewId: 'review',
      reviewOf: digestArtifactEnvelope(envelope),
      decision: 'pending',
      overall: '',
      pins: [pin('pin-1', 'screen-1', 'Missing action'), pin('pin-2', 'screen-2', 'Looks clear')],
    });
    assert.equal(document.querySelectorAll('.planr-thread').length, 1);
    const reply = document.querySelector('[data-planr-reply-form] textarea');
    reply.value = 'Unsent detailed answer';
    reply.dispatchEvent(new value.window.Event('input', { bubbles: true }));
    const scope = document.querySelector('[aria-label="Review scope"]');
    scope.value = 'all';
    scope.dispatchEvent(new value.window.Event('change', { bubbles: true }));
    assert.equal(document.querySelectorAll('.planr-thread').length, 2);
    assert.equal(
      document.querySelector('[data-planr-pin-id="pin-1"] textarea').value,
      'Unsent detailed answer',
    );
    const type = document.querySelector('[aria-label="Comment type"]');
    type.value = 'blocker';
    type.dispatchEvent(new value.window.Event('change', { bubbles: true }));
    assert.equal(document.querySelectorAll('.planr-thread').length, 1);
    assert.equal(document.querySelector('.planr-intent').textContent, 'Blocker');
    const search = document.querySelector('[aria-label="Search comments"]');
    search.value = 'nothing';
    search.dispatchEvent(new value.window.Event('input', { bubbles: true }));
    assert.equal(document.querySelectorAll('.planr-thread').length, 0);
    search.value = 'action';
    search.dispatchEvent(new value.window.Event('input', { bubbles: true }));
    assert.equal(
      document.querySelector('[data-planr-pin-id="pin-1"] textarea').value,
      'Unsent detailed answer',
    );
  } finally {
    value.close();
  }
});

test('owner handoff keeps source quotes immutable and requires saving refinements before approval', async () => {
  const calls = [];
  const source = {
    pinId: 'p1',
    reviewId: 'review',
    reviewOf: 'f'.repeat(64),
    text: 'The primary action is unclear.',
    refinement: '',
    author: 'Rae',
    source: 'local',
    stale: false,
  };
  let result = {
    current: true,
    metadata: { version: 0, categories: {}, dispositions: {} },
    revision: 'current',
    draft: {
      version: 1,
      status: 'draft',
      contentHash: 'hash-one',
      content: {
        summary: 'Clarify the action',
        agreedChanges: [source],
        openQuestions: [],
        deferred: [],
        rejected: [],
      },
      markdown: 'Review brief',
    },
  };
  const value = await mount({
    experience: true,
    options: {
      loadExperience: async () => ({
        revision: 'current',
        capabilities: { owner: true, handoff: true },
      }),
      loadHandoff: async () => result,
      updateHandoff: async (body) => {
        calls.push(body);
        result = {
          ...result,
          draft: {
            ...result.draft,
            version: 2,
            contentHash: 'hash-two',
            ...(body.content ? { content: body.content } : {}),
            status: body.action === 'approve' ? 'approved' : 'draft',
          },
        };
        return result;
      },
    },
  });
  try {
    const document = value.documentNode;
    value.window.__openPlanrDesignHandoffCenter.open('review');
    await delay(10);
    const reviewDecisions = [...document.querySelectorAll('.design-handoff-center button')].find(
      (button) => button.textContent === 'Review and approve decisions',
    );
    assert.ok(reviewDecisions, 'the Handoff Center review step opens the review handoff');
    reviewDecisions.click();
    await delay(10);
    assert.equal(document.querySelector('blockquote').textContent, source.text);
    const refinement = document.querySelector('[aria-label="Accepted changes: p1"]');
    refinement.value = 'Use a clear verb and keep the action above the fold.';
    refinement.dispatchEvent(new value.window.Event('input', { bubbles: true }));
    const find = (label) =>
      [...document.querySelectorAll('dialog button')].find(
        (button) => button.textContent === label,
      );
    assert.equal(find('Approve handoff').disabled, true);
    find('Save draft').click();
    await delay(10);
    assert.equal(calls[0].content.agreedChanges[0].text, source.text);
    assert.equal(
      calls[0].content.agreedChanges[0].refinement,
      'Use a clear verb and keep the action above the fold.',
    );
    find('Approve handoff').click();
    await delay(10);
    assert.equal(calls[1].action, 'approve');
    assert.equal(calls[1].contentHash, 'hash-two');
    assert.equal(find('Approve handoff').disabled, true);
  } finally {
    value.close();
  }
});

test('search and journey filtering retain the selected screen without altering source frames', async () => {
  const data = fixture({ count: 12 });
  data.document.flows = [
    { id: 'review', title: 'Review journey', screens: ['screen-2', 'screen-3'] },
  ];
  const f = await mount({ data });
  try {
    const search = f.documentNode.querySelector('[data-design-screen-search]');
    const group = f.documentNode.querySelector('[data-design-screen-group]');
    search.value = 'Screen 2';
    search.dispatchEvent(new f.window.Event('input'));
    assert.deepEqual(
      [...f.documentNode.querySelectorAll('[data-design-screen]')]
        .filter((e) => !e.hidden)
        .map((e) => e.dataset.designScreen),
      ['screen-2'],
    );
    group.value = 'review';
    group.dispatchEvent(new f.window.Event('change'));
    assert.equal(f.documentNode.querySelector('[data-design-search-empty]').hidden, true);
    search.value = 'no match';
    search.dispatchEvent(new f.window.Event('input'));
    assert.equal(f.documentNode.querySelector('[data-design-search-empty]').hidden, false);
    assert.equal(f.studio.getState().screenId, 'screen-1');
    assert.equal(f.documentNode.querySelectorAll('iframe').length, data.entries.length);
  } finally {
    f.close();
  }
});

test('actual size and focus preserve source geometry while non-secret deep links restore selection', async () => {
  const f = await mount({ hash: '#screen=screen-2&frame=mobile&direction=compact&view=prototype' });
  try {
    assert.equal(f.studio.getState().screenId, 'screen-2');
    assert.equal(f.studio.getState().frameId, 'mobile');
    assert.equal(f.studio.getState().variantId, 'compact');
    f.documentNode.querySelector('[data-design-actual-size]').click();
    assert.equal(f.studio.getState().zoom, 1);
    assert.equal(f.studio.getState().inspectionScale, 'actual');
    f.documentNode.querySelector('[data-design-focus]').click();
    assert.equal(f.studio.getState().navOpen, false);
    assert.equal(f.studio.getState().reviewOpen, false);
    f.documentNode.querySelector('[data-design-screen="screen-3"]').click();
    assert.match(f.window.location.hash, /screen=screen-3/);
    assert.doesNotMatch(f.window.location.hash, /token|capability|auth/);
    f.window.history.back();
    await delay(40);
    assert.equal(f.studio.getState().screenId, 'screen-2');
    assert.equal(f.studio.getState().frameId, 'mobile');
    f.documentNode.querySelector('[data-design-fit]').click();
    assert.equal(f.studio.getState().inspectionScale, 'fit');
  } finally {
    f.close();
  }
});

test('document layout replaces legacy state positions without changing empty-layout geometry or camera', async () => {
  const data = fixture();
  const snapshots = [];
  for (const layout of [undefined, {}, { boards: {} }]) {
    const app = await mount({
      data: {
        ...data,
        document: { ...data.document, ...(layout === undefined ? {} : { layout }) },
      },
    });
    try {
      app.studio.fit();
      snapshots.push({
        panels: data.entries.map(({ artifactId }) => {
          const panel = app.stage.getPanel(artifactId);
          return [panel.style.left, panel.style.top, panel.querySelector('strong').textContent];
        }),
        camera: app.studio.getState().camera,
        zoom: app.studio.getState().zoom,
      });
    } finally {
      app.close();
    }
  }
  assert.deepEqual(
    JSON.parse(JSON.stringify(snapshots[1])),
    JSON.parse(JSON.stringify(snapshots[0])),
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(snapshots[2])),
    JSON.parse(JSON.stringify(snapshots[0])),
  );
});

test('board moves queue revision saves and undo/redo without storing positions or replacing frames', async () => {
  const requests = [];
  let revision = 'initial';
  const data = fixture({ count: 1 });
  data.revision = revision;
  data.document.layout = {
    boards: { 'screen-1/desktop/editorial': { x: 50.4, y: 60.6, title: 'Overview' } },
  };
  const app = await mount({
    data,
    options: {
      async saveLayout(input) {
        requests.push(input);
        assert.equal(input.revision, revision);
        await delay(10);
        revision = input.restoreRevision ?? `move-${requests.length}`;
        return { revision };
      },
    },
  });
  try {
    const entry = app.entries[0];
    const frame = app.stage.getFrame(entry.artifactId);
    const panel = app.stage.getPanel(entry.artifactId);
    const handle = panel.querySelector('[data-design-drag]');
    const key = (key, modifiers = {}) =>
      handle.dispatchEvent(
        new app.window.KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }),
      );
    key('ArrowRight');
    key('ArrowDown');
    key('z', { ctrlKey: true });
    await app.studio.flush();
    assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
      { revision: 'initial', boards: { 'screen-1/desktop/editorial': { x: 58, y: 61 } } },
    ]);
    assert.equal(panel.style.top, '61px');
    key('z', { metaKey: true, shiftKey: true });
    await app.studio.flush();
    assert.equal(app.studio.getRevision(), 'move-2');
    assert.equal(panel.style.top, '69px');
    key('z', { ctrlKey: true });
    await app.studio.flush();
    assert.equal(requests.at(-1).restoreRevision, 'move-1');
    assert.equal(panel.style.top, '61px');
    key('z', { ctrlKey: true, shiftKey: true });
    await app.studio.flush();
    assert.equal(requests.at(-1).restoreRevision, 'move-2');
    assert.equal(panel.style.top, '69px');
    assert.equal(app.stage.getFrame(entry.artifactId), frame);
    assert.equal(panel.querySelector('strong').textContent, 'Overview');
    assert.equal(app.studio.getState().positions, undefined);
    assert.equal(
      JSON.parse(app.window.localStorage.getItem('openplanr.design-studio.fieldwork')).state
        .positions,
      undefined,
    );
    assert.equal(app.studio.getSaveState().dirty, false);
  } finally {
    app.close();
  }
});

test('a failed layout save stays pending and retries visibly on flush', async () => {
  let failed = true;
  const data = fixture({ count: 1 });
  data.revision = 'initial';
  const app = await mount({
    data,
    options: {
      async saveLayout() {
        if (failed) throw new Error('Design layout write disconnected.');
        return { revision: 'moved' };
      },
    },
  });
  try {
    app.documentNode
      .querySelector('[data-design-drag]')
      .dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await app.studio.flush();
    assert.equal(app.studio.getSaveState().dirty, true);
    assert.match(
      app.documentNode.querySelector('.design-notice').textContent,
      /Design layout write disconnected/,
    );
    failed = false;
    await app.studio.flush();
    assert.equal(app.studio.getSaveState().dirty, false);
    assert.equal(app.studio.getRevision(), 'moved');
  } finally {
    app.close();
  }
});

test('canvas initialization preserves a delayed authoritative personal viewport', async () => {
  let respond;
  const initialState = new Promise((resolve) => {
    respond = resolve;
  });
  const app = await mount({
    options: { stateUrl: '/api/design-state' },
    fetchImpl: () => initialState,
  });
  try {
    await delay(50);
    assert.equal(app.studio.getSaveState().personalPending, false);
    respond({
      ok: true,
      async json() {
        return {
          stateVersion: 1,
          state: { view: 'canvas', camera: { x: -345, y: 147 }, zoom: 0.42 },
        };
      },
    });
    await delay(30);
    assert.deepEqual(structuredClone(app.studio.getState().camera), { x: -345, y: 147 });
    assert.equal(app.studio.getState().zoom, 0.42);
    assert.equal(app.studio.getSaveState().personalPending, false);
  } finally {
    app.close();
  }
});

test('Space on the focused engine stage enters and releases the studio pan tool', async () => {
  const app = await mount();
  try {
    const scroll = app.documentNode.querySelector('.planr-stage-scroll');
    scroll.focus();
    scroll.dispatchEvent(
      new app.window.KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(app.studio.getTool(), 'pan');
    assert.equal(app.documentNode.querySelector('.planr-shell').dataset.designPanActive, 'true');
    scroll.dispatchEvent(
      new app.window.KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }),
    );
    assert.equal(app.studio.getTool(), 'interact');
  } finally {
    app.close();
  }
});

test('late startup state cannot rewind a revision adopted from a layout save', async () => {
  let respond;
  const initialState = new Promise((resolve) => {
    respond = resolve;
  });
  const data = fixture({ count: 1 });
  data.revision = 'initial';
  const app = await mount({
    data,
    options: {
      stateUrl: '/api/design-state',
      async saveLayout() {
        return { revision: 'moved' };
      },
    },
    fetchImpl: () => initialState,
  });
  try {
    app.documentNode
      .querySelector('[data-design-drag]')
      .dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await app.studio.flush();
    assert.equal(app.studio.getRevision(), 'moved');
    respond({
      ok: true,
      async json() {
        return { revision: 'initial', stateVersion: 0, state: {} };
      },
    });
    await delay(30);
    assert.equal(app.studio.getRevision(), 'moved');
  } finally {
    app.close();
  }
});

test('section headings share the canvas world, affect Fit, and hide in focused views', async () => {
  const data = fixture({ count: 1 });
  data.document.layout = {
    sections: [{ id: 'journey', x: -5000, y: -2000, text: 'Journey', maxW: 200 }],
  };
  const app = await mount({ data });
  try {
    const heading = app.documentNode.querySelector('.design-section-heading');
    assert.equal(heading.getAttribute('role'), 'heading');
    assert.equal(heading.getAttribute('aria-level'), '2');
    assert.equal(parseFloat(heading.style.maxWidth) * app.studio.getState().zoom, 200);
    assert.equal(heading.parentElement, app.documentNode.querySelector('.planr-frame-grid'));
    Object.defineProperties(heading, { offsetWidth: { value: 200 }, offsetHeight: { value: 70 } });
    Object.defineProperties(app.documentNode.querySelector('.planr-stage-scroll'), {
      clientWidth: { value: 2000 },
      clientHeight: { value: 1200 },
      getBoundingClientRect: {
        value: () => ({ left: 0, top: 0, right: 2000, bottom: 1200, width: 2000, height: 1200 }),
      },
    });
    app.window.dispatchEvent(new app.window.Event('resize'));
    app.studio.fit();
    const expectedZoom = 1904 / 6766;
    assert.equal(app.studio.getState().zoom, expectedZoom);
    assert.equal(app.studio.getState().camera.x, 48 + 5000 * expectedZoom);
    for (const view of ['prototype', 'walkthrough']) {
      app.studio.setView(view);
      assert.equal(heading.hidden, true);
    }
    app.studio.setView('canvas');
    assert.equal(heading.hidden, false);
  } finally {
    app.close();
  }
});

test('fractional-zoom drags save and display whole CSS pixels', async () => {
  const data = fixture({ count: 1 });
  data.revision = 'initial';
  const requests = [];
  const app = await mount({
    data,
    options: {
      async saveLayout(input) {
        requests.push(input);
        return { revision: 'moved' };
      },
    },
  });
  try {
    app.studio.setCamera({ x: 40, y: 40, zoom: 0.29 });
    const panel = app.stage.getPanel(app.entries[0].artifactId);
    const handle = panel.querySelector('[data-design-drag]');
    const scroll = app.documentNode.querySelector('.planr-stage-scroll');
    const pointer = (target, type, x, y) =>
      target.dispatchEvent(
        new app.window.MouseEvent(type, {
          bubbles: true,
          button: 0,
          clientX: x,
          clientY: y,
        }),
      );
    pointer(handle, 'pointerdown', 100, 100);
    pointer(scroll, 'pointermove', 117, 111);
    pointer(scroll, 'pointerup', 117, 111);
    await app.studio.flush();
    const point = app.studio.getLayout().boards['screen-1/desktop/editorial'];
    assert.equal(point.x, Math.round(17 / 0.29));
    assert.equal(point.y, Math.round(72 + 11 / 0.29));
    assert.equal(panel.style.left, `${point.x}px`);
    assert.equal(panel.style.top, `${point.y}px`);
    assert.deepEqual(JSON.parse(JSON.stringify(requests[0].boards)), {
      'screen-1/desktop/editorial': { x: point.x, y: point.y },
    });
  } finally {
    app.close();
  }
});

test('auto measurements update runtime geometry and preserve fixed frame geometry and grid rows', async (t) => {
  const data = fixture({ count: 2 });
  data.document.frames[0].height = 'auto';
  for (const artifact of data.envelope.artifacts)
    if (artifact.viewport.width === 1280) artifact.viewport.height = 844;
  const app = await mount({ data });
  t.after(() => app.close());
  const { window, stage, studio } = app;
  const selected = data.entries[0];
  const iframe = stage.getFrame(selected.artifactId);
  const panel = stage.getPanel(selected.artifactId);
  const next = data.entries.find(
    (entry) =>
      entry.screenId === 'screen-2' &&
      entry.frameId === 'desktop' &&
      entry.variantId === 'editorial',
  );
  const before = stage.getPanel(next.artifactId).style.top;
  const measure = (height, source = iframe.contentWindow) =>
    window.dispatchEvent(
      new window.MessageEvent('message', {
        origin: 'null',
        source,
        data: { type: 'openplanr:design-size', screenId: selected.screenId, width: 1280, height },
      }),
    );
  measure(2400);
  assert.deepEqual({ ...studio.getViewport(selected.artifactId) }, { width: 1280, height: 2400 });
  assert.equal(panel.style.getPropertyValue('--planr-artifact-height'), '2400px');
  assert.equal(stage.getPanel(next.artifactId).style.top, before);
  assert.equal(data.document.frames[0].height, 'auto');
  assert.equal(data.envelope.artifacts[0].viewport.height, 844);
  window.document.querySelector('.design-tools-menu button[aria-pressed]').click();
  await delay(35);
  const minimap = window.document.querySelector('.design-minimap svg');
  for (const rect of minimap.querySelectorAll('rect'))
    for (const attribute of ['x', 'y', 'width', 'height'])
      assert.ok(Number.isFinite(Number(rect.getAttribute(attribute))), `${attribute} is numeric`);
  let inspected;
  Object.defineProperty(iframe, '__openPlanrBridge', {
    configurable: true,
    value: {
      inspectAt: async (x, y) => {
        inspected = { x, y };
        return { tagName: 'button' };
      },
    },
  });
  iframe.getBoundingClientRect = () => ({ left: 100, top: 100, width: 640, height: 1200 });
  panel
    .querySelector('.design-inspect-overlay')
    .dispatchEvent(new window.MouseEvent('click', { clientX: 420, clientY: 700, bubbles: true }));
  await delay(0);
  assert.deepEqual(inspected, { x: 640, y: 1200 });
  for (const bad of [0, 'auto', NaN, 16385]) measure(bad);
  measure(1200, window);
  assert.equal(studio.getViewport(selected.artifactId).height, 2400);
  studio.fitSelection();
  const fitted = studio.getState();
  assert.ok(Number.isFinite(fitted.camera.y) && Number.isFinite(fitted.zoom));
  assert.ok(
    Math.abs(
      parseFloat(window.document.querySelector('.design-selection-outline').style.height) -
        (2400 * fitted.zoom + 6),
    ) <= 1,
  );
  for (const view of ['prototype', 'walkthrough']) {
    studio.setView(view);
    const state = studio.getState();
    assert.ok(Number.isFinite(state.zoom) && Number.isFinite(state.camera.y));
  }
  const fixed = data.entries.find((entry) => entry.frameId === 'mobile');
  assert.equal(studio.getViewport(fixed.artifactId).height, 844);
});

test('unplaced boards are excluded from live context until their structural render', async () => {
  const contexts = [];
  const app = await mount({
    options: { viewContextUrl: '/api/view-context' },
    fetchImpl: async (_url, init) => {
      contexts.push(JSON.parse(init.body));
      return {
        ok: true,
        async json() {
          return {};
        },
      };
    },
  });
  try {
    for (const panel of app.documentNode.querySelectorAll('.planr-artifact-panel')) {
      panel.style.removeProperty('left');
      panel.style.removeProperty('top');
    }
    app.studio.setCamera({ x: 160, y: 110, zoom: 0.5 });
    await delay(300);
    assert.deepEqual(contexts.at(-1).visibleScreens, []);
    assert.equal(app.documentNode.querySelector('.design-selection-outline').hidden, true);
    app.studio.fit();
    assert.ok(
      [...app.documentNode.querySelectorAll('.planr-artifact-panel:not([hidden])')].every(
        (panel) =>
          Number.isFinite(parseFloat(panel.style.left)) &&
          Number.isFinite(parseFloat(panel.style.top)),
      ),
    );
  } finally {
    app.close();
  }
});

test('changing tools ends a captured engine pan', async () => {
  const app = await mount();
  try {
    const scroll = app.documentNode.querySelector('.planr-stage-scroll');
    const captured = new Set();
    const pointer = (type, x = 0, y = 0) => {
      const event = new app.window.MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: y,
      });
      Object.defineProperty(event, 'pointerId', { value: 7 });
      return event;
    };
    scroll.setPointerCapture = (id) => {
      captured.add(id);
      scroll.dispatchEvent(pointer('gotpointercapture'));
    };
    scroll.hasPointerCapture = (id) => captured.has(id);
    scroll.releasePointerCapture = (id) => {
      captured.delete(id);
      scroll.dispatchEvent(pointer('lostpointercapture'));
    };
    app.studio.setTool('pan');
    scroll.dispatchEvent(pointer('pointerdown', 50, 50));
    scroll.dispatchEvent(pointer('pointermove', 90, 70));
    const before = structuredClone(app.studio.getState().camera);
    const mutations = [];
    const observer = new app.window.MutationObserver((records) => mutations.push(...records));
    observer.observe(scroll, {
      attributes: true,
      attributeFilter: ['role', 'aria-roledescription'],
    });
    app.studio.setTool('interact');
    assert.equal(captured.size, 0);
    assert.equal(mutations.length + observer.takeRecords().length, 0, 'The engine stays attached');
    observer.disconnect();
    scroll.dispatchEvent(pointer('pointermove', 170, 110));
    scroll.dispatchEvent(pointer('pointerup', 170, 110));
    assert.deepEqual(structuredClone(app.studio.getState().camera), before);
  } finally {
    app.close();
  }
});

test('saved canvas translation survives a synchronous render during a view change', async () => {
  const app = await mount();
  try {
    app.studio.setCamera({ x: 160, y: 110, zoom: 0.5 });
    app.studio.setView('prototype');
    app.documentNode
      .querySelector('.planr-shell')
      .addEventListener('planr:design-view-change', (event) => {
        if (event.detail.view === 'canvas')
          app.studio.setPanels({ navOpen: false, reviewOpen: false });
      });
    app.studio.setView('canvas');
    assert.deepEqual(structuredClone(app.studio.getState().camera), { x: 160, y: 110 });
    assert.deepEqual(structuredClone(app.studio.getState().viewports.canvas), {
      x: 160,
      y: 110,
      zoom: 0.5,
    });
  } finally {
    app.close();
  }
});

test('studio keyboard coordination preserves control activation and owns Escape before engine selection', async () => {
  const app = await mount();
  try {
    const panel = app.documentNode.querySelector('.planr-artifact-panel:not([hidden])');
    panel.focus();
    for (const key of ['Home', 'End']) {
      const event = new app.window.KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      panel.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false);
      assert.equal(app.documentNode.activeElement, panel);
    }
    const button = panel.querySelector('[data-design-drag]');
    button.focus();
    const enter = new app.window.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, false);
    app.studio.setPanels({ reviewOpen: true });
    panel.dispatchEvent(
      new app.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    assert.equal(app.studio.getState().reviewOpen, false);
  } finally {
    app.close();
  }
});

test('opening notes for an inactive board preserves the saved canvas camera', async () => {
  const app = await mount();
  try {
    const scroll = app.documentNode.querySelector('.planr-stage-scroll');
    Object.defineProperties(scroll, {
      clientWidth: { value: 1024 },
      clientHeight: { value: 800 },
      getBoundingClientRect: {
        value: () => ({ left: 0, top: 0, right: 1024, bottom: 800, width: 1024, height: 800 }),
      },
    });
    app.window.dispatchEvent(new app.window.Event('resize'));
    app.studio.setCamera({ x: 160, y: 110, zoom: 0.5 });
    const entry = app.entries.find(
      (item) =>
        item.frameId === 'mobile' && item.screenId === 'screen-1' && item.variantId === 'editorial',
    );
    const note = app.stage.getPanel(entry.artifactId).querySelector('[data-design-note]');
    note.focus();
    note.click();
    assert.deepEqual(structuredClone(app.studio.getState().camera), { x: 160, y: 110 });
    await app.studio.flush();
    const stored = JSON.parse(
      app.window.localStorage.getItem(`openplanr.design-studio.${app.document.id}`),
    );
    assert.deepEqual(stored.state.camera, { x: 160, y: 110 });
  } finally {
    app.close();
  }
});

test('section geometry uses readable screen type, screen width and a bottom anchor', async (t) => {
  const data = fixture({ count: 1 });
  data.document.layout = {
    sections: [{ id: 'journey', x: -5000, y: -2000, text: 'Journey', maxW: 200 }],
  };
  const app = await mount({ data });
  t.after(() => app.close());
  const heading = app.documentNode.querySelector('.design-section-heading');
  Object.defineProperties(heading, {
    offsetWidth: { value: 200 },
    offsetHeight: { value: 70 },
  });
  for (const zoom of [0.05, 0.3, 1, 2]) {
    app.studio.setCamera({ x: 0, y: 0, zoom });
    const screenFont = parseFloat(app.window.getComputedStyle(heading).fontSize) * zoom;
    assert.ok(screenFont >= 14 && screenFont <= 28, `screen font at ${zoom}: ${screenFont}`);
    assert.ok(Math.abs(parseFloat(heading.style.maxWidth) * zoom - 200) < 0.000001);
    assert.equal(parseFloat(heading.style.top) + heading.offsetHeight, -2000);
  }
});

test('section headings move above board labels at every zoom and Fit stays stable', async (t) => {
  const data = fixture({ count: 3 });
  data.document.layout = {
    sections: [{ id: 'journey', x: 0, y: 0, text: 'Workspace journey', maxW: 160 }],
  };
  const app = await mount({ data });
  t.after(() => app.close());
  const heading = app.documentNode.querySelector('.design-section-heading');
  Object.defineProperties(heading, {
    offsetWidth: { get: () => 160 / app.studio.getState().zoom },
    offsetHeight: { get: () => 35 / app.studio.getState().zoom },
  });
  Object.defineProperties(app.documentNode.querySelector('.planr-stage-scroll'), {
    clientWidth: { value: 1440 },
    clientHeight: { value: 900 },
    getBoundingClientRect: {
      value: () => ({ left: 0, top: 0, right: 1440, bottom: 900, width: 1440, height: 900 }),
    },
  });
  for (const zoom of [0.05, 0.1, 0.17, 0.28, 1]) {
    app.studio.setCamera({ x: 0, y: 0, zoom });
    assert.equal(heading.hidden, false, `heading visible at ${zoom}`);
    const bottom = parseFloat(heading.style.top) + heading.offsetHeight;
    assert.ok(bottom <= 0, 'heading never moves below its authored anchor');
    assert.ok(bottom * zoom <= 72 * zoom - 42 + 0.001, 'heading clears the label by 8px');
    assert.ok(parseFloat(heading.style.fontSize) * zoom >= 14);
  }
  app.window.dispatchEvent(new app.window.Event('resize'));
  app.studio.fit();
  const fitted = app.studio.getState();
  assert.equal(heading.hidden, false, 'Fit includes the relocated heading');
  assert.ok(
    fitted.camera.y + parseFloat(heading.style.top) * fitted.zoom >= 0,
    JSON.stringify({ camera: fitted.camera, zoom: fitted.zoom, top: heading.style.top }),
  );
  app.studio.fit();
  const repeated = app.studio.getState();
  assert.ok(Math.abs(repeated.zoom - fitted.zoom) < 0.000001, 'Fit converges');
  assert.ok(Math.abs(repeated.camera.y - fitted.camera.y) < 0.01, 'Fit does not oscillate');
});

test('board labels give titles priority over metadata and expose complete tooltips', async (t) => {
  const data = fixture({ count: 1 });
  data.document.screens[0].title = 'Public status page';
  data.document.layout = { boards: { 'screen-1': { x: 0, y: 72, title: 'Public status page' } } };
  const app = await mount({ data });
  t.after(() => app.close());
  const label = app.documentNode.querySelector('.design-artboard-label');
  const title = label.querySelector('strong');
  const size = label.querySelector('span');
  Object.defineProperties(title, {
    scrollWidth: { value: 110 },
    clientWidth: { get: () => (app.studio.getState().zoom < 0.3 && !size.hidden ? 90 : 110) },
  });
  for (const zoom of [0.17, 1, 0.1]) {
    app.studio.setCamera({ x: 0, y: 0, zoom });
    assert.equal(size.hidden, zoom < 0.3, `metadata visibility at ${zoom}`);
    assert.ok(title.scrollWidth <= title.clientWidth);
    assert.equal(label.title, 'Public status page · Desktop · 1280 × 800');
  }
});

test('relocated headings hide only when an upper board or another heading still collides', async (t) => {
  const data = fixture({ count: 2 });
  data.document.layout = {
    boards: { 'screen-2': { x: 0, y: -800 } },
    sections: [
      { id: 'upper', x: 0, y: -900, text: 'Upper' },
      { id: 'duplicate', x: 0, y: -900, text: 'Duplicate' },
      { id: 'crowded', x: 0, y: 0, text: 'Crowded' },
    ],
  };
  const app = await mount({ data });
  t.after(() => app.close());
  const headings = [...app.documentNode.querySelectorAll('.design-section-heading')];
  for (const heading of headings)
    Object.defineProperties(heading, {
      offsetWidth: { value: 160 },
      offsetHeight: { value: 35 },
    });
  app.studio.setCamera({ x: 0, y: 0, zoom: 0.28 });
  assert.deepEqual(
    headings.map((heading) => heading.hidden),
    [false, true, true],
  );
});

test('Fit excludes measured chrome on every stage edge', async (t) => {
  const app = await mount({ data: fixture({ count: 1 }) });
  t.after(() => app.close());
  app.studio.setPanels({ navOpen: false, reviewOpen: false });
  const scroll = app.documentNode.querySelector('.planr-stage-scroll');
  const rect = (left, top, width, height) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  });
  Object.defineProperties(scroll, {
    clientWidth: { value: 2000 },
    clientHeight: { value: 1200 },
    getBoundingClientRect: { value: () => rect(100, 50, 2000, 1200) },
  });
  const toolbar = app.documentNode.querySelector('.design-toolbar');
  for (const [edge, box] of [
    ['bottom', rect(800, 1050, 600, 150)],
    ['top', rect(800, 50, 600, 150)],
    ['left', rect(100, 450, 200, 300)],
    ['right', rect(1900, 450, 200, 300)],
  ]) {
    toolbar.getBoundingClientRect = () => box;
    app.window.dispatchEvent(new app.window.Event('resize'));
    app.studio.fit();
    const { camera, zoom } = app.studio.getState();
    for (const panel of app.documentNode.querySelectorAll('.planr-artifact-panel:not([hidden])')) {
      const entry = app.entries.find(({ artifactId }) => artifactId === panel.dataset.artifactId);
      const viewport = app.studio.getViewport(entry.artifactId);
      const left = 100 + camera.x + parseFloat(panel.style.left) * zoom;
      const top = 50 + camera.y + parseFloat(panel.style.top) * zoom;
      if (edge === 'bottom') assert.ok(top + viewport.height * zoom <= box.top, edge);
      if (edge === 'top') assert.ok(top >= box.bottom, edge);
      if (edge === 'left') assert.ok(left >= box.right, edge);
      if (edge === 'right') assert.ok(left + viewport.width * zoom <= box.left, edge);
    }
  }
});

test('visible canvas boards keep bridge gestures and direct interaction in Interact mode', async (t) => {
  const app = await mount({ data: fixture({ count: 2 }) });
  t.after(() => app.close());
  const first = app.stage.getFrame(app.entries[0].artifactId);
  const second = app.stage.getFrame(app.entries[2].artifactId);
  const forwarded = [];
  for (const frame of [first, second])
    frame.__openPlanrBridge = { setViewportGestures: (enabled) => forwarded.push(enabled) };
  app.studio.setTool('interact');
  assert.equal(first.style.pointerEvents, '');
  assert.equal(second.style.pointerEvents, '');
  assert.equal(second.tabIndex, 0);
  assert.deepEqual(forwarded, [true, true]);
  forwarded.length = 0;
  app.studio.setView('prototype');
  assert.ok(forwarded.length > 0);
  assert.ok(forwarded.every((enabled) => enabled === false));
});

async function studioReady(app) {
  const root = app.documentNode.querySelector('.planr-shell');
  if (root.dataset.designReady !== 'true')
    await new Promise((resolve) =>
      root.addEventListener('planr:design-ready', resolve, { once: true }),
    );
}

test('a bridge mounted later within the frame budget receives current canvas gestures', async (t) => {
  const gestures = new Map();
  const app = await mount({
    data: fixture({ count: 3 }),
    stageOptions: {
      frameBudget: 3,
      bridgeClient: {
        attach({ artifact, frame }) {
          gestures.set(artifact.id, false);
          frame.__openPlanrBridge = {
            setViewportGestures: (enabled) => gestures.set(artifact.id, enabled),
          };
          frame.dataset.planrBridgeTrusted = 'true';
          return () => {
            delete frame.__openPlanrBridge;
          };
        },
      },
    },
  });
  t.after(() => app.close());
  await studioReady(app);
  const id = app.entries[2].artifactId;
  assert.equal(app.stage.getLoadedArtifactIds().includes(id), false);
  await app.stage.ensureFrames([id]);
  assert.equal(app.stage.getFrame(id).dataset.planrFrameState, 'ready');
  assert.equal(gestures.get(id), true, 'a late board must not retain the bridge default');
});

for (const event of ['planr:artifact-bridge-ready', 'load']) {
  test(`a late bridge receives current gesture state on ${event}`, async (t) => {
    const app = await mount({ data: fixture({ count: 2 }) });
    t.after(() => app.close());
    await studioReady(app);
    const frame = app.stage.getFrame(app.entries[2].artifactId);
    const forwarded = [];
    frame.__openPlanrBridge = { setViewportGestures: (enabled) => forwarded.push(enabled) };
    frame.dispatchEvent(new app.window.Event(event));
    assert.deepEqual(forwarded, [true]);
    app.studio.setView('prototype');
    forwarded.length = 0;
    frame.dispatchEvent(new app.window.Event(event));
    assert.deepEqual(forwarded, [false], 'a late event uses the current view');
    app.studio.destroy();
    forwarded.length = 0;
    frame.dispatchEvent(new app.window.Event(event));
    assert.deepEqual(forwarded, [], 'destroy removes frame listeners');
  });
}

test('centring a tall board keeps its screen-sized title clear of top chrome', async (t) => {
  const app = await mount({ data: fixture({ count: 2 }) });
  t.after(() => app.close());
  app.studio.setPanels({ navOpen: false, reviewOpen: false });
  const scroll = app.documentNode.querySelector('.planr-stage-scroll');
  Object.defineProperties(scroll, {
    clientWidth: { value: 600 },
    clientHeight: { value: 400 },
    getBoundingClientRect: {
      value: () => ({ left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 }),
    },
  });
  app.documentNode.querySelector('.design-stage-context').getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 600,
    bottom: 80,
    width: 600,
    height: 80,
  });
  app.window.dispatchEvent(new app.window.Event('resize'));
  app.studio.setCamera({ x: 0, y: 0, zoom: 1 });
  app.documentNode.querySelector('[data-design-screen="screen-2"]').click();
  const { camera, zoom } = app.studio.getState();
  const panel = app.stage.getPanel(app.entries[2].artifactId);
  const titleTop = camera.y + parseFloat(panel.style.top) * zoom - 34;
  assert.ok(titleTop >= 92, `Title top ${titleTop} clears the header and its gap`);
  assert.ok(camera.y + (parseFloat(panel.style.top) + 800) * zoom <= 388);
});

test('board metadata includes authored dimensions only once', async (t) => {
  const data = fixture({ count: 1 });
  data.document.frames[0].label = 'Desktop viewport · 1280 × 800';
  const app = await mount({ data });
  t.after(() => app.close());
  assert.equal(
    app.documentNode.querySelector('.design-artboard-drag span').textContent,
    'Desktop viewport · 1280 × 800',
  );
});

test('frame picker includes fixed and auto dimensions exactly once', async () => {
  for (const height of [800, 'auto']) {
    for (const embedded of [false, true]) {
      const data = fixture({ count: 1 });
      const dimensions = `1280 × ${height}`;
      data.document.frames[0].height = height;
      data.document.frames[0].label = embedded
        ? `Desktop viewport · ${dimensions}`
        : 'Desktop viewport';
      const dom = new JSDOM(renderDesignStudio(data));
      try {
        assert.equal(
          dom.window.document.querySelector('[data-design-frame] option').textContent,
          `Desktop viewport · ${dimensions}`,
        );
      } finally {
        dom.window.close();
      }
    }
  }
});

test('disconnected save status exposes the complete text as its title', async (t) => {
  const app = await mount({
    options: { stateUrl: '/api/design-state' },
    fetchImpl: async () => {
      throw new Error('Offline state');
    },
  });
  t.after(() => app.close());
  await delay(30);
  const status = app.documentNode.querySelector('[data-design-save-state]');
  assert.equal(status.textContent, 'Disconnected · local draft');
  assert.equal(status.title, status.textContent);
});

test('verification failure is shown on mount and after a status poll', async (t) => {
  const data = fixture({ count: 1 });
  data.verification = { status: 'failed' };
  const app = await mount({
    data,
    options: { statusUrl: '/api/design-status' },
    fetchImpl: async () => ({ ok: true, json: async () => ({ verification: 'failed' }) }),
  });
  t.after(() => app.close());
  const label = app.documentNode.querySelector('[data-design-verification]');
  assert.equal(label.textContent, 'Browser inspection failed');
  label.textContent = 'Waiting for poll';
  await delay(4100);
  assert.equal(label.textContent, 'Browser inspection failed');
});
