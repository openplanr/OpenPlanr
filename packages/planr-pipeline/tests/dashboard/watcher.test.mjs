import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

import { createWatcher } from '../../lib/dashboard/watcher.mjs';

test('watcher debounces a burst of writes into exactly one patch', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-watch-'));
  const planrDir = join(home, '.planr');
  const DEBOUNCE_MS = 80;

  // Capture which scope the engine is asked to recompute, and how many patches fire.
  const scopes = [];
  const patches = [];

  // Fake fs.watch we drive ourselves: returns a handle whose `close`/`on` are
  // inert; we call the supplied listener directly to simulate save events. This
  // keeps the debounce assertion deterministic across platforms.
  let listener = null;
  const fakeWatchImpl = (_dir, _opts, cb) => {
    listener = cb;
    return { close() {}, on() {} };
  };

  // Stub buildGraph: records the `scope` it was given, and returns a graph whose
  // single node's status flips each call so every recompute is a real diff. The
  // watcher never reads the filesystem here, so no real file writes are needed.
  let call = 0;
  const stubBuildGraph = (_dir, opts = {}) => {
    scopes.push(opts.scope ?? null);
    call += 1;
    return {
      nodes: [
        {
          id: 'T-001',
          type: 'task',
          title: 'T-001 task',
          status: call % 2 === 0 ? 'in-progress' : 'done',
          frontmatter: { id: 'T-001' },
        },
      ],
      edges: [],
    };
  };

  const watcher = createWatcher(planrDir, {
    debounceMs: DEBOUNCE_MS,
    onPatch: (p) => patches.push(p),
    initialGraph: { nodes: [], edges: [] },
    buildGraph: stubBuildGraph,
    watchImpl: fakeWatchImpl,
  });

  try {
    watcher.start();
    assert.ok(typeof listener === 'function', 'watcher should have registered an fs listener');

    // Fire a burst of three save events SYNCHRONOUSLY (no await between them) so
    // they are guaranteed to land in the same debounce window regardless of how
    // loaded the runner is — any `await delay()` shorter than the window can be
    // stretched past it under CI contention, which would (wrongly) split the
    // burst into multiple patches. The watcher must coalesce them into one.
    const rel = 'specs/SPEC-001/tasks/T-001-thing.md';
    listener('change', rel);
    listener('change', rel);
    listener('change', rel);

    // Wait comfortably past the debounce window for the single coalesced flush.
    await delay(DEBOUNCE_MS * 3);

    // Exactly one patch event for the burst of three writes.
    assert.equal(patches.length, 1, `expected one coalesced patch, got ${patches.length}`);

    // The engine was asked to recompute exactly once, scoped to the changed id —
    // not a blanket full-graph recompute (the scope must be the node id).
    assert.equal(scopes.length, 1, `expected one scoped recompute, got ${scopes.length}`);
    assert.equal(scopes[0], 'T-001', `scope should be the changed node id, got ${JSON.stringify(scopes[0])}`);
  } finally {
    watcher.stop();
    rmSync(home, { recursive: true, force: true });
  }
});
