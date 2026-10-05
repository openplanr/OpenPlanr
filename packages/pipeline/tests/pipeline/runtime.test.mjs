import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { resolveRuntimeAdapter, runtimeHandoff } from '../../lib/pipeline/index.mjs';

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
