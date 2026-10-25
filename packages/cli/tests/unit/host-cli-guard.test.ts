import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const guardModule = resolve('tests/setup/host-cli-guard.mjs');
const vitestBin = join(
  dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs',
);
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function markerHost(directory: string, name: string, marker: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), `#!/bin/sh\nprintf ran > '${marker}'\necho 1.0.0\n`, {
    mode: 0o755,
  });
}

describe.skipIf(process.platform === 'win32')('host CLI guard', () => {
  it('is active in CLI test workers and their Node children', () => {
    expect(process.env.OPENPLANR_TEST_HOST_GUARD_LOG).toBeTruthy();
    expect(process.env.NODE_OPTIONS ?? '').toContain('host-cli-guard.mjs');
  });

  it('blocks a host CLI outside the stub root in children and grandchildren', () => {
    const root = mkdtempSync(join(tmpdir(), 'openplanr-host-guard-'));
    roots.push(root);
    const stubs = join(root, 'stubs');
    const real = join(root, 'real');
    markerHost(stubs, 'claude', join(root, 'stub.ran'));
    markerHost(real, 'claude', join(root, 'real.ran'));
    markerHost(real, 'codex', join(root, 'real-codex.ran'));
    const log = join(root, 'guard.log');
    const script = `
      import { execFile, spawnSync } from 'node:child_process';
      import { promisify } from 'node:util';
      const real = spawnSync('claude', ['--version'], { env: { ...process.env, PATH: ${JSON.stringify(real)} } });
      const stub = spawnSync('claude', ['--version'], { encoding: 'utf8', env: { ...process.env, PATH: ${JSON.stringify(stubs)} } });
      const grandchild = spawnSync(process.execPath, ['--input-type=module', '-e', "import { spawnSync } from 'node:child_process'; process.exit(spawnSync('codex', ['--version']).error?.code === 'ENOENT' ? 0 : 3);"], { env: { ...process.env, PATH: ${JSON.stringify(real)} } });
      const promised = await promisify(execFile)('claude', ['--version'], { env: { ...process.env, PATH: ${JSON.stringify(stubs)} } });
      console.log(JSON.stringify({ real: real.error?.code, stub: stub.stdout.trim(), grandchild: grandchild.status, promised: promised.stdout.trim() }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENPLANR_TEST_HOST_GUARD_LOG: log,
        OPENPLANR_TEST_HOST_GUARD_ROOT: stubs,
        NODE_OPTIONS: `--import=${pathToFileURL(guardModule).href}`,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      real: 'ENOENT',
      stub: '1.0.0',
      grandchild: 0,
      promised: '1.0.0',
    });
    expect(existsSync(join(root, 'real.ran'))).toBe(false);
    expect(existsSync(join(root, 'real-codex.ran'))).toBe(false);
    expect(existsSync(join(root, 'stub.ran'))).toBe(true);
    const violations = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { command: string; resolved: string });
    expect(violations.map(({ command, resolved }) => [command, resolved])).toEqual([
      ['claude', join(real, 'claude')],
      ['codex', join(real, 'codex')],
    ]);
  });

  it('fails a vitest test that reaches a real host CLI', () => {
    const root = mkdtempSync(join(tmpdir(), 'openplanr-host-guard-run-'));
    roots.push(root);
    const real = join(root, 'real');
    markerHost(real, 'codex', join(root, 'real.ran'));
    mkdirSync(join(root, 'stubs'));
    const testFile = join(root, 'reaches-host.test.ts');
    writeFileSync(
      testFile,
      `import { spawnSync } from 'node:child_process';\nimport { it } from 'vitest';\nit('probes', () => { spawnSync('codex', ['--version']); });\n`,
    );
    writeFileSync(
      join(root, 'vitest.config.mjs'),
      `export default { test: { setupFiles: [${JSON.stringify(resolve('tests/setup/isolate-user-state.ts'))}] } };\n`,
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${real}:${process.env.PATH}`,
      OPENPLANR_TEST_HOST_GUARD_ROOT: join(root, 'stubs'),
    };
    for (const name of [
      'OPENPLANR_TEST_ISOLATED_HOME',
      'OPENPLANR_TEST_HOST_GUARD_LOG',
      'NODE_OPTIONS',
      'VITEST',
      'VITEST_POOL_ID',
      'VITEST_WORKER_ID',
    ])
      delete env[name];
    const result = spawnSync(process.execPath, [vitestBin, 'run', 'reaches-host'], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/Tests spawned 1 real host CLI process\(es\)/);
    expect(existsSync(join(root, 'real.ran'))).toBe(false);
  }, 60_000);
});
