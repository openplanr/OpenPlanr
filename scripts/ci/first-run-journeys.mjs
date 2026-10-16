#!/usr/bin/env node

/**
 * Installs the published `openplanr` from npm and runs first-run journeys in throwaway HOMEs
 * and npm prefixes. Usage: `node scripts/ci/first-run-journeys.mjs [--scenario <name>]...`.
 * Scenarios: fresh (install latest, init, doctor), upgrade (previous to latest, one prefix),
 * two-prefix (previous to latest when the CLI's prefix differs from npm's). Exits 1 on failure.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCENARIOS = ['fresh', 'upgrade', 'two-prefix'];
// The first CLI that installs into its own prefix. Below it, the two-prefix upgrade is a
// known failure that is reported but does not fail the run.
const FIRST_TWO_PREFIX_FIX = '3.1.1';
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const onWindows = process.platform === 'win32';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseScenarios(argv) {
  const selected = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--scenario' || !SCENARIOS.includes(argv[index + 1])) {
      throw new Error(
        `Unknown argument ${argv[index]} ${argv[index + 1] ?? ''}; expected --scenario ${SCENARIOS.join('|')}.`,
      );
    }
    selected.push(argv[index + 1]);
    index += 1;
  }
  return selected.length ? selected : SCENARIOS;
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

function run(command, args, { env, cwd }) {
  // Windows needs a shell to start the .cmd shims npm writes.
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    shell: onWindows,
    timeout: COMMAND_TIMEOUT_MS,
  });
  const line = `$ ${[command, ...args].join(' ')} -> ${result.error ? result.error.message : `exit ${result.status}`}`;
  return { ...result, stdout: result.stdout ?? '', stderr: result.stderr ?? '', line };
}

function check(condition, message, result) {
  if (condition) return;
  const output = result ? `\n${result.line}\n${result.stdout}${result.stderr}` : '';
  throw new Error(`${message}${output}`);
}

function parseJson(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    check(false, `${label} printed no JSON report (${error.message})`, result);
  }
}

function publishedVersions(root) {
  const result = run('npm', ['view', 'openplanr', 'versions', 'dist-tags', '--json'], {
    env: { ...process.env, NPM_CONFIG_CACHE: path.join(root, 'npm-cache') },
    cwd: root,
  });
  check(result.status === 0, 'npm view openplanr failed', result);
  const view = parseJson(result, 'npm view');
  const latest = view['dist-tags']?.latest;
  const stable = view.versions.filter((version) => /^\d+\.\d+\.\d+$/u.test(version));
  const index = stable.indexOf(latest);
  check(
    index > 0,
    `No stable version precedes latest ${latest} in ${JSON.stringify(stable.slice(-5))}`,
  );
  return { latest, previous: stable[index - 1] };
}

function binDir(prefix) {
  return onWindows ? prefix : path.join(prefix, 'bin');
}

function packageVersion(prefix) {
  const modules = onWindows
    ? path.join(prefix, 'node_modules')
    : path.join(prefix, 'lib', 'node_modules');
  const manifest = path.join(modules, 'openplanr', 'package.json');
  return fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')).version : 'absent';
}

/** A clean-machine environment: own HOME, npm config and cache, nothing from the caller's shell. */
function isolatedEnv(root, home, { cliPrefix, npmPrefix }) {
  fs.mkdirSync(home, { recursive: true });
  const inherited = onWindows
    ? Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) =>
            !/^(?:OPENPLANR|PLANR|CODEX|CLAUDE|PATH$|HOME$|USERPROFILE$|APPDATA$|LOCALAPPDATA$|NPM_CONFIG)/iu.test(
              key,
            ),
        ),
      )
    : Object.fromEntries(
        ['TMPDIR', 'LANG', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY']
          .filter((key) => process.env[key])
          .map((key) => [key, process.env[key]]),
      );
  const systemPath = onWindows ? [process.env.PATH] : ['/usr/bin', '/bin'];
  return {
    ...inherited,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    PATH: [binDir(cliPrefix), path.dirname(process.execPath), ...systemPath].join(path.delimiter),
    NPM_CONFIG_PREFIX: npmPrefix,
    NPM_CONFIG_CACHE: path.join(root, 'npm-cache'),
    NPM_CONFIG_USERCONFIG: path.join(home, '.npmrc'),
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  };
}

function install(version, env, cwd) {
  const result = onWindows
    ? run(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(repoRoot, 'packages/cli/install.ps1'),
          '-Version',
          version,
        ],
        { env, cwd },
      )
    : run('sh', [path.join(repoRoot, 'packages/cli/install.sh'), '--version', version], {
        env,
        cwd,
      });
  check(result.status === 0, `The installer failed for openplanr@${version}`, result);
}

function openplanr(prefix, args, env, cwd) {
  return run(path.join(binDir(prefix), 'openplanr'), args, { env, cwd });
}

function freshProject(root, name, env) {
  const project = path.join(root, name);
  fs.mkdirSync(project, { recursive: true });
  const result = run('git', ['init', '-q'], { env, cwd: project });
  check(result.status === 0, 'git init failed', result);
  return project;
}

function assertCliVersion(prefix, expected, env, cwd) {
  const result = openplanr(prefix, ['--version'], env, cwd);
  check(
    result.status === 0 && result.stdout.trim() === expected && packageVersion(prefix) === expected,
    `Expected openplanr ${expected} in ${prefix}; package.json has ${packageVersion(prefix)}`,
    result,
  );
}

function fresh(root, { latest }) {
  const prefix = path.join(root, 'fresh-prefix');
  const env = isolatedEnv(root, path.join(root, 'fresh-home'), {
    cliPrefix: prefix,
    npmPrefix: prefix,
  });
  install(latest, env, root);
  const project = freshProject(root, 'fresh-project', env);
  assertCliVersion(prefix, latest, env, project);
  const init = openplanr(prefix, ['init'], env, project);
  check(init.status === 0, 'openplanr init failed', init);
  check(
    fs.existsSync(path.join(project, '.planr', 'config.json')),
    'openplanr init wrote no .planr/config.json',
    init,
  );
  // Doctor exits 1 only when a check fails; warnings are legitimate on a machine with no
  // coding agent, so they are listed, not asserted.
  const doctor = openplanr(prefix, ['doctor', '--json'], env, project);
  const report = parseJson(doctor, 'openplanr doctor');
  const failed = report.diagnostics.filter((item) => item.status === 'fail');
  check(
    doctor.status === 0 && report.ok === true && failed.length === 0,
    `openplanr doctor failed: ${failed.map((item) => item.code).join(', ')}`,
    doctor,
  );
  const warned = report.diagnostics
    .filter((item) => item.status === 'warn')
    .map((item) => item.code);
  return {
    status: 'pass',
    detail: `installed ${latest}, init ok, doctor ok${warned.length ? ` (warnings: ${warned.join(', ')})` : ''}`,
  };
}

// Setup failures always fail the run; only a non-gating upgrade outcome is a known failure.
function upgradeJourney(root, name, { latest, previous }, { splitPrefixes, gating }) {
  const cliPrefix = path.join(root, `${name}-cli-prefix`);
  const npmPrefix = splitPrefixes ? path.join(root, `${name}-npm-prefix`) : cliPrefix;
  const home = path.join(root, `${name}-home`);
  install(previous, isolatedEnv(root, home, { cliPrefix, npmPrefix: cliPrefix }), root);
  const env = isolatedEnv(root, home, { cliPrefix, npmPrefix });
  const project = freshProject(root, `${name}-project`, env);
  assertCliVersion(cliPrefix, previous, env, project);
  try {
    const upgrade = openplanr(cliPrefix, ['upgrade', 'apply', '--yes', '--json'], env, project);
    const report = parseJson(upgrade, 'openplanr upgrade apply');
    check(
      upgrade.status === 0 && report.ok === true,
      `openplanr upgrade apply ${previous} -> ${latest} failed: ${report.failure?.message ?? 'no failure reported'}`,
      upgrade,
    );
    assertCliVersion(cliPrefix, latest, env, project);
  } catch (error) {
    if (gating) throw error;
    return { status: 'known-failure', detail: error.message };
  }
  return {
    status: gating ? 'pass' : 'unexpected-pass',
    detail: `upgraded ${previous} -> ${latest}`,
  };
}

const JOURNEYS = {
  fresh: (root, versions) => fresh(root, versions),
  upgrade: (root, versions) =>
    upgradeJourney(root, 'upgrade', versions, { splitPrefixes: false, gating: true }),
  'two-prefix': (root, versions) =>
    upgradeJourney(root, 'two-prefix', versions, {
      splitPrefixes: true,
      gating: compareVersions(versions.previous, FIRST_TWO_PREFIX_FIX) >= 0,
    }),
};

function annotate(level, message) {
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::${level}::${message}`);
}

function main() {
  const scenarios = parseScenarios(process.argv.slice(2));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openplanr-first-run-'));
  const versions = publishedVersions(root);
  console.log(
    `openplanr latest ${versions.latest}, previous ${versions.previous}; work dir ${root}`,
  );
  const rows = scenarios.map((scenario) => {
    const started = Date.now();
    let status;
    let detail;
    try {
      ({ status, detail } = JOURNEYS[scenario](root, versions));
    } catch (error) {
      status = 'fail';
      detail = error.message;
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    if (status === 'known-failure') {
      annotate(
        'warning',
        `${scenario}: known failure while the starting version ${versions.previous} is below ${FIRST_TWO_PREFIX_FIX}`,
      );
    }
    if (status === 'unexpected-pass') {
      annotate(
        'notice',
        `${scenario}: passed although ${versions.previous} is below ${FIRST_TWO_PREFIX_FIX}`,
      );
    }
    if (status === 'fail') annotate('error', `${scenario}: ${detail.split('\n')[0]}`);
    console.log(`\n[${status}] ${scenario} (${seconds}s)\n${detail}`);
    return { scenario, status, seconds, detail: detail.split('\n')[0] };
  });
  const summary = [
    `First-run journeys: openplanr ${versions.previous} -> ${versions.latest} on ${process.platform}`,
    '',
    '| Scenario | Result | Seconds | Detail |',
    '| --- | --- | --- | --- |',
    ...rows.map(
      (row) =>
        `| ${row.scenario} | ${row.status} | ${row.seconds} | ${row.detail.replaceAll('|', '\\|')} |`,
    ),
  ].join('\n');
  console.log(`\n${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  const failed = rows.some((row) => row.status === 'fail');
  if (failed) console.log(`Kept ${root} for inspection.`);
  else fs.rmSync(root, { recursive: true, force: true });
  process.exitCode = failed ? 1 : 0;
}

main();
