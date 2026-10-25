import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  detectInstalledRuntimes,
  resolveRuntimeAdapter,
  runtimeHandoff,
} from '../../lib/pipeline/index.mjs';

test('runtime probes are bounded and retain a timed-out executable as present', () => {
  const calls = [];
  const installed = detectInstalledRuntimes((command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'claude') return { status: 0 };
    if (command === 'cursor') return { status: null, error: { code: 'ETIMEDOUT' } };
    return { status: null, error: { code: 'ENOENT' } };
  });
  assert.deepEqual(installed, ['claude-code', 'cursor']);
  assert.equal(calls.length, 3);
  for (const { args, options } of calls) {
    assert.deepEqual(args, ['--version']);
    assert.equal(options.timeout, 5_000);
    assert.equal(options.killSignal, 'SIGKILL');
  }
});

test('a non-returning version process cannot ignore the probe deadline', () => {
  const runtime = new URL('../../lib/pipeline/runtime.mjs', import.meta.url).href;
  const source = `
    import { spawnSync } from 'node:child_process';
    import { commandExists } from ${JSON.stringify(runtime)};
    const present = commandExists(process.execPath, (command, args, options) =>
      spawnSync(command, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], options));
    console.log(JSON.stringify({ present }));
  `;
  const started = Date.now();
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8',
    timeout: 10_000,
    killSignal: 'SIGKILL',
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.deepEqual(JSON.parse(result.stdout), { present: true });
  assert.ok(Date.now() - started < 9_000, 'probe must finish before the outer guard');
});

test('selected runtime discovery reports a stalled version and ignores unrelated hosts', {
  skip: process.platform === 'win32',
}, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'planr-probe-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const marker = join(root, 'cursor-called');
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\necho test-codex\n', { mode: 0o755 });
  writeFileSync(
    join(bin, 'cursor'),
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'called');\nprocess.on('SIGTERM', () => {});\nsetInterval(() => {}, 1000);\n`,
    { mode: 0o755 },
  );
  const runtime = new URL('../../lib/pipeline/runtime.mjs', import.meta.url).href;
  const run = (id) =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
    import { resolveRuntimeAdapter } from ${JSON.stringify(runtime)};
    console.log(JSON.stringify(resolveRuntimeAdapter({ projectRoot: ${JSON.stringify(root)}, explicit: ${JSON.stringify(id)}, strictRuntimeLock: false })));
  `,
      ],
      {
        encoding: 'utf8',
        timeout: 10_000,
        killSignal: 'SIGKILL',
        env: { ...process.env, PATH: [bin, process.env.PATH].join(delimiter) },
      },
    );
  const codex = run('codex');
  assert.equal(codex.status, 0, codex.stderr);
  assert.equal(JSON.parse(codex.stdout).installed, true);
  assert.throws(() => readFileSync(marker), { code: 'ENOENT' });
  mkdirSync(join(root, '.planr'));
  writeFileSync(
    join(root, '.planr/runtime-lock.json'),
    JSON.stringify({
      ...compatibleLock(),
      components: { ...compatibleLock().components, pipeline: '0.1.0' },
    }),
  );
  const cursor = run('cursor');
  assert.equal(cursor.status, 0, cursor.stderr || cursor.error?.message);
  const resolved = JSON.parse(cursor.stdout);
  assert.equal(resolved.installed, true);
  assert.deepEqual(
    resolved.diagnostics.map(({ code }) => code),
    ['E_RUNTIME_PROBE_TIMEOUT', 'E_LOCK_INCOMPATIBLE'],
  );
  assert.match(resolved.diagnostics[0].problem, /cursor --version.*5000ms.*version is unknown/u);
  assert.equal(readFileSync(marker, 'utf8'), 'called');
});

test('the Pipeline test runner shadows ambient coding-host executables', {
  skip: process.platform === 'win32',
}, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'planr-test-hosts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'ambient-bin');
  mkdirSync(bin);
  const marker = join(root, 'ambient-called');
  for (const host of ['claude', 'codex', 'cursor'])
    writeFileSync(
      join(bin, host),
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'called');\nprocess.exit(99);\n`,
      { mode: 0o755 },
    );
  const fixture = join(root, 'probe.test.mjs');
  writeFileSync(
    fixture,
    `
    import assert from 'node:assert/strict';
    import { spawnSync } from 'node:child_process';
    import { test } from 'node:test';
    test('isolated host versions', () => {
      for (const host of ['claude', 'codex', 'cursor']) {
        const result = spawnSync(host, ['--version'], { encoding: 'utf8' });
        assert.equal(result.status, 0);
        assert.match(result.stdout, /OpenPlanr test host/);
      }
    });
  `,
  );
  const runner = new URL('../../scripts/run-test-group.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [fileURLToPath(runner), fixture], {
    encoding: 'utf8',
    timeout: 10_000,
    killSignal: 'SIGKILL',
    env: { ...process.env, PATH: [bin, process.env.PATH].join(delimiter) },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.throws(() => readFileSync(marker), { code: 'ENOENT' });
});

const registry = JSON.parse(
  readFileSync(new URL('../../registry/adapters.json', import.meta.url), 'utf8'),
);
function compatibleLock() {
  const adapter = registry.adapters.find(({ id }) => id === 'codex');
  return {
    schemaVersion: '1.0.0',
    generatedAt: '2026-10-04T10:00:00Z',
    manifestDigest: `sha256:${'a'.repeat(64)}`,
    protocolVersion: registry.protocolVersion,
    components: { cli: '2.2640.7', pipeline: registry.pipelineVersion, skills: '2.2640.7' },
    adapters: [
      {
        runtime: adapter.id,
        version: adapter.version,
        capabilityLevel: adapter.capabilityLevel,
        installScope: 'project',
      },
    ],
  };
}

test('runtime resolution follows explicit, active, project, then only-installed precedence', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'planr-runtime-precedence-'));
  assert.equal(
    resolveRuntimeAdapter({
      projectRoot,
      explicit: 'codex',
      active: 'claude',
      projectDefault: 'cursor',
      installed: ['codex'],
    }).source,
    'explicit',
  );
  assert.equal(
    resolveRuntimeAdapter({
      projectRoot,
      active: 'claude',
      projectDefault: 'cursor',
      installed: ['claude-code'],
    }).adapter.id,
    'claude-code',
  );
  assert.equal(
    resolveRuntimeAdapter({
      projectRoot,
      active: '',
      projectDefault: 'cursor',
      installed: ['codex', 'cursor'],
    }).adapter.id,
    'cursor',
  );
  assert.equal(
    resolveRuntimeAdapter({ projectRoot, active: '', installed: ['codex'] }).source,
    'installed',
  );
});

test('runtime resolution reads the active adapter marker from user state', () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-active-runtime-'));
  const projectRoot = join(home, 'project');
  const key = createHash('sha256').update(resolve(projectRoot)).digest('hex').slice(0, 16);
  mkdirSync(join(home, '.planr', 'runtime'), { recursive: true });
  writeFileSync(
    join(home, '.planr', 'runtime', 'state.json'),
    JSON.stringify({
      schemaVersion: '1.0.0',
      projects: { [key]: { projectDir: projectRoot, activeRuntime: 'codex', runtimes: ['codex'] } },
    }),
  );
  const before = process.env.OPENPLANR_HOME;
  process.env.OPENPLANR_HOME = home;
  try {
    const resolved = resolveRuntimeAdapter({ projectRoot, installed: ['codex', 'cursor'] });
    assert.equal(resolved.source, 'active');
    assert.equal(resolved.adapter.id, 'codex');
  } finally {
    if (before === undefined) delete process.env.OPENPLANR_HOME;
    else process.env.OPENPLANR_HOME = before;
  }
});

test('runtime resolution names ambiguity and missing-runtime errors', () => {
  assert.throws(
    () => resolveRuntimeAdapter({ active: '', projectDefault: '', installed: [] }),
    (error) => error.code === 'E_RUNTIME_NOT_FOUND',
  );
  assert.throws(
    () => resolveRuntimeAdapter({ active: '', projectDefault: '', installed: ['codex', 'cursor'] }),
    (error) => error.code === 'E_RUNTIME_AMBIGUOUS',
  );
});

test('an incompatible project lock blocks execution with an exact update command', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'planr-lock-drift-'));
  mkdirSync(join(projectRoot, '.planr'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.planr', 'runtime-lock.json'),
    JSON.stringify({
      ...compatibleLock(),
      protocolVersion: '1.0.0',
      components: { ...compatibleLock().components, pipeline: '0.1.0' },
      adapters: [],
    }),
  );
  assert.throws(
    () => resolveRuntimeAdapter({ projectRoot, explicit: 'codex', installed: ['codex'] }),
    (error) =>
      error.code === 'E_LOCK_INCOMPATIBLE' &&
      error.fix === 'Run `openplanr runtime update codex --scope project`.',
  );
});

test('ordinary runtime resolution reports a stale lock without blocking the handoff', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'planr-lock-diagnostic-'));
  mkdirSync(join(projectRoot, '.planr'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.planr', 'runtime-lock.json'),
    JSON.stringify({
      ...compatibleLock(),
      protocolVersion: '1.0.0',
      components: { ...compatibleLock().components, pipeline: '0.1.0' },
      adapters: [],
    }),
  );

  const resolved = resolveRuntimeAdapter({
    projectRoot,
    explicit: 'codex',
    installed: ['codex'],
    strictRuntimeLock: false,
  });
  assert.equal(resolved.adapter.id, 'codex');
  assert.equal(resolved.diagnostics.length, 1);
  assert.equal(resolved.diagnostics[0].code, 'E_LOCK_INCOMPATIBLE');
  assert.match(resolved.diagnostics[0].fix, /planr runtime update codex/u);
});

test('runtime dispatch reads legacy locks and supported discovery modes', (context) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'planr-lock-modes-'));
  context.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  mkdirSync(join(projectRoot, '.planr'));
  const target = join(projectRoot, '.planr', 'runtime-lock.json');
  for (const skillModes of [undefined, { codex: 'direct' }, { codex: 'project-rule' }]) {
    writeFileSync(
      target,
      JSON.stringify({ ...compatibleLock(), ...(skillModes ? { skillModes } : {}) }),
    );
    assert.equal(
      resolveRuntimeAdapter({ projectRoot, explicit: 'codex', installed: ['codex'] }).adapter.id,
      'codex',
    );
  }
});

test('runtime dispatch rejects malformed discovery modes before resolving the adapter', (context) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'planr-lock-invalid-mode-'));
  context.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  mkdirSync(join(projectRoot, '.planr'));
  writeFileSync(
    join(projectRoot, '.planr', 'runtime-lock.json'),
    JSON.stringify({ ...compatibleLock(), skillModes: { codex: 'plugin' } }),
  );
  assert.throws(
    () => resolveRuntimeAdapter({ projectRoot, explicit: 'codex', installed: ['codex'] }),
    (error) => error.code === 'E_LOCK_INVALID' && error.message.includes('skillModes.codex'),
  );
});

test('Cursor produces a machine-readable handoff', () => {
  const { adapter } = resolveRuntimeAdapter({ explicit: 'cursor', installed: ['cursor'] });
  assert.deepEqual(runtimeHandoff(adapter, 'plan', 'auth'), {
    ok: false,
    action: 'runtime_required',
    runtime: 'cursor',
    executionMode: 'handoff',
    command: 'Open Cursor and invoke plan auth',
    code: 'E_RUNTIME_HANDOFF_REQUIRED',
  });
});
