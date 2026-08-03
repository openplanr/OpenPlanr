import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

const previousStateRoot = process.env.OPENPLANR_STATE_ROOT;
const isolatedStateRoot = mkdtempSync(join(tmpdir(), 'openplanr-vitest-state-'));

chmodSync(isolatedStateRoot, 0o700);
process.env.OPENPLANR_STATE_ROOT = isolatedStateRoot;

afterAll(() => {
  if (previousStateRoot === undefined) {
    delete process.env.OPENPLANR_STATE_ROOT;
  } else {
    process.env.OPENPLANR_STATE_ROOT = previousStateRoot;
  }
  rmSync(isolatedStateRoot, { recursive: true, force: true });
});
