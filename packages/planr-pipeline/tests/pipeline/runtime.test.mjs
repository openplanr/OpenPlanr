import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { resolveRuntimeAdapter, runtimeHandoff } from '../../lib/pipeline/index.mjs';

test('runtime resolution follows explicit, active, project, then only-installed precedence', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'planr-runtime-precedence-'));
  assert.equal(resolveRuntimeAdapter({ projectRoot, explicit: 'codex', active: 'claude', projectDefault: 'cursor', installed: ['codex'] }).source, 'explicit');
  assert.equal(resolveRuntimeAdapter({ projectRoot, active: 'claude', projectDefault: 'cursor', installed: ['claude-code'] }).adapter.id, 'claude-code');
  assert.equal(resolveRuntimeAdapter({ projectRoot, active: '', projectDefault: 'cursor', installed: ['codex', 'cursor'] }).adapter.id, 'cursor');
  assert.equal(resolveRuntimeAdapter({ projectRoot, active: '', installed: ['codex'] }).source, 'installed');
});

test('runtime resolution reads the active adapter marker from user state', () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-active-runtime-'));
  const projectRoot = join(home, 'project');
  const key = createHash('sha256').update(resolve(projectRoot)).digest('hex').slice(0, 16);
  mkdirSync(join(home, '.planr', 'runtime'), { recursive: true });
  writeFileSync(join(home, '.planr', 'runtime', 'state.json'), JSON.stringify({
    schemaVersion: '1.0.0',
    projects: { [key]: { projectDir: projectRoot, activeRuntime: 'codex', runtimes: ['codex'] } },
  }));
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
  assert.throws(() => resolveRuntimeAdapter({ active: '', projectDefault: '', installed: [] }), (error) => error.code === 'E_RUNTIME_NOT_FOUND');
  assert.throws(() => resolveRuntimeAdapter({ active: '', projectDefault: '', installed: ['codex', 'cursor'] }), (error) => error.code === 'E_RUNTIME_AMBIGUOUS');
});

test('an incompatible project lock blocks execution with an exact update command', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'planr-lock-drift-'));
  mkdirSync(join(projectRoot, '.planr'), { recursive: true });
  writeFileSync(join(projectRoot, '.planr', 'runtime-lock.json'), JSON.stringify({
    protocolVersion: '1.0.0',
    components: { pipeline: '0.1.0' },
    adapters: [],
  }));
  assert.throws(
    () => resolveRuntimeAdapter({ projectRoot, explicit: 'codex', installed: ['codex'] }),
    (error) => error.code === 'E_LOCK_INCOMPATIBLE' && error.fix === 'Run `planr runtime update codex --scope project`.',
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
