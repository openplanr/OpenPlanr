import * as fs from 'node:fs/promises';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanyAuthStore } from '../../src/services/company-auth-store.js';

const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, lstat: vi.fn(original.lstat), readFile: vi.fn(original.readFile) };
});

let directory: string;
let lock: string;

beforeEach(async () => {
  directory = path.join(await mkdtemp(path.join(tmpdir(), 'company-auth-lock-')), 'auth');
  lock = path.join(directory, '.lock');
});

afterEach(async () => {
  vi.mocked(fs.lstat).mockImplementation(actual.lstat);
  vi.mocked(fs.readFile).mockImplementation(actual.readFile);
  await rm(path.dirname(directory), { recursive: true, force: true });
});

/** Holds the lock for a live process, then releases it just before `method` inspects it. */
async function releaseDuringInspection(method: 'lstat' | 'readFile'): Promise<void> {
  const store = new CompanyAuthStore(directory);
  await store.locked(async () => undefined);
  await writeFile(
    lock,
    JSON.stringify({ pid: process.pid, nonce: '00000000-0000-4000-8000-000000000000' }),
  );
  let released = false;
  const original = actual[method] as (...args: unknown[]) => Promise<unknown>;
  vi.mocked(fs[method]).mockImplementation((async (target: unknown, ...rest: unknown[]) => {
    if (!released && target === lock) {
      released = true;
      await actual.unlink(lock);
    }
    return original(target, ...rest);
  }) as never);
  await expect(store.locked(async () => 'acquired')).resolves.toBe('acquired');
  expect(released).toBe(true);
}

describe('company auth lock', () => {
  it('retries when the holder releases the lock before it is inspected', async () => {
    await releaseDuringInspection('lstat');
  });

  it('retries when the holder releases the lock before its owner is read', async () => {
    await releaseDuringInspection('readFile');
  });
});
