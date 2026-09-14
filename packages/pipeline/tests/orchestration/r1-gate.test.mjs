import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { assertShipStoriesReady } from '../../lib/shipPrecheck.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const emptyFixture = join(root, 'tests/fixtures/empty-spec-dir');
const okFixture = join(root, 'tests/fixtures/spec-with-stories');

test('R1: ship stories gate rejects workspace with no stories/ subtree (mocked Tier-2 — filesystem only)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-r1-empty-'));
  try {
    cpSync(emptyFixture, dir, { recursive: true });
    const r = assertShipStoriesReady(dir, 'empty-fixture');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'R1_MISSING_STORIES_DIR');
    assert.ok(String(r.message).includes('Missing PO decomposition output'));
    assert.ok(String(r.message).includes('stories/'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R1: gate opens once at least one US-*.md exists under stories/', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-r1-ok-'));
  try {
    cpSync(okFixture, dir, { recursive: true });
    const r = assertShipStoriesReady(dir, 'with-fixture');
    assert.equal(r.ok, true);
    assert.ok(r.storyFiles?.length && r.storyFiles.length >= 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
