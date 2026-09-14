import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../src/services/config-service.js';

/**
 * FR5/FR6 Trap-A proof: the offer, its escalating snooze, and its permanent
 * never-ask are exercised through *real* `planr` subprocesses that read and
 * write an on-disk `upgrade-state.json` — not an in-memory fixture — and the
 * offer/snooze/never-ask state is proven to persist across two separate process
 * invocations. The CLI source is run through the `tsx` loader so the test always
 * exercises the current wiring without a build step.
 */

const repoRoot = resolve('.');
const cliEntry = join(repoRoot, 'src', 'cli', 'index.ts');
const OFFER_MARKER = 'An OpenPlanr upgrade is available';
const COMMAND_MARKER = 'Planr Configuration'; // `planr config show`'s own heading

let root: string;
let projectRoot: string;
let ecosystemFixture: string;
let fakeNpm: string;
let installedVersion: string;
let higherVersion: string;

/** The directory holding the real `node`, so the isolated PATH can stay minimal. */
function nodeDirectory(): string {
  return dirname(process.execPath);
}

/**
 * PATH deliberately omits `claude` so the host is genuinely absent (null plugin
 * tuple) and the reconciled verdict is driven purely by the CLI-version drift in
 * the fixture — deterministic regardless of what is installed on the machine.
 */
function isolatedPath(): string {
  const sep = process.platform === 'win32' ? ';' : ':';
  const dirs = [
    nodeDirectory(),
    ...(process.platform === 'win32'
      ? [process.env.SystemRoot ? join(process.env.SystemRoot, 'System32') : '']
      : ['/usr/bin', '/bin']),
  ].filter(Boolean);
  return dirs.join(sep);
}

/**
 * Run a real `planr` invocation. Each caller supplies its own OPENPLANR_HOME so
 * the snooze/never-ask state file is isolated per scenario but shared across the
 * two invocations of a scenario — that shared on-disk file is the persistence
 * proof.
 */
function run(args: string[], env: NodeJS.ProcessEnv): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', cliEntry, '--project-dir', projectRoot, ...args],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        OPENPLANR_ECOSYSTEM_SOURCE: ecosystemFixture,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        PATH: isolatedPath(),
        ...env,
      },
    },
  );
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'openplanr-offer-inline-'));
  projectRoot = join(root, 'project');
  mkdirSync(join(projectRoot, '.planr'), { recursive: true });

  // A valid project config so `planr config show` (the "original command") runs
  // and prints its own output after the offer.
  writeFileSync(
    join(projectRoot, '.planr', 'config.json'),
    `${JSON.stringify(createDefaultConfig('offer-inline-fixture'), null, 2)}\n`,
  );

  installedVersion = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
  const [major, minor] = installedVersion.split('.').map(Number);
  higherVersion = `${major}.${minor + 1}.0`;

  // A published manifest one CLI minor ahead of what is installed → reconcile
  // returns `upgrade-available`. Read from a local file, so no network is touched.
  ecosystemFixture = join(root, 'ecosystem.json');
  writeFileSync(
    ecosystemFixture,
    JSON.stringify({
      components: {
        cli: { version: higherVersion, pipelineRange: '^0.39.0' },
        pipeline: { version: '0.39.0', cliRange: `^${installedVersion}` },
        skills: { version: '1.24.0', cliRange: `^${installedVersion}` },
      },
    }),
  );

  // A stub `npm` (via T-003's OPENPLANR_NPM_BIN seam) that records every argv it
  // is asked to run into OPENPLANR_NPM_LOG — the observable proof the CLI-owned
  // half was actually executed by the offer's "upgrade now" path.
  fakeNpm = join(root, 'fake-npm.cjs');
  writeFileSync(
    fakeNpm,
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      'if (process.env.OPENPLANR_NPM_LOG) {',
      "  fs.appendFileSync(process.env.OPENPLANR_NPM_LOG, process.argv.slice(2).join(' ') + '\\n');",
      '}',
      'process.exit(0);',
      '',
    ].join('\n'),
  );
  chmodSync(fakeNpm, 0o755);
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('inline upgrade offer through a real preAction subprocess', () => {
  it('surfaces the offer on an ordinary command and snoozes 24h, persisting across a second invocation', () => {
    // OPENPLANR_HOME is the home dir; `runtimeRoot()` appends `.planr/runtime`.
    const home = join(root, 'home-not-now');
    const statePath = join(home, '.planr', 'runtime', 'upgrade-state.json');
    const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);

    // Invocation 1 — the offer surfaces on `config show` and the user chooses
    // "not now". A real state file is written to disk.
    const first = run(['config', 'show'], {
      OPENPLANR_HOME: home,
      OPENPLANR_UPGRADE_OFFER_CHOICE: 'not-now',
      OPENPLANR_UPGRADE_NOW: String(t0),
    });
    expect(first.status, first.stderr || first.stdout).toBe(0);
    expect(first.stdout).toContain(OFFER_MARKER);
    expect(first.stdout).toContain('Snoozed');
    // The original command still ran.
    expect(first.stdout).toContain(COMMAND_MARKER);

    // The snooze is on disk: stage 1, exactly 24h out.
    expect(existsSync(statePath)).toBe(true);
    const afterFirst = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(afterFirst.snoozeStage).toBe(1);
    expect(Date.parse(afterFirst.snoozeUntil) - t0).toBe(24 * 60 * 60 * 1000);

    // Invocation 2 — one hour later, still inside the snooze window. A fresh
    // process reads the file the first wrote: the offer must NOT surface, and
    // the command runs unimpeded.
    const second = run(['config', 'show'], {
      OPENPLANR_HOME: home,
      // Would re-snooze to stage 2 IF it surfaced — so an unchanged file proves
      // the second process honoured the first's persisted snooze.
      OPENPLANR_UPGRADE_OFFER_CHOICE: 'not-now',
      OPENPLANR_UPGRADE_NOW: String(t0 + 60 * 60 * 1000),
    });
    expect(second.status, second.stderr || second.stdout).toBe(0);
    expect(second.stdout).not.toContain(OFFER_MARKER);
    expect(second.stdout).toContain(COMMAND_MARKER);

    const afterSecond = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(afterSecond.snoozeStage).toBe(1);
    expect(afterSecond.snoozeUntil).toBe(afterFirst.snoozeUntil);
  }, 120_000);

  it('persists "never ask again" across invocations and prints the exact re-enable command', () => {
    const home = join(root, 'home-never');
    const statePath = join(home, '.planr', 'runtime', 'upgrade-state.json');
    const npmLog = join(root, 'never-npm.log');

    // Invocation 1 — the user chooses "never ask again".
    const first = run(['config', 'show'], {
      OPENPLANR_HOME: home,
      OPENPLANR_UPGRADE_OFFER_CHOICE: 'never',
    });
    expect(first.status, first.stderr || first.stdout).toBe(0);
    expect(first.stdout).toContain(OFFER_MARKER);
    // FR6 Trap E: the exact reversal command is stated.
    expect(first.stdout).toContain('planr config set-upgrade-policy --ask-again');
    expect(JSON.parse(readFileSync(statePath, 'utf8')).neverAsk).toBe(true);

    // Invocation 2 — a fresh process. Even though the injected choice is
    // "upgrade now", never-ask short-circuits before reconcile, so the offer is
    // silent and the npm-executor stub is never called.
    const second = run(['config', 'show'], {
      OPENPLANR_HOME: home,
      OPENPLANR_UPGRADE_OFFER_CHOICE: 'upgrade-now',
      OPENPLANR_NPM_BIN: fakeNpm,
      OPENPLANR_NPM_LOG: npmLog,
    });
    expect(second.status, second.stderr || second.stdout).toBe(0);
    expect(second.stdout).not.toContain(OFFER_MARKER);
    expect(second.stdout).toContain(COMMAND_MARKER);
    expect(existsSync(npmLog)).toBe(false);
    expect(JSON.parse(readFileSync(statePath, 'utf8')).neverAsk).toBe(true);
  }, 120_000);

  it('runs the CLI-half upgrade on "upgrade now" and then resumes the original command', () => {
    const home = join(root, 'home-upgrade');
    const npmLog = join(root, 'upgrade-npm.log');

    const result = run(['config', 'show'], {
      OPENPLANR_HOME: home,
      OPENPLANR_UPGRADE_OFFER_CHOICE: 'upgrade-now',
      OPENPLANR_NPM_BIN: fakeNpm,
      OPENPLANR_NPM_LOG: npmLog,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);

    // The offer surfaced and drove the CLI-owned half through the real executor.
    expect(result.stdout).toContain(OFFER_MARKER);
    expect(result.stdout).toContain(`Upgrading the OpenPlanr CLI to ${higherVersion}`);
    expect(existsSync(npmLog)).toBe(true);
    expect(readFileSync(npmLog, 'utf8')).toContain(`install -g openplanr@${higherVersion}`);

    // The originally-invoked command resumes: its own output appears, and it
    // appears AFTER the offer's output — the upgrade was an inline step, not a
    // detour that lost the user's intent.
    expect(result.stdout).toContain(COMMAND_MARKER);
    expect(result.stdout.indexOf(OFFER_MARKER)).toBeLessThan(result.stdout.indexOf(COMMAND_MARKER));
  }, 120_000);

  it('never surfaces the offer for the `upgrade` command itself (no double-prompt)', () => {
    const home = join(root, 'home-upgrade-cmd');
    const result = run(['upgrade', 'status', '--json'], {
      OPENPLANR_HOME: home,
      OPENPLANR_UPGRADE_OFFER_CHOICE: 'upgrade-now',
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    // The offer must not surface — `upgrade` owns its own flow — and the JSON
    // output must be a single clean machine-readable line.
    expect(result.stdout).not.toContain(OFFER_MARKER);
    const lines = result.stdout.trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0])).not.toThrow();
  }, 120_000);
});
