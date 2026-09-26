import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { acquireStartLock } from '../lib/artifact/internal/server-util.mjs';

test('startup lock serializes simultaneous writers without shared-path unlink races', async () => {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-start-lock-'));
  const lock = join(root, 'daemon.lock');
  const entered = [];
  let releaseFirst;
  try {
    const firstUnlock = await acquireStartLock(lock);
    entered.push('first');
    const second = (async () => {
      const unlock = await acquireStartLock(lock);
      entered.push('second');
      unlock();
    })();
    await new Promise((resolve) => {
      releaseFirst = () => {
        firstUnlock();
        resolve();
      };
      setTimeout(releaseFirst, 40);
    });
    await second;
    assert.deepEqual(entered, ['first', 'second']);
  } finally {
    releaseFirst?.();
    rmSync(root, { recursive: true, force: true });
  }
});

test('startup lock reclaims only uniquely named dead writer records', async () => {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-dead-start-lock-'));
  const lock = join(root, 'daemon.lock');
  const writers = `${lock}.writers`;
  try {
    const unlock = await acquireStartLock(lock);
    unlock();
    const dead = join(writers, `2147483647-${'a'.repeat(32)}.json`);
    writeFileSync(dead, JSON.stringify({ pid: 2147483647, owner: 'a'.repeat(32), ticket: 1 }));
    const next = await acquireStartLock(lock, { isAlive: (pid) => pid !== 2147483647 });
    assert.equal(existsSync(dead), false);
    next();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('startup lock preserves legacy shared records instead of racing their replacement', async () => {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-legacy-start-lock-'));
  const lock = join(root, 'daemon.lock');
  const record = JSON.stringify({ pid: 2147483647, owner: 'legacy', createdAt: 0 });
  try {
    writeFileSync(lock, record);
    await assert.rejects(acquireStartLock(lock), { code: 'E_START_LOCK_LEGACY' });
    assert.equal(readFileSync(lock, 'utf8'), record);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
