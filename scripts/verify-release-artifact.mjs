#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Smoke-tests the PACKED artifact the way a user receives it: pack, install into
 * a clean prefix with a clean HOME, and confirm the CLI starts and configures a
 * project.
 *
 * Scope is deliberately narrow. This runs before every publish, so it must be
 * deterministic on any host — no questionnaire stages, no cycle lifecycle, no
 * runtime detection. The deeper end-to-end journey lives in
 * `verify-release-journey.mjs`, which is run on demand rather than gating a
 * release: driving a full operate cycle depends on host-specific runtime
 * detection, and a flaky blocker is worse than no blocker.
 *
 * Every defect this gate exists to catch shipped through a green suite:
 *
 *   - a pipeline pin that only resolves through `node_modules`, which every test
 *     bypasses by setting OPENPLANR_PIPELINE_ROOT to a source checkout, so
 *     `planr setup` failed on every correctly-installed machine while CI passed
 *   - a first-command status line advertising a protocol two generations stale
 *
 * The common shape: each part was individually correct and the assembly was not.
 * Unit and contract tests cannot see that. This can, because it installs the
 * tarball into a clean prefix with a clean HOME and then just uses the product.
 *
 * Exit codes
 *   0  the packed artifact installs and starts correctly
 *   1  a smoke assertion failed — do not publish
 *   2  the gate itself could not run (pack/install/network) — never silently 0,
 *      because an unrunnable gate must not read as a passing one
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Thrown to end the journey early after a check has already been recorded. */
class JourneyStop extends Error {}
const failures = [];
const notes = [];

function check(description, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${description}`);
  } else {
    console.log(`  ✗ ${description}${detail ? ` — ${detail}` : ''}`);
    failures.push(description);
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

let workspace;
try {
  workspace = mkdtempSync(join(tmpdir(), 'openplanr-release-artifact-'));
  const prefix = join(workspace, 'prefix');
  const home = join(workspace, 'home');
  const project = join(workspace, 'project');
  for (const directory of [prefix, home, project]) mkdirSync(directory, { recursive: true });

  console.log('Packing the artifact…');
  const packed = run('npm', ['pack', '--pack-destination', workspace], { cwd: repositoryRoot })
    .trim()
    .split('\n')
    .pop();
  const tarball = join(workspace, packed);

  console.log(`Installing ${packed} into a clean prefix…`);
  writeFileSync(join(prefix, 'package.json'), '{"name":"release-gate","private":true}\n');
  run('npm', ['install', '--no-audit', '--no-fund', tarball], { cwd: prefix, stdio: 'pipe' });

  const cli = join(prefix, 'node_modules', '.bin', 'planr');
  // A clean HOME is the point: no plugin cache, no prior config, nothing this
  // machine happens to have that a user would not.
  const environment = { ...process.env, HOME: home, USERPROFILE: home };
  delete environment.OPENPLANR_PIPELINE_ROOT;
  delete environment.OPENPLANR_ECOSYSTEM_SOURCE;
  // Strip provider credentials. A developer machine usually has one exported and
  // CI does not, which is precisely the difference that made this gate pass
  // locally and fail in CI for five runs: `operate run` selected a structured
  // provider here and refused there. The journey must exercise the same
  // runtime-native path a user without an API key gets.
  for (const key of Object.keys(environment)) {
    if (/^(ANTHROPIC|OPENAI|GEMINI|GOOGLE|AZURE_OPENAI|OPENPLANR)_.*(KEY|TOKEN|SECRET)$/i.test(key)) {
      delete environment[key];
    }
  }

  const cliOutput = (args, options = {}) =>
    run(cli, args, { cwd: project, env: environment, ...options });

  console.log('\nJourney:');

  // Read manifests off disk rather than through require.resolve: the pipeline's
  // `exports` map deliberately does not expose ./package.json.
  const readManifest = (...segments) =>
    JSON.parse(readFileSync(join(prefix, 'node_modules', ...segments, 'package.json'), 'utf8'));
  const installedPipeline = readManifest('planr-pipeline');
  console.log(`  · installed pipeline ${installedPipeline.version}`);
  console.log(`  · OPENPLANR_PIPELINE_ROOT cleared: ${environment.OPENPLANR_PIPELINE_ROOT === undefined}`);
  // Deliberately NOT asserted here: "the resolved pipeline equals the declared
  // pin" is a tautology — npm installs exactly what the manifest declares, so it
  // can never fail and would be a green check that proves nothing. Whether the
  // declared pin is STALE relative to the released lattice is a real question,
  // and it is answered by tests/unit/pipeline-pin-parity.test.ts. What this gate
  // uniquely adds is what happens when the product is actually used.

  writeFileSync(join(project, 'package.json'), '{"name":"gate-project","version":"1.0.0"}\n');
  // Citations are anchored to a revision, so the fixture has to be a real
  // repository with a real commit — the same thing a user's project is.
  run('git', ['init', '-q'], { cwd: project });
  run('git', ['add', '-A'], { cwd: project });
  run(
    'git',
    ['-c', 'user.email=gate@example.invalid', '-c', 'user.name=Release Gate', 'commit', '-qm', 'fixture'],
    { cwd: project },
  );

  const inspect = JSON.parse(cliOutput(['operate', 'inspect', '--json']));
  check('operate inspect succeeds on a fresh project', inspect.ok === true);
  check(
    'inspect advertises the protocol the pipeline enforces, not a frozen envelope version',
    inspect.data?.pipeline?.protocolVersion === '1.4.0',
    `reported ${inspect.data?.pipeline?.protocolVersion}`,
  );

  // `setup` is the front door; it broke for every user once while CI stayed green.
  let setupExit = 0;
  try {
    cliOutput(['setup', '--yes', '--runtime', 'codex'], { stdio: 'pipe' });
  } catch (error) {
    setupExit = error.status ?? 1;
    notes.push(`setup stderr: ${String(error.stderr ?? '').slice(0, 400)}`);
  }
  check('planr setup completes on a clean machine', setupExit === 0);

  const skills = (() => {
    try {
      return readdirSync(join(home, '.codex', 'skills'));
    } catch {
      return [];
    }
  })();
  check('setup installed the runtime skills it reported', skills.length > 0, `found ${skills.length}`);
  console.log('');
} catch (error) {
  console.error(`\nRelease-artifact gate could not run: ${error.message}`);
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  process.exit(2);
}

if (workspace) rmSync(workspace, { recursive: true, force: true });
for (const note of notes) console.log(note);

if (failures.length) {
  console.error(`\n${failures.length} smoke assertion(s) failed against the packed artifact.`);
  console.error('Do not publish: the tests may pass, but the shipped artifact does not start.');
  process.exit(1);
}
console.log('The packed artifact installs and starts correctly.');
