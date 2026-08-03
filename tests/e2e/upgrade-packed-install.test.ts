import { execFileSync, spawnSync } from 'node:child_process';
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

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const onWindows = process.platform === 'win32';

/**
 * Windows resolves `npm` to `npm.cmd`, and Node refuses to execFile a `.cmd`
 * without a shell (the CVE-2024-27980 mitigation). A shell re-parses arguments,
 * so each is quoted — several carry temporary directory paths.
 */
function npmExec(
  args: string[],
  options: Parameters<typeof execFileSync>[2] = {},
): string | Buffer {
  return execFileSync(npm, onWindows ? args.map((arg) => `"${arg}"`) : args, {
    ...options,
    ...(onWindows ? { shell: true } : {}),
  });
}

const repositoryRoot = resolve('.');
let root: string;
let projectRoot: string;
let installRoot: string;
let packageRoot: string;
let cli: string;
let ecosystemFixture: string;
let packedVersion: string;

/** The directory holding the real `git`, so the isolated PATH can stay minimal. */
function gitDirectory(): string | null {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['git'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const first = probe.stdout
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return first ? dirname(first) : null;
}

/**
 * PATH deliberately omits `claude`, so `inspectClaudePluginIntegration` finds
 * no host and the skills/pipeline tuple is null — the real behaviour on a
 * machine without the host installed. The ecosystem source is a local file, so
 * no network is touched.
 */
function isolatedEnvironment(
  extraEnv: NodeJS.ProcessEnv = {},
  extraPathDirs: string[] = [],
): NodeJS.ProcessEnv {
  const binDirectory = join(installRoot, 'node_modules', '.bin');
  return {
    ...process.env,
    HOME: join(root, 'home'),
    OPENPLANR_HOME: join(root, 'home', '.planr'),
    OPENPLANR_PIPELINE_ROOT: '',
    OPENPLANR_ECOSYSTEM_SOURCE: ecosystemFixture,
    NO_COLOR: '1',
    PATH: [
      ...extraPathDirs,
      binDirectory,
      dirname(process.execPath),
      gitDirectory(),
      ...(process.platform === 'win32'
        ? [process.env.SystemRoot ? join(process.env.SystemRoot, 'System32') : '']
        : ['/usr/bin', '/bin']),
    ]
      .filter(Boolean)
      .join(process.platform === 'win32' ? ';' : ':'),
    // `extraEnv` wins over the defaults (e.g. the apply scenario overrides the
    // ecosystem source and injects the npm/claude stubs).
    ...extraEnv,
  };
}

function run(
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
  extraPathDirs: string[] = [],
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [cli, '--project-dir', projectRoot, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: isolatedEnvironment(extraEnv, extraPathDirs),
  });
}

function pack(directory: string): string {
  const packed = JSON.parse(
    npmExec(['pack', '--json', '--ignore-scripts', '--pack-destination', root], {
      cwd: directory,
      encoding: 'utf8',
      windowsHide: true,
    }) as string,
  ) as Array<{ filename: string }>;
  return join(root, packed[0].filename);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'openplanr-packed-upgrade-'));
  projectRoot = join(root, 'project');
  installRoot = join(root, 'install');
  mkdirSync(projectRoot, { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: projectRoot });
  writeFileSync(join(projectRoot, 'README.md'), '# Packed upgrade fixture\n');

  // Packing needs a current dist/, but CI runs `npm run build` before `npm test`.
  // Build only when nothing usable is present.
  if (!existsSync(join(repositoryRoot, 'dist', 'cli', 'index.js'))) {
    npmExec(['run', 'build'], { cwd: repositoryRoot, stdio: 'pipe', windowsHide: true });
  }

  packedVersion = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
    .version as string;

  // The published manifest, pinned to the version we are actually packing, so
  // the reconciled verdict is `aligned` for this real install.
  ecosystemFixture = join(root, 'ecosystem.json');
  writeFileSync(
    ecosystemFixture,
    JSON.stringify({
      components: {
        cli: { version: packedVersion, pipelineRange: '^0.39.0' },
        pipeline: { version: '0.39.0', cliRange: `^${packedVersion}` },
        skills: { version: '1.24.0', cliRange: `^${packedVersion}` },
      },
    }),
  );

  const cliTarball = pack(repositoryRoot);
  npmExec(
    [
      'install',
      '--prefix',
      installRoot,
      '--omit=optional',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--prefer-offline',
      '--no-progress',
      cliTarball,
    ],
    { cwd: root, stdio: 'pipe', windowsHide: true },
  );

  packageRoot = join(installRoot, 'node_modules', 'openplanr');
  cli = join(packageRoot, 'bin', 'planr.js');
}, 600_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('packed planr upgrade status', () => {
  it('reads the real installed CLI version from the packed install (Trap A)', () => {
    expect(existsSync(cli)).toBe(true);
    const result = run(['upgrade', 'status', '--json']);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toBe('');
    const lines = result.stdout.trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    const report = JSON.parse(lines[0]) as {
      status: string;
      installed: { cli: string; skills: string | null; pipeline: string | null };
      ecosystemSource: string;
    };
    // The proof: the version comes from the installed package.json on disk, not
    // an in-memory fixture.
    expect(report.installed.cli).toBe(packedVersion);
    expect(report.status).toBe('aligned');
    // The host is absent from PATH, so the plugin half is genuinely null.
    expect(report.installed.skills).toBeNull();
    expect(report.installed.pipeline).toBeNull();
  });

  it('exposes `upgrade status` through the real built binary (Trap B)', () => {
    const help = run(['upgrade', '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('status');
  });
});

// This block runs after the `status` block and mutates the packed install's
// package.json version through a stubbed npm, so it is intentionally last.
describe('packed planr upgrade apply', () => {
  let higherVersion: string;
  let claudeBinDir: string;
  let fakeNpm: string;
  let callLog: string;
  let mutationMarker: string;
  let applyEcosystem: string;

  beforeAll(() => {
    const [major, minor] = packedVersion.split('.').map(Number);
    higherVersion = `${major}.${minor + 1}.0`;

    // A published manifest that is one CLI minor ahead of the packed install, so
    // reconcile returns `upgrade-available` and apply proceeds.
    applyEcosystem = join(root, 'ecosystem-apply.json');
    writeFileSync(
      applyEcosystem,
      JSON.stringify({
        components: {
          cli: { version: higherVersion, pipelineRange: '^0.39.0' },
          pipeline: { version: '0.39.0', cliRange: `^${packedVersion}` },
          skills: { version: '1.24.0', cliRange: `^${packedVersion}` },
        },
      }),
    );

    // A stub `npm` that stands in for `npm install -g openplanr@<target>` by
    // writing the requested version into the real installed package.json — so
    // the CLI's verify-after-write (`readOpenPlanrVersion`) reads a genuinely
    // changed on-disk file, never an in-memory fixture (Trap A).
    fakeNpm = join(root, 'fake-npm.cjs');
    writeFileSync(
      fakeNpm,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'const args = process.argv.slice(2);',
        "const spec = args.find((a) => a.startsWith('openplanr@'));",
        'if (spec && process.env.OPENPLANR_FAKE_PKG_JSON) {',
        "  const version = spec.slice('openplanr@'.length);",
        '  const pkgPath = process.env.OPENPLANR_FAKE_PKG_JSON;',
        "  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));",
        '  pkg.version = version;',
        "  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\\n');",
        '}',
        'process.exit(0);',
        '',
      ].join('\n'),
    );

    // A stub `claude` on PATH that answers read-only inspection but records a
    // mutation marker if ever asked to install/update/enable a plugin. The apply
    // path must build its prescription from a read of host state and never run a
    // mutating plugin command — that is the checkable hard-constraint proof.
    claudeBinDir = join(root, 'fake-claude-bin');
    mkdirSync(claudeBinDir, { recursive: true });
    const claudePath = join(claudeBinDir, 'claude');
    callLog = join(root, 'claude-calls.log');
    mutationMarker = join(root, 'claude-mutation.marker');
    writeFileSync(
      claudePath,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'const args = process.argv.slice(2);',
        "if (process.env.CLAUDE_CALL_LOG) fs.appendFileSync(process.env.CLAUDE_CALL_LOG, args.join(' ') + '\\n');",
        "const mutating = args[0] === 'plugin' && (",
        "  ['install', 'update', 'enable'].includes(args[1]) ||",
        "  (args[1] === 'marketplace' && ['add', 'update'].includes(args[2]))",
        ');',
        'if (mutating) {',
        "  if (process.env.CLAUDE_MUTATION_MARKER) fs.writeFileSync(process.env.CLAUDE_MUTATION_MARKER, args.join(' '));",
        '  process.exit(0);',
        '}',
        "const key = args.join(' ');",
        "if (key === '--version') { process.stdout.write('1.0.0'); process.exit(0); }",
        "if (key === 'plugin marketplace list --json') { process.stdout.write(JSON.stringify([{ name: 'openplanr', repo: 'openplanr/marketplace' }])); process.exit(0); }",
        "if (key === 'plugin list --json') { process.stdout.write(JSON.stringify([{ id: 'openplanr@openplanr', version: '1.0.0', scope: 'user', enabled: true }])); process.exit(0); }",
        "process.stdout.write('[]');",
        'process.exit(0);',
        '',
      ].join('\n'),
    );
    chmodSync(claudePath, 0o755);
  });

  it('upgrades the real npm half to the target and prescribes — never runs — the plugin half', () => {
    const result = run(
      ['upgrade', 'apply', '--yes', '--json'],
      {
        // A dedicated home so this run reads the apply fixture fresh rather than
        // the aligned manifest the `status` scenario cached under the shared home.
        OPENPLANR_HOME: join(root, 'home-apply', '.planr'),
        OPENPLANR_ECOSYSTEM_SOURCE: applyEcosystem,
        OPENPLANR_NPM_BIN: fakeNpm,
        OPENPLANR_FAKE_PKG_JSON: join(packageRoot, 'package.json'),
        CLAUDE_CALL_LOG: callLog,
        CLAUDE_MUTATION_MARKER: mutationMarker,
      },
      [claudeBinDir],
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toBe('');
    const lines = result.stdout.trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    const report = JSON.parse(lines[0]) as {
      ok: boolean;
      cliUpgraded: boolean;
      installedVersion: string;
      pluginHalfCommands: string[];
    };

    // The npm half really landed: the version is read back from the mutated
    // package.json on disk, not from any fixture.
    expect(report.ok).toBe(true);
    expect(report.cliUpgraded).toBe(true);
    expect(report.installedVersion).toBe(higherVersion);
    expect(readFileSync(join(packageRoot, 'package.json'), 'utf8')).toContain(
      `"version": "${higherVersion}"`,
    );

    // The hard constraint: no mutating `claude plugin` command was ever run.
    expect(existsSync(mutationMarker)).toBe(false);
    if (existsSync(callLog)) {
      // Read-only inspection is allowed; a mutating verb is not.
      for (const line of readFileSync(callLog, 'utf8').split(/\r?\n/).filter(Boolean)) {
        const parts = line.split(' ');
        const mutating =
          parts[0] === 'plugin' &&
          (['install', 'update', 'enable'].includes(parts[1]) ||
            (parts[1] === 'marketplace' && ['add', 'update'].includes(parts[2])));
        expect(mutating, `unexpected mutating claude call: ${line}`).toBe(false);
      }
    }

    // Where the host was reachable (the fake `claude` was invoked), the plugin
    // half is prescribed with the marketplace refresh first — the exact commands
    // a user or the companion skill would run.
    expect(Array.isArray(report.pluginHalfCommands)).toBe(true);
    if (report.pluginHalfCommands.length > 0) {
      expect(report.pluginHalfCommands[0]).toBe('claude plugin marketplace update openplanr');
    }
  });

  // FR7 / T-006: the versioned migration registry must be reachable through the
  // real `apply` command, not only a direct `runPendingMigrations` unit call. The
  // operate-profile migration is keyed to 1.22.0 — the CHANGELOG version that
  // introduced `.planr/operate-profile.json` migration support. An upgrade that
  // CROSSES 1.22.0 (from below, up to it) must carry a legacy profile across.
  const MIGRATION_VERSION = '1.22.0';
  const BEFORE_MIGRATION = '1.21.0';

  it('runs the versioned migration registry when a real apply crosses the migration version (FR7, Trap B)', () => {
    // Put the packed install a version BELOW the migration version, so the
    // version read back from disk (previousVersion) sits below 1.22.0 and the
    // upgrade genuinely crosses it. `fakeNpm` will land the target the same way.
    const pkgPath = join(packageRoot, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
    pkg.version = BEFORE_MIGRATION;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

    // Seed a legacy operating profile carrying fields the current schema rejects.
    mkdirSync(join(projectRoot, '.planr'), { recursive: true });
    const profileFile = join(projectRoot, '.planr', 'operate-profile.json');
    writeFileSync(
      profileFile,
      `${JSON.stringify({
        id: 'engineering',
        title: 'Engineering board',
        description: 'Delivery, reliability, and risk.',
        enabledRoles: ['technology-risk', 'chair', 'not-a-role'],
        caps: { surfacedFindings: 10, newSpecs: 3, openDecisions: 3, agentArtifacts: 2 },
        enabledProviders: ['repository', 'planr', 'git', 'linear'],
        budgets: { maxFiles: 5, maxItems: 5, maxBytes: 5, maxDurationMs: 5 },
        owner: 'a-legacy-field',
      })}\n`,
    );

    // A published manifest that publishes the migration version as the CLI
    // target, with ranges the lowered install still satisfies, so reconcile is
    // `upgrade-available` and apply installs 1.22.0 — crossing it.
    const crossingEcosystem = join(root, 'ecosystem-migrate.json');
    writeFileSync(
      crossingEcosystem,
      JSON.stringify({
        components: {
          cli: { version: MIGRATION_VERSION, pipelineRange: '^0.39.0' },
          pipeline: { version: '0.39.0', cliRange: `^${BEFORE_MIGRATION}` },
          skills: { version: '1.24.0', cliRange: `^${BEFORE_MIGRATION}` },
        },
      }),
    );

    // The operate-profile migration writes a journalled, protocol-validated
    // transaction, so the operate machinery needs the pipeline package. The
    // packed install omits the optional pipeline, so point at the repository's
    // installed one — the real production install (a plain `npm install -g
    // openplanr@X`) keeps the optional pipeline, so this stands in for it.
    const pipelineRoot = existsSync(
      join(repositoryRoot, 'node_modules', 'planr-pipeline', 'lib', 'protocol', 'loader.mjs'),
    )
      ? join(repositoryRoot, 'node_modules', 'planr-pipeline')
      : resolve(repositoryRoot, '..', 'planr-pipeline');

    const result = run(['upgrade', 'apply', '--yes', '--json'], {
      OPENPLANR_HOME: join(root, 'home-migrate', '.planr'),
      OPENPLANR_ECOSYSTEM_SOURCE: crossingEcosystem,
      OPENPLANR_NPM_BIN: fakeNpm,
      OPENPLANR_FAKE_PKG_JSON: pkgPath,
      OPENPLANR_PIPELINE_ROOT: pipelineRoot,
      // Keep the delegated migration's backups and locks inside the e2e temp.
      OPENPLANR_STATE_ROOT: join(root, 'migrate-state'),
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const lines = result.stdout.trim().split(/\r?\n/);
    const report = JSON.parse(lines[lines.length - 1]) as {
      ok: boolean;
      cliUpgraded: boolean;
      installedVersion: string;
      migrations: Array<{
        id: string;
        applied: boolean;
        alreadyApplied: boolean;
        failure?: string;
      }>;
    };

    // The CLI half really landed at the migration's version, crossing it.
    expect(report.ok).toBe(true);
    expect(report.cliUpgraded).toBe(true);
    expect(report.installedVersion).toBe(MIGRATION_VERSION);

    // The registry ran the real operate-profile migration through `apply` — the
    // proof this is reachable end to end, not only via a unit call.
    const migration = report.migrations.find((entry) => entry.id === 'operate-profile-schema');
    expect(migration, JSON.stringify(report.migrations)).toBeTruthy();
    expect(migration).toMatchObject({ applied: true, alreadyApplied: false });

    // And the legacy profile on disk was migrated to the supported subset.
    const migrated = JSON.parse(readFileSync(profileFile, 'utf8')) as Record<string, unknown>;
    expect(migrated).not.toHaveProperty('enabledProviders');
    expect(migrated).not.toHaveProperty('budgets');
    expect(migrated).not.toHaveProperty('owner');
    expect(migrated.id).toBe('engineering');
  });
});
