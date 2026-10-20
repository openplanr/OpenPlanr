import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Browser } from '@playwright/test';

export function benchMetadata(browser: Browser, name: 'chromium' | 'webkit' | 'firefox') {
  const commit = (
    process.env.GITHUB_SHA ??
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: import.meta.dirname,
      encoding: 'utf8',
    })
  ).trim();
  if (!commit) throw new Error('Canvas build.commit is empty (GITHUB_SHA or git rev-parse HEAD)');
  const manifest: unknown = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('version' in manifest) ||
    typeof manifest.version !== 'string' ||
    !manifest.version
  )
    throw new TypeError('Canvas build.packageVersion is missing from package.json');
  return {
    browser: { name, version: browser.version() },
    gpuMode: process.env.CANVAS_GPU_MODE ?? 'software',
    build: { commit, packageVersion: manifest.version },
  };
}
