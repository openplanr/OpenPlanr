import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { createDaemon } from '../../lib/design-engine/daemon.mjs';

test('daemon startup prunes legacy + dead boards, keeps live tokenized ones', () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-reg-home-'));
  const liveDir = mkdtempSync(join(tmpdir(), 'planr-reg-live-'));
  const env = { PLANR_HOME: home };
  const stateDir = join(home, 'design-daemon');
  mkdirSync(stateDir, { recursive: true });
  const regPath = join(stateDir, 'boards.json');

  const TOKEN = 'a'.repeat(24);
  writeFileSync(regPath, `${JSON.stringify({
    'legacy-slug': liveDir, // pre-token (no --token), live dir → pruned as legacy
    [`dead--${TOKEN}`]: join(tmpdir(), 'planr-reg-gone-nonexistent'), // tokenized but dir gone → pruned
    [`live--${TOKEN}`]: liveDir, // tokenized + live dir → kept
  }, null, 2)}\n`);

  try {
    // The prune runs synchronously inside createDaemon (no listen needed).
    createDaemon({ env });
    const reg = JSON.parse(readFileSync(regPath, 'utf-8'));
    assert.deepEqual(
      Object.keys(reg),
      [`live--${TOKEN}`],
      'only the live, tokenized board survives the startup prune',
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(liveDir, { recursive: true, force: true });
  }
});
