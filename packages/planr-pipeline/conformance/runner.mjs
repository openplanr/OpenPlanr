#!/usr/bin/env node
/**
 * OpenPlanr Protocol Conformance Test Runner (v1.0.0)
 *
 * Runtime-agnostic state-checker for the `feat-todo` fixture. The operator
 * drives the actual runtime (Claude Code, Cursor, or Codex); this script
 * verifies the produced state against `expected/*.json`.
 *
 * Usage:
 *   node runner.mjs --runtime <claude-code|cursor|codex> --setup
 *   node runner.mjs --runtime <runtime> --verify-po --dir <project-dir>
 *   node runner.mjs --runtime <runtime> --verify-ship --dir <project-dir>
 *
 * Exit code:
 *   0 — all assertions passed
 *   non-zero — at least one assertion failed (the failing one is logged)
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALID_RUNTIMES = new Set(['claude-code', 'cursor', 'codex']);

// ── arg parsing ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return null;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

const runtime = flag('runtime');
const wantSetup = flag('setup') === true;
const wantVerifyPO = flag('verify-po') === true;
const wantVerifyShip = flag('verify-ship') === true;
const projectDir = typeof flag('dir') === 'string' ? flag('dir') : null;

if (!runtime || !VALID_RUNTIMES.has(runtime)) {
  console.error(
    'Usage: node runner.mjs --runtime <claude-code|cursor|codex> [--setup | --verify-po --dir <dir> | --verify-ship --dir <dir>]',
  );
  process.exit(2);
}

// ── helpers ─────────────────────────────────────────────────────────────
const log = (...a) => console.log(...a);
const pass = (label) => log(`  ✓ ${label}`);
const fail = (label, detail) => {
  log(`  ✗ ${label}`);
  if (detail) log(`    ${detail}`);
};

let failures = 0;

const assertExists = (label, path) => {
  if (existsSync(path)) {
    pass(`${label} (${path})`);
  } else {
    fail(`${label} (missing: ${path})`);
    failures++;
  }
};

const assertNotExists = (label, path) => {
  if (!existsSync(path)) {
    pass(`${label} (correctly absent: ${path})`);
  } else {
    fail(`${label} (should not exist but does: ${path})`);
    failures++;
  }
};

const readFrontmatter = (path) => {
  const raw = readFileSync(path, 'utf-8');
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const lm = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (lm) fm[lm[1]] = lm[2].replace(/^"(.*)"$/, '$1');
  }
  return fm;
};

const globMatch = (dir, pattern) => {
  if (!existsSync(dir)) return [];
  const re = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
  return readdirSync(dir).filter((f) => re.test(f));
};

// ── setup mode ──────────────────────────────────────────────────────────
if (wantSetup) {
  const dir = mkdtempSync(join(tmpdir(), `openplanr-conformance-${runtime}-`));
  log(`✓ Setting up fixture for runtime: ${runtime}`);
  log(`  Temp dir: ${dir}`);

  // Copy fixture
  mkdirSync(join(dir, 'input', 'tech'), { recursive: true });
  mkdirSync(join(dir, '.planr', 'specs', 'SPEC-001-todo-feature', 'design'), { recursive: true });
  mkdirSync(join(dir, '.planr', 'specs', 'SPEC-001-todo-feature', 'stories'), { recursive: true });
  mkdirSync(join(dir, '.planr', 'specs', 'SPEC-001-todo-feature', 'tasks'), { recursive: true });

  writeFileSync(
    join(dir, '.planr', 'config.json'),
    JSON.stringify(
      {
        projectName: 'todo-feature-conformance',
        outputPaths: { agile: '.planr' },
        idPrefix: { spec: 'SPEC' },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(dir, '.planr', 'specs', 'SPEC-001-todo-feature', 'SPEC-001-todo-feature.md'),
    readFileSync(join(__dirname, 'fixture-spec', 'SPEC-001-todo-feature.md'), 'utf-8'),
  );
  writeFileSync(
    join(dir, 'input', 'tech', 'stack.md'),
    readFileSync(join(__dirname, 'fixture-stack', 'stack.md'), 'utf-8'),
  );

  // Initialize git for the Preserve-violation check
  try {
    execSync('git init -q', { cwd: dir });
    execSync('git add -A && git -c user.email=x@x -c user.name=x commit -q -m "fixture baseline"', {
      cwd: dir,
    });
    pass('Git baseline initialized for Preserve check');
  } catch (e) {
    fail('Git init failed', e.message);
  }

  log('');
  log('Next steps:');
  log(`  1. cd ${dir}`);
  log(`  2. Open the project in your runtime (${runtime})`);
  if (runtime === 'claude-code') {
    log('  3. Run: /openplanr-pipeline:plan todo-feature');
  } else {
    log('  3. Say: "plan todo-feature"');
  }
  log(`  4. node ${__dirname}/runner.mjs --runtime ${runtime} --verify-po --dir ${dir}`);
  if (runtime === 'claude-code') {
    log('  5. Run: /openplanr-pipeline:ship todo-feature');
  } else {
    log('  5. Say: "ship todo-feature"');
  }
  log(`  6. node ${__dirname}/runner.mjs --runtime ${runtime} --verify-ship --dir ${dir}`);
  log('');
  log(`DIR=${dir}`);
  process.exit(0);
}

if (!projectDir) {
  console.error('--verify-po and --verify-ship require --dir <project-dir>');
  process.exit(2);
}

const root = resolve(projectDir);
const specDir = join(root, '.planr', 'specs', 'SPEC-001-todo-feature');

// ── verify-po mode ──────────────────────────────────────────────────────
if (wantVerifyPO) {
  log(`\nVerifying PO state in ${root} (runtime: ${runtime})\n`);

  assertExists('spec dir exists', specDir);
  assertExists('stories/ subdir', join(specDir, 'stories'));
  assertExists('tasks/ subdir', join(specDir, 'tasks'));

  const stories = globMatch(join(specDir, 'stories'), 'US-.*\\.md');
  const tasks = globMatch(join(specDir, 'tasks'), 'T-.*\\.md');

  if (stories.length === 1) {
    pass(`exactly 1 story (got ${stories.length}: ${stories[0]})`);
  } else {
    fail(`expected 1 story, got ${stories.length}`);
    failures++;
  }

  if (tasks.length === 1) {
    pass(`exactly 1 task (got ${tasks.length}: ${tasks[0]})`);
    const taskFm = readFrontmatter(join(specDir, 'tasks', tasks[0]));
    if (taskFm?.type === 'Tech') {
      pass(`task type is Tech (got: ${taskFm.type})`);
    } else {
      fail(`task type expected Tech, got: ${taskFm?.type}`);
      failures++;
    }
    if (taskFm?.agent === 'backend-agent') {
      pass(`task agent is backend-agent (got: ${taskFm.agent})`);
    } else {
      fail(`task agent expected backend-agent, got: ${taskFm?.agent}`);
      failures++;
    }
  } else {
    fail(`expected 1 task, got ${tasks.length}`);
    failures++;
  }

  assertNotExists('no design-spec.md (no PNGs)', join(specDir, 'design', 'design-spec.md'));
  assertNotExists('no error-report.md after PO', join(specDir, 'tasks', 'error-report.md'));
  assertNotExists('no .pipeline-shipped marker after PO (R1)', join(specDir, '.pipeline-shipped'));

  log(`\n${failures === 0 ? '✓ PO state conforms.' : `✗ ${failures} PO assertion(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

// ── verify-ship mode ────────────────────────────────────────────────────
if (wantVerifyShip) {
  log(`\nVerifying SHIP state in ${root} (runtime: ${runtime})\n`);

  assertExists('source file (src/todo.ts)', join(root, 'src', 'todo.ts'));
  const testGlob = globMatch(join(root, 'tests'), 'todo.*\\.test\\.ts');
  if (testGlob.length >= 1) {
    pass(`test file(s) present: ${testGlob.join(', ')}`);
  } else {
    fail('expected at least one tests/todo*.test.ts');
    failures++;
  }

  // Run build
  try {
    execSync('npx tsc --noEmit', { cwd: root, stdio: 'pipe' });
    pass('npx tsc --noEmit exits 0');
  } catch (e) {
    fail('npx tsc --noEmit failed', e.message.split('\n').slice(0, 3).join(' / '));
    failures++;
  }

  // Run tests (best-effort — Vitest may not be installed; surface as info if missing)
  try {
    execSync('npx vitest run', { cwd: root, stdio: 'pipe' });
    pass('npx vitest run exits 0');
  } catch (e) {
    fail('npx vitest run failed', e.message.split('\n').slice(0, 3).join(' / '));
    failures++;
  }

  // Marker
  const markerPath = join(specDir, '.pipeline-shipped');
  assertExists('.pipeline-shipped marker', markerPath);

  if (existsSync(markerPath)) {
    const raw = readFileSync(markerPath, 'utf-8');
    const required = [
      'shipped_at',
      'pipeline_version',
      'runtime',
      'mode',
      'feature',
      'tasks_executed',
      'qa_gate_status',
    ];
    for (const field of required) {
      if (new RegExp(`^${field}:`, 'm').test(raw)) {
        pass(`marker has ${field}`);
      } else {
        fail(`marker missing required field: ${field}`);
        failures++;
      }
    }
    // Check runtime field matches
    const m = raw.match(/^runtime:\s*"?([a-z-]+)"?/m);
    if (m && m[1] === runtime) {
      pass(`marker runtime field matches CLI flag (${runtime})`);
    } else {
      fail(`marker runtime expected ${runtime}, got: ${m?.[1] || '(missing)'}`);
      failures++;
    }
  }

  // QA report
  assertExists('qa-report.md', join(specDir, 'qa-report.md'));
  assertNotExists('no error-report.md (happy path)', join(specDir, 'tasks', 'error-report.md'));

  // Anti-check: Preserve violations via git diff against baseline
  // The fixture's baseline commit was created in --setup. Files modified must NOT include any in a task's Preserve list.
  try {
    const taskFiles = globMatch(join(specDir, 'tasks'), 'T-.*\\.md');
    const preserveLists = [];
    for (const t of taskFiles) {
      const body = readFileSync(join(specDir, 'tasks', t), 'utf-8');
      const m = body.match(/##\s*Files\s*[—\-]?\s*Preserve[\s\S]*?(?=\n##|$)/i);
      if (m) {
        for (const line of m[0].split('\n')) {
          const lm = line.match(/^[\s\-*]*`?([^`\s]+\.[a-z0-9]+)`?/);
          if (lm) preserveLists.push(lm[1]);
        }
      }
    }
    const diffed = execSync('git diff --name-only HEAD', { cwd: root, encoding: 'utf-8' })
      .split('\n')
      .filter(Boolean);
    const violations = diffed.filter((f) => preserveLists.includes(f));
    if (violations.length === 0) {
      pass(`no Preserve files were modified (${preserveLists.length} on Preserve list)`);
    } else {
      fail(`Preserve violations: ${violations.join(', ')}`);
      failures++;
    }
  } catch (e) {
    log(`  ⚠ Preserve check skipped (git not available): ${e.message.split('\n')[0]}`);
  }

  // Anti-check: no ${CLAUDE_PLUGIN_ROOT} leak in Cursor/Codex generated files
  if (runtime !== 'claude-code') {
    const candidates = [
      join(root, '.cursor', 'rules'),
      join(root, 'AGENTS.md'),
    ];
    let leak = false;
    for (const c of candidates) {
      if (!existsSync(c)) continue;
      try {
        const out = execSync(
          `grep -r '\\$\\{CLAUDE_PLUGIN_ROOT\\}' "${c}" 2>/dev/null || true`,
          { encoding: 'utf-8' },
        );
        if (out.trim()) {
          leak = true;
          fail(`\${CLAUDE_PLUGIN_ROOT} leaked into ${c}`);
          failures++;
        }
      } catch {
        // grep returns non-zero on no match; ignore
      }
    }
    if (!leak) pass('no ${CLAUDE_PLUGIN_ROOT} leak in generated rule files');
  }

  log(`\n${failures === 0 ? '✓ SHIP state conforms.' : `✗ ${failures} SHIP assertion(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

console.error('Pick exactly one of: --setup, --verify-po, --verify-ship');
process.exit(2);
