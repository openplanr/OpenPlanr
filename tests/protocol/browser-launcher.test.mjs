import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  BROWSER_LAUNCH_TIMEOUT_MS,
  browserLaunchOptions,
  launchBrowser,
} from '../support/browser-launcher.mjs';

test('browser launches are bounded below the shortest browser test timeout', () => {
  assert.equal(browserLaunchOptions().timeout, BROWSER_LAUNCH_TIMEOUT_MS);
  assert.ok(BROWSER_LAUNCH_TIMEOUT_MS < 30_000);
  assert.equal(browserLaunchOptions({ timeout: 5_000 }).timeout, 5_000);
});

// Playwright keeps the process alive about 30 s after a launch timeout, so this runs nightly.
test('a browser that never starts fails its launch quickly with a named error', {
  skip:
    (process.env.PLANR_STUCK_LAUNCH_TEST !== '1' && 'set PLANR_STUCK_LAUNCH_TEST=1 to run') ||
    (process.platform === 'win32' && 'uses a POSIX shell script as the stuck browser'),
  timeout: 15_000,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-stuck-browser-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const executablePath = join(root, 'stuck-browser');
  writeFileSync(executablePath, '#!/bin/sh\nexec sleep 600\n');
  chmodSync(executablePath, 0o755);

  const started = Date.now();
  await assert.rejects(
    launchBrowser({ engine: 'chromium', executablePath, timeout: 1_500 }),
    (error) => {
      assert.match(
        error.message,
        /^Could not launch chromium at .*stuck-browser: .*Timeout 1500ms exceeded/u,
      );
      return true;
    },
  );
  assert.ok(Date.now() - started < 5_000, `launch failed after ${Date.now() - started} ms`);
});
