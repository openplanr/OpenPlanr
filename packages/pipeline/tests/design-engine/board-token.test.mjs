import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { ensureBoardToken, publicBoardId } from '../../lib/design-engine/board-token.mjs';

test('board token: unguessable, stable per dir, unique across dirs, off the repo tree', () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-tok-home-'));
  const env = { PLANR_HOME: home };
  const dirA = mkdtempSync(join(tmpdir(), 'planr-tok-a-'));
  const dirB = mkdtempSync(join(tmpdir(), 'planr-tok-b-'));
  try {
    const tA = ensureBoardToken(dirA, { env });
    assert.match(tA, /^[a-f0-9]{16,}$/, 'token is lowercase hex, >=16 chars');

    // stable: the same dir always resolves to the same token
    assert.equal(ensureBoardToken(dirA, { env }), tA, 'token is stable for the same dir');

    // unique: a different dir gets a different token (no shared/guessable value)
    assert.notEqual(ensureBoardToken(dirB, { env }), tA, 'different dirs get different tokens');

    // persisted under planrHome's daemon dir, NOT inside the board dir (no repo leak)
    assert.ok(existsSync(join(home, 'design-daemon', 'tokens.json')), 'token store lives under planrHome');
    assert.ok(!readdirSync(dirA).includes('.board-token'), 'no token file is written into the board dir');
  } finally {
    for (const d of [home, dirA, dirB]) rmSync(d, { recursive: true, force: true });
  }
});

test('publicBoardId is slug--token (capability URL key)', () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-tok-home-'));
  const env = { PLANR_HOME: home };
  const dir = mkdtempSync(join(tmpdir(), 'planr-tok-d-'));
  try {
    const id = publicBoardId('feat-checkout', dir, { env });
    const token = ensureBoardToken(dir, { env });
    assert.equal(id, `feat-checkout--${token}`, 'id = slug + "--" + token');
    assert.match(id, /^feat-checkout--[a-f0-9]{16,}$/);
  } finally {
    for (const d of [home, dir]) rmSync(d, { recursive: true, force: true });
  }
});
