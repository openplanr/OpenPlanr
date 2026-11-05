import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { defaultDesignRecoveryOutput } from '../lib/design/recovery-location.mjs';

test('the default recovery file is a new path in a private PLANR_HOME folder', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'planr-recovery-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { PLANR_HOME: home };
  const first = defaultDesignRecoveryOutput(env, 1);
  assert.equal(first, join(home, 'design-recovery', 'openplanr-design-recovery-1.json'));
  assert.equal(statSync(dirname(first)).mode & 0o777, 0o700);
  chmodSync(dirname(first), 0o755);
  defaultDesignRecoveryOutput(env, 2);
  assert.equal(statSync(dirname(first)).mode & 0o777, 0o700);
});

test('an existing open recovery folder is tightened before use', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'planr-recovery-open-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, 'design-recovery'), { mode: 0o777 });
  chmodSync(join(home, 'design-recovery'), 0o777);
  defaultDesignRecoveryOutput({ PLANR_HOME: home });
  assert.equal(statSync(join(home, 'design-recovery')).mode & 0o777, 0o700);
});
