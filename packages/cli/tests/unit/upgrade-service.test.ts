import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ClaudeCommandRunner,
  ClaudePluginOperation,
} from '../../src/services/claude-plugin-service.js';
import {
  CLAUDE_PLUGIN_SETUP_COMMAND,
  DEFAULT_ECOSYSTEM_SOURCE,
  type EcosystemComponents,
  executeCliHalfUpgrade,
  type NpmCommandResult,
  type NpmCommandRunner,
  planCliUpgrade,
  prescribePluginHalfCommands,
  reconcileInstalledTuple,
  summarizeChangelogBetween,
  type UpgradeReconciliation,
} from '../../src/services/upgrade-service.js';

const cliVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version as string;
const [cliMajor, cliMinor] = cliVersion.split('.').map(Number);
const higherCli = `${cliMajor}.${cliMinor + 1}.0`;
/** A published version *below* the installed CLI — the BL-005 downgrade-offer case. */
const lowerCli = `${cliMajor}.${cliMinor - 1}.0`;

let root: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openplanr-upgrade-'));
  userHome = join(root, 'home');
  process.env.OPENPLANR_HOME = userHome;
  delete process.env.OPENPLANR_ECOSYSTEM_SOURCE;
});

afterEach(() => {
  delete process.env.OPENPLANR_HOME;
  delete process.env.OPENPLANR_ECOSYSTEM_SOURCE;
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/**
 * A `claude` runner with the bundled `openplanr-local` marketplace registered (what
 * `planr setup` leaves behind) and the given user-scope plugins installed, mirroring
 * `claude plugin marketplace list --json` and `claude plugin list --json`.
 */
function installedRunner(installed: Array<{ id: string; version: string }>): ClaudeCommandRunner {
  return (args) => {
    const key = args.join(' ');
    if (key === '--version') return { status: 0, stdout: '1.0.0', stderr: '' };
    if (key === 'plugin marketplace list --json') {
      return {
        status: 0,
        stdout: JSON.stringify([{ name: 'openplanr-local', source: 'directory' }]),
        stderr: '',
      };
    }
    if (key === 'plugin list --json') {
      return {
        status: 0,
        stdout: JSON.stringify(
          installed.map((plugin) => ({ ...plugin, scope: 'user', enabled: true })),
        ),
        stderr: '',
      };
    }
    return { status: 0, stdout: '[]', stderr: '' };
  };
}

/**
 * A `claude` runner that reports `planr@openplanr-local` at the given version.
 * `available: false` models `claude` being absent (offline / not installed), which
 * yields a `null` host plugin.
 */
function makeRunner(versions: {
  skills?: string | null;
  available?: boolean;
}): ClaudeCommandRunner {
  if (versions.available === false) {
    return () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('spawn claude ENOENT'),
    });
  }
  return installedRunner(
    versions.skills != null ? [{ id: 'planr@openplanr-local', version: versions.skills }] : [],
  );
}

function manifest(
  overrides: Partial<{ cliRange: string; pipelineRange: string }> & {
    cliVersion: string;
    skillsVersion: string;
    pipelineVersion: string;
  },
): EcosystemComponents {
  const cliRange = overrides.cliRange ?? `^${cliVersion}`;
  return {
    cli: { version: overrides.cliVersion, pipelineRange: overrides.pipelineRange ?? '^0.39.0' },
    pipeline: { version: overrides.pipelineVersion, cliRange },
    skills: { version: overrides.skillsVersion, cliRange },
  };
}

function jsonFetch(components: EcosystemComponents): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ components }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

describe('reconcileInstalledTuple', () => {
  it('reports aligned when the installed tuple matches the published manifest', async () => {
    const published = manifest({
      cliVersion,
      skillsVersion: '1.24.0',
      pipelineVersion: '0.39.0',
    });
    const result = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: makeRunner({ skills: '1.24.0' }),
      fetchImpl: jsonFetch(published),
    });
    expect(result.status).toBe('aligned');
    expect(result.installed).toEqual({ cli: cliVersion, skills: '1.24.0', pipeline: null });
    expect(result.ecosystemSource).toBe('network');
  });

  it('reports upgrade-available when the CLI is behind but still satisfies the ranges', async () => {
    const published = manifest({
      cliVersion: higherCli,
      skillsVersion: '1.24.0',
      pipelineVersion: '0.39.0',
      cliRange: `^${cliVersion}`,
    });
    const result = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: makeRunner({ skills: '1.24.0' }),
      fetchImpl: jsonFetch(published),
    });
    expect(result.status).toBe('upgrade-available');
    expect(result.installed.cli).toBe(cliVersion);
  });

  it('reports incompatible when the installed tuple violates a published range', async () => {
    const published = manifest({
      cliVersion,
      skillsVersion: '1.24.0',
      pipelineVersion: '0.39.0',
      cliRange: '^99.0.0',
    });
    const result = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: makeRunner({ skills: '1.24.0' }),
      fetchImpl: jsonFetch(published),
    });
    expect(result.status).toBe('incompatible');
  });

  it('reports unknown and never blocks when offline with no cache', async () => {
    const offlineFetch: typeof fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND raw.githubusercontent.com');
    };
    const started = Date.now();
    const result = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: makeRunner({ skills: '1.24.0' }),
      fetchImpl: offlineFetch,
    });
    const elapsed = Date.now() - started;
    expect(result.status).toBe('unknown');
    expect(result.published).toBeNull();
    expect(result.ecosystemSource).toBe('unavailable');
    // The installed tuple is still read: an unreachable manifest degrades the
    // verdict, it does not blind the CLI to what is installed.
    expect(result.installed).toEqual({ cli: cliVersion, skills: '1.24.0', pipeline: null });
    expect(elapsed).toBeLessThan(2_000);
  });

  it('abandons a hung network within the hard timeout instead of blocking', async () => {
    // Ignores the abort signal entirely — the worst case the PO named. The
    // Promise.race timeout must still win, or a DNS black-hole would hang the CLI.
    const hungFetch: typeof fetch = () => new Promise<Response>(() => {});
    const started = Date.now();
    const result = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: makeRunner({ skills: '1.24.0' }),
      fetchImpl: hungFetch,
      timeoutMs: 50,
    });
    const elapsed = Date.now() - started;
    expect(result.status).toBe('unknown');
    expect(result.ecosystemSource).toBe('unavailable');
    expect(elapsed).toBeLessThan(2_000);
  });

  it('serves a fresh cache without touching the network within the TTL', async () => {
    const published = manifest({
      cliVersion,
      skillsVersion: '1.24.0',
      pipelineVersion: '0.39.0',
    });
    let calls = 0;
    const countingFetch: typeof fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ components: published }), { status: 200 });
    }) as typeof fetch;
    const runner = makeRunner({ skills: '1.24.0' });

    const first = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: runner,
      fetchImpl: countingFetch,
      now: 1_000,
    });
    expect(first.ecosystemSource).toBe('network');
    expect(calls).toBe(1);

    // Ten minutes later — still inside the 15-minute TTL — no second fetch.
    const boom: typeof fetch = () => {
      throw new Error('network must not be touched inside the TTL');
    };
    const second = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: runner,
      fetchImpl: boom,
      now: 1_000 + 10 * 60 * 1000,
    });
    expect(second.ecosystemSource).toBe('cache');
    expect(second.status).toBe('aligned');
    expect(calls).toBe(1);
  });

  it('falls back to a stale cache when a later fetch fails', async () => {
    const published = manifest({
      cliVersion,
      skillsVersion: '1.24.0',
      pipelineVersion: '0.39.0',
    });
    const runner = makeRunner({ skills: '1.24.0' });

    const first = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: runner,
      fetchImpl: jsonFetch(published),
      now: 1_000,
    });
    expect(first.ecosystemSource).toBe('network');

    // Past the TTL, and now offline: the cached manifest is reused, flagged stale.
    const offlineFetch: typeof fetch = async () => {
      throw new Error('offline');
    };
    const later = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: runner,
      fetchImpl: offlineFetch,
      now: 1_000 + 16 * 60 * 1000,
    });
    expect(later.ecosystemSource).toBe('stale-cache');
    expect(later.status).toBe('aligned');
    expect(later.published?.cli.version).toBe(cliVersion);
  });

  it('reads a local file source (the e2e override) without any network', async () => {
    const published = manifest({
      cliVersion,
      skillsVersion: '1.24.0',
      pipelineVersion: '0.39.0',
    });
    await mkdir(root, { recursive: true });
    const fixture = join(root, 'ecosystem.json');
    writeFileSync(fixture, JSON.stringify({ components: published }));
    process.env.OPENPLANR_ECOSYSTEM_SOURCE = fixture;
    const boom: typeof fetch = () => {
      throw new Error('a file source must not hit the network');
    };
    const result = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: makeRunner({ skills: '1.24.0' }),
      fetchImpl: boom,
    });
    expect(result.status).toBe('aligned');
  });

  it('leaves skills and pipeline null when the host is unavailable', async () => {
    const published = manifest({
      cliVersion,
      skillsVersion: '1.24.0',
      pipelineVersion: '0.39.0',
    });
    const result = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: makeRunner({ available: false }),
      fetchImpl: jsonFetch(published),
    });
    expect(result.installed).toEqual({ cli: cliVersion, skills: null, pipeline: null });
    // An absent plugin is not a compatibility violation.
    expect(result.status).toBe('aligned');
  });

  // drift used to be plain inequality, so "different" and "older" were the same
  // thing. Anyone on a build ahead of the registry (a linked dev build, a prerelease, a
  // maintainer mid-release) was offered a *downgrade* labelled as an upgrade, and
  // "always keep me current" would have applied it on every invocation.
  it('never reports upgrade-available when the installed CLI is ahead of published', async () => {
    const published = manifest({
      cliVersion: lowerCli,
      skillsVersion: '1.24.0',
      pipelineVersion: '0.39.0',
      cliRange: `^${lowerCli}`,
    });
    const result = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: makeRunner({ skills: '1.24.0' }),
      fetchImpl: jsonFetch(published),
    });
    expect(result.installed.cli).toBe(cliVersion);
    expect(result.published?.cli.version).toBe(lowerCli);
    // The decisive assertion: an installed version ahead of published has nothing to
    // upgrade to, so no offer may be surfaced for it.
    expect(result.status).not.toBe('upgrade-available');
    expect(result.status).toBe('aligned');
  });

  it('reports aligned when installed plugins are ahead of published, not incompatible', async () => {
    const published = manifest({
      cliVersion,
      skillsVersion: '1.24.0',
      pipelineVersion: '0.39.0',
    });
    const result = await reconcileInstalledTuple('/tmp/project', {
      // Both plugins ahead of what the manifest publishes, CLI exactly at published.
      claudeCommandRunner: makeRunner({ skills: '1.25.0' }),
      fetchImpl: jsonFetch(published),
    });
    // `aligned`, not merely "not upgrade-available": under plain inequality this tuple
    // read as drift with no explaining CLI advance, which classifies as `incompatible` —
    // so asserting only the absence of an offer would have passed before the fix too.
    // Nothing here is behind anything, so there is no drift to report at all.
    expect(result.status).toBe('aligned');
  });

  it('still reports upgrade-available when the CLI is genuinely behind', async () => {
    // The counterpart to the two above: adding a direction check must not silence the
    // case the offer exists to serve.
    const published = manifest({
      cliVersion: higherCli,
      skillsVersion: '1.24.0',
      pipelineVersion: '0.39.0',
      cliRange: `^${cliVersion}`,
    });
    const result = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: makeRunner({ skills: '1.24.0' }),
      fetchImpl: jsonFetch(published),
    });
    expect(result.status).toBe('upgrade-available');
  });
});

// ---------------------------------------------------------------------------
// T-003 — executeCliHalfUpgrade, the CLI-owned half plus the plugin prescription
// ---------------------------------------------------------------------------

/** An injectable npm runner that records every argv it is asked to run. */
function recordingNpm(behavior: (args: string[], index: number) => NpmCommandResult): {
  runner: NpmCommandRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner: NpmCommandRunner = (args) => {
    const index = calls.length;
    calls.push(args);
    return behavior(args, index);
  };
  return { runner, calls };
}

/**
 * A `claude` runner that records every invocation and answers only the
 * read-only inspection commands (`--version`, marketplace/plugin `list`). It
 * never mutates: the point is to prove `executeCliHalfUpgrade` reads host state
 * to build the prescription but never asks `claude` to install anything.
 */
function recordingClaude(
  installed: Array<{ id: string; version: string }> = [
    { id: 'planr@openplanr-local', version: '1.0.0' },
  ],
): { runner: ClaudeCommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  const answer = installedRunner(installed);
  const runner: ClaudeCommandRunner = (args) => {
    calls.push(args);
    return answer(args);
  };
  return { runner, calls };
}

/** The mutating `claude plugin` verbs the CLI must never invoke (FR4 hard constraint). */
function isMutatingClaudeCall(args: string[]): boolean {
  if (args[0] !== 'plugin') return false;
  if (args[1] === 'install' || args[1] === 'update' || args[1] === 'enable') return true;
  if (args[1] === 'marketplace' && (args[2] === 'add' || args[2] === 'update')) return true;
  return false;
}

describe('executeCliHalfUpgrade', () => {
  it('never imports applyBundledClaudePluginIntegration in the upgrade service or command (hard-constraint gate)', () => {
    // The literal "it upgrades the plugin too" reading (Trap E) can only pass by
    // wiring the plugin-install apply path — which this proves is absent.
    const service = readFileSync(resolve('src/services/upgrade-service.ts'), 'utf8');
    const command = readFileSync(resolve('src/cli/commands/upgrade.ts'), 'utf8');
    expect(service).not.toContain('applyBundledClaudePluginIntegration');
    expect(command).not.toContain('applyBundledClaudePluginIntegration');
  });

  it('upgrades the npm half, verifies the landed version, and prescribes the plugin half without mutating it', async () => {
    // Target the version already on disk so the real `readOpenPlanrVersion()`
    // verify passes with a no-op npm; the mutation is stubbed, the verify is real.
    const npm = recordingNpm(() => ({ status: 0, stdout: '', stderr: '' }));
    const claude = recordingClaude();
    const result = await executeCliHalfUpgrade({
      projectDir: '/tmp/project',
      targetCliVersion: cliVersion,
      npmCommandRunner: npm.runner,
      claudeCommandRunner: claude.runner,
    });

    expect(result.ok).toBe(true);
    expect(result.cliUpgraded).toBe(true);
    expect(result.installedVersion).toBe(cliVersion);
    expect(result.restoredTo).toBeUndefined();
    expect(result.failure).toBeUndefined();
    // Exactly one npm mutation: the global install of the target.
    expect(npm.calls).toEqual([['install', '-g', `openplanr@${cliVersion}`]]);
    // The prescription is built from a live inspection, but no mutating claude
    // command was ever run — the hard-constraint proof at the spawn boundary.
    expect(claude.calls.length).toBeGreaterThan(0);
    expect(claude.calls.some(isMutatingClaudeCall)).toBe(false);
    // The refresh of the bundled marketplace is prescribed first (FR4), then the
    // update of the plugin `planr setup` installed from it.
    expect(result.pluginHalfCommands).toEqual([
      'claude plugin marketplace update openplanr-local',
      'claude plugin update planr@openplanr-local --scope user',
    ]);
  });

  it('prescribes removing the retired remote plugins, never installing them (BL-006)', async () => {
    // A machine that ran `planr setup` after once installing from `openplanr/marketplace`:
    // the two retired plugins setup marks as legacy are still present beside the local one.
    const npm = recordingNpm(() => ({ status: 0, stdout: '', stderr: '' }));
    const claude = recordingClaude([
      { id: 'planr@openplanr-local', version: '1.0.0' },
      { id: 'openplanr@openplanr', version: '1.26.1' },
      { id: 'planr-pipeline@openplanr', version: '0.39.0' },
    ]);
    const result = await executeCliHalfUpgrade({
      projectDir: '/tmp/project',
      targetCliVersion: cliVersion,
      npmCommandRunner: npm.runner,
      claudeCommandRunner: claude.runner,
    });

    expect(result.ok).toBe(true);
    expect(result.pluginHalfCommands).toEqual([
      'claude plugin marketplace update openplanr-local',
      'claude plugin update planr@openplanr-local --scope user',
      'claude plugin uninstall openplanr@openplanr --scope user --keep-data --yes',
      'claude plugin uninstall planr-pipeline@openplanr --scope user --keep-data --yes',
    ]);
    // The decisive assertion: no command installs or updates a retired plugin.
    for (const command of result.pluginHalfCommands) {
      expect(command).not.toMatch(/^claude plugin (install|update) (openplanr|planr-pipeline)@/);
    }
  });

  it('leaves the installed version unchanged and reports ok:false when npm install fails (no mutation)', async () => {
    const npm = recordingNpm(() => ({
      status: 1,
      stdout: '',
      stderr: 'npm ERR! code E404',
    }));
    const claude = recordingClaude();
    const result = await executeCliHalfUpgrade({
      projectDir: '/tmp/project',
      targetCliVersion: higherCli,
      npmCommandRunner: npm.runner,
      claudeCommandRunner: claude.runner,
    });

    expect(result.ok).toBe(false);
    expect(result.cliUpgraded).toBe(false);
    expect(result.installedVersion).toBe(cliVersion); // unchanged
    expect(result.changelogBullets).toEqual([]);
    expect(result.pluginHalfCommands).toEqual([]);
    expect(result.failure?.step).toBe('npm-install');
    // A failed install is not retried and the plugin half is never inspected.
    expect(npm.calls).toHaveLength(1);
    expect(claude.calls).toHaveLength(0);
  });

  it('restores the previous version when a zero-exit install lands the wrong version (Trap D, non-vacuous)', async () => {
    // npm exits clean on every call, but the on-disk version never becomes the
    // target — the decisive FR9 case. The guard is the restore call; its proof
    // is the second npm invocation. Revert that call in the source and this
    // `toHaveLength(2)` / `calls[1]` assertion goes red.
    const npm = recordingNpm(() => ({ status: 0, stdout: '', stderr: '' }));
    const result = await executeCliHalfUpgrade({
      projectDir: '/tmp/project',
      targetCliVersion: higherCli,
      npmCommandRunner: npm.runner,
      claudeCommandRunner: recordingClaude().runner,
    });

    expect(result.ok).toBe(false);
    expect(result.cliUpgraded).toBe(false);
    expect(result.restoredTo).toBe(cliVersion);
    expect(result.installedVersion).toBe(cliVersion);
    expect(result.failure?.step).toBe('verify');
    expect(result.failure?.message).toContain('Restored the previous version');
    // The observable proof of the restore: two npm calls, the second reinstalling
    // the captured previous version.
    expect(npm.calls).toHaveLength(2);
    expect(npm.calls[0]).toEqual(['install', '-g', `openplanr@${higherCli}`]);
    expect(npm.calls[1]).toEqual(['install', '-g', `openplanr@${cliVersion}`]);
    // A partial upgrade never renders a summary or prescription.
    expect(result.changelogBullets).toEqual([]);
    expect(result.pluginHalfCommands).toEqual([]);
  });

  it('reports the manual recovery command when the automatic restore also fails', async () => {
    // Install exits clean (wrong version), restore exits non-zero: the user must
    // be told exactly how to recover, never left thinking the machine is fine.
    const npm = recordingNpm((_args, index) =>
      index === 0
        ? { status: 0, stdout: '', stderr: '' }
        : { status: 1, stdout: '', stderr: 'registry unreachable' },
    );
    const result = await executeCliHalfUpgrade({
      projectDir: '/tmp/project',
      targetCliVersion: higherCli,
      npmCommandRunner: npm.runner,
    });

    expect(result.ok).toBe(false);
    expect(result.failure?.step).toBe('verify');
    expect(result.failure?.message).toContain(`npm install -g openplanr@${cliVersion}`);
  });
});

describe('prescribePluginHalfCommands (FR4 — refresh first)', () => {
  const marketplaceRoot = '/bundled/host-packages/claude';
  const op = (kind: ClaudePluginOperation['kind'], id: string): ClaudePluginOperation => ({
    runtime: 'claude-code',
    kind,
    id,
    scope: 'user',
    description: kind,
  });

  it('places the marketplace refresh first even when the operations arrive out of order', () => {
    const commands = prescribePluginHalfCommands(
      [
        op('update', 'planr@openplanr-local'),
        op('remove', 'openplanr@openplanr'),
        op('refresh-marketplace', 'openplanr-local'),
        op('enable', 'planr@openplanr-local'),
      ],
      marketplaceRoot,
    );
    // Revert the stable-sort in the source and commands[0] becomes the update —
    // this assertion is the non-vacuous guard for "without the refresh step the
    // installer reinstalls the stale version."
    expect(commands[0]).toBe('claude plugin marketplace update openplanr-local');
    expect(commands).toEqual([
      'claude plugin marketplace update openplanr-local',
      'claude plugin update planr@openplanr-local --scope user',
      'claude plugin uninstall openplanr@openplanr --scope user --keep-data --yes',
      'claude plugin enable planr@openplanr-local --scope user',
    ]);
  });

  it('prescribes planr setup when the bundled marketplace is not registered yet', () => {
    // Only setup registers the directory marketplace and records the installation, so a
    // raw `claude plugin marketplace add <path>` is never the advice.
    const commands = prescribePluginHalfCommands(
      [op('add-marketplace', 'openplanr-local'), op('install', 'planr@openplanr-local')],
      marketplaceRoot,
    );
    expect(commands).toEqual([CLAUDE_PLUGIN_SETUP_COMMAND]);
    expect(CLAUDE_PLUGIN_SETUP_COMMAND).toBe('planr setup --runtime claude --scope user');
  });

  it('adds --replace-managed when setup must also retire a legacy plugin', () => {
    // applySetup throws E_INSTALL_MODE_CONFLICT on a claude-code remove without the flag, and
    // --runtime disables the guided prompt that would otherwise offer it, so the plain command
    // would fail for exactly the machines still carrying a retired remote plugin.
    const commands = prescribePluginHalfCommands(
      [
        op('add-marketplace', 'openplanr-local'),
        op('install', 'planr@openplanr-local'),
        op('remove', 'openplanr@openplanr'),
      ],
      marketplaceRoot,
    );
    expect(commands).toEqual(['planr setup --runtime claude --scope user --replace-managed']);
  });
});

describe('summarizeChangelogBetween (FR8 — what is new, honestly)', () => {
  const changelog = readFileSync(resolve('CHANGELOG.md'), 'utf8');

  /** The raw text between two `## <version>` headers, for the substring proof. */
  function rawRange(oldVersion: string, newVersion: string): string {
    const start = changelog.indexOf(`## ${newVersion}`);
    const end = changelog.indexOf(`## ${oldVersion}`, start + 1);
    return changelog.slice(start, end === -1 ? undefined : end);
  }

  it('returns only bullets that are verbatim substrings of the changelog in that range', () => {
    const bullets = summarizeChangelogBetween('1.20.0', '1.21.2');
    const range = rawRange('1.20.0', '1.21.2');
    expect(bullets.length).toBeGreaterThan(0);
    for (const bullet of bullets) {
      // The non-fabrication guarantee: never a change the changelog does not carry.
      expect(range).toContain(bullet);
    }
    // A concrete entry from inside the window is summarised...
    expect(bullets.some((b) => b.includes('planr-pipeline 0.38.0'))).toBe(true);
    // ...and nothing from the excluded old (1.20.0) section leaks in.
    expect(bullets.some((b) => b.includes('SPEC-004'))).toBe(false);
  });

  it('returns an empty summary rather than inventing one when the target version has no entry', () => {
    expect(summarizeChangelogBetween('1.22.0', '99.99.99')).toEqual([]);
  });
});

describe('planCliUpgrade (FR4 — execute what it can)', () => {
  const reconciliation = (
    status: UpgradeReconciliation['status'],
    installedCli: string,
    publishedCli: string,
  ): UpgradeReconciliation => ({
    status,
    installed: { cli: installedCli, skills: null, pipeline: null },
    published:
      status === 'unknown'
        ? null
        : {
            cli: { version: publishedCli },
            pipeline: { version: '0.39.0' },
            skills: { version: '1.24.0' },
          },
    ecosystemSource: 'network',
  });

  it('does not upgrade an aligned tuple', () => {
    expect(planCliUpgrade(reconciliation('aligned', '1.22.0', '1.22.0')).proceed).toBe(false);
  });

  it('upgrades to the published version when an upgrade is available', () => {
    const plan = planCliUpgrade(reconciliation('upgrade-available', '1.22.0', '1.23.0'));
    expect(plan.proceed).toBe(true);
    expect(plan.targetCliVersion).toBe('1.23.0');
  });

  it('upgrades an incompatible tuple only when the CLI is the one behind', () => {
    expect(planCliUpgrade(reconciliation('incompatible', '1.22.0', '1.23.0')).proceed).toBe(true);
    // CLI ahead of the published set cannot be fixed by upgrading it.
    expect(planCliUpgrade(reconciliation('incompatible', '1.23.0', '1.22.0')).proceed).toBe(false);
  });

  it('does not upgrade when the manifest is unavailable', () => {
    expect(planCliUpgrade(reconciliation('unknown', '1.22.0', '1.22.0')).proceed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// When the CLI is already current but the plugin half
// trails, `apply` returns before the prescription is ever built, while its own
// message promises "run the prescribed commands below". That state is what every
// release creates for anyone who upgrades the npm half first, and it shipped
// because the prescription was only ever tested as a bare function.
//
// This drives the real CLI as a subprocess through the repo's tsx loader, so it
// exercises the current wiring rather than a service call: a fabricated manifest
// (OPENPLANR_ECOSYSTEM_SOURCE) publishes a plugin version ahead of what a stubbed
// `claude` (OPENPLANR_CLAUDE_BIN) reports installed from the bundled marketplace,
// with the CLI exactly at the published version.
// ---------------------------------------------------------------------------
describe('upgrade apply prescribes the plugin half when only the plugins trail', () => {
  const cliEntry = resolve('src/cli/index.ts');

  function stubClaude(scriptPath: string, installed: { skills: string }): void {
    writeFileSync(
      scriptPath,
      `const key = process.argv.slice(2).join(' ');
if (key === '--version') { process.stdout.write('1.0.0'); process.exit(0); }
if (key === 'plugin marketplace list --json') {
  process.stdout.write(JSON.stringify([{ name: 'openplanr-local', source: 'directory' }]));
  process.exit(0);
}
if (key === 'plugin list --json') {
  process.stdout.write(JSON.stringify([
    { id: 'planr@openplanr-local', version: ${JSON.stringify(installed.skills)}, scope: 'user', enabled: true },
  ]));
  process.exit(0);
}
process.stdout.write('[]');
process.exit(0);
`,
    );
  }

  it('prints the bundled marketplace refresh first, then the update of planr@openplanr-local', () => {
    const manifestPath = join(root, 'ecosystem.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        components: {
          // The CLI is exactly at the published version — nothing for the npm half to do.
          cli: { version: cliVersion, pipelineRange: '^0.40.0' },
          pipeline: { version: '0.40.0', cliRange: `^${cliVersion}` },
          skills: { version: cliVersion, cliRange: `^${cliVersion}` },
        },
      }),
    );

    const claudeStub = join(root, 'claude-stub.cjs');
    stubClaude(claudeStub, { skills: '1.25.0' });

    // `apply` sets exit code 1 on an incompatible tuple — correctly, since the tuple is
    // not resolved by this command. `execFileSync` throws on that, so the stdout it
    // captured is read off the error. The output is the assertion target either way.
    let output: string;
    try {
      output = execFileSync(
        process.execPath,
        ['--import', 'tsx', cliEntry, '--project-dir', root, 'upgrade', 'apply', '--yes'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            OPENPLANR_HOME: userHome,
            OPENPLANR_ECOSYSTEM_SOURCE: manifestPath,
            OPENPLANR_CLAUDE_BIN: claudeStub,
            NO_COLOR: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch (error) {
      output = (error as { stdout?: string }).stdout ?? '';
    }

    // The promise in the reason string must be kept by the same invocation.
    expect(output).toContain('the plugin half must move');
    const refreshAt = output.indexOf('claude plugin marketplace update openplanr-local');
    const skillsAt = output.indexOf('claude plugin update planr@openplanr-local --scope user');

    expect(refreshAt).toBeGreaterThanOrEqual(0);
    expect(skillsAt).toBeGreaterThanOrEqual(0);
    // Order is load-bearing: without the refresh first the installer reinstalls the
    // cached stale version and the user believes they upgraded.
    expect(refreshAt).toBeLessThan(skillsAt);
    // The advice names the plugin `planr setup` installs and never the retired
    // remote plugins setup itself marks as legacy.
    expect(output).toContain('planr setup');
    expect(output).not.toContain('openplanr@openplanr');
    expect(output).not.toContain('planr-pipeline@openplanr');
  }, 30_000);
});

describe('reconcileInstalledTuple against the npm registry document (BL-026)', () => {
  const pipelinePin = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    .optionalDependencies['planr-pipeline'] as string;

  function registryFetch(document: Record<string, unknown>): typeof fetch {
    return (async () =>
      new Response(JSON.stringify(document), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
  }

  function registryDocument(version: string, pin = pipelinePin): Record<string, unknown> {
    return { name: 'openplanr', version, optionalDependencies: { 'planr-pipeline': pin } };
  }

  it('defaults to the registry document of the published CLI, not a repository manifest', () => {
    expect(DEFAULT_ECOSYSTEM_SOURCE).toBe('https://registry.npmjs.org/openplanr/latest');
  });

  it('reports aligned when the CLI is current and its bundled pipeline matches the published pin', async () => {
    const result = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: makeRunner({ available: false }),
      fetchImpl: registryFetch(registryDocument(cliVersion)),
    });
    expect(result.status).toBe('aligned');
    expect(result.published?.shape).toBe('registry');
    expect(result.published?.pipeline.version).toBe(pipelinePin);
    expect(result.published?.skills.version).toBe(cliVersion);
    expect(result.bundledPipeline).toBe(pipelinePin);
    expect(result.installed).toEqual({ cli: cliVersion, skills: null, pipeline: null });
    expect(result.legacyPlugins).toEqual([]);
  });

  it('reports upgrade-available when the registry serves a newer CLI', async () => {
    const result = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: makeRunner({ available: false }),
      fetchImpl: registryFetch(registryDocument(higherCli)),
    });
    expect(result.status).toBe('upgrade-available');
    expect(result.published?.cli.version).toBe(higherCli);
  });

  it('reports incompatible when planr@openplanr-local trails the bundled marketplace (the plugin half must move)', async () => {
    const result = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: installedRunner([{ id: 'planr@openplanr-local', version: '1.0.0' }]),
      fetchImpl: registryFetch(registryDocument(cliVersion)),
    });
    // The plugin `planr setup` installs is the host plugin, never a legacy one.
    expect(result.installed.skills).toBe('1.0.0');
    expect(result.legacyPlugins).toEqual([]);
    // A current CLI cannot fix a trailing plugin; doctor's classification makes that a
    // failure so `upgrade apply` prints the plugin-half prescription instead of reinstalling.
    expect(result.status).toBe('incompatible');
    expect(planCliUpgrade(result).proceed).toBe(false);
  });

  it('lists a retired remote plugin as legacy without judging the tuple incompatible', async () => {
    const result = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: installedRunner([
        { id: 'planr@openplanr-local', version: cliVersion },
        { id: 'openplanr@openplanr', version: '1.26.2' },
      ]),
      fetchImpl: registryFetch(registryDocument(cliVersion)),
    });
    expect(result.legacyPlugins).toEqual(['openplanr@openplanr']);
    // Doctor classifies a leftover plugin as a warning; the upgrade verdict must agree.
    expect(result.status).toBe('aligned');
  });

  it('reads the host plugin from planr@openplanr-local when a marketplace-installed planr@openplanr sits beside it (BL-071)', async () => {
    const result = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: installedRunner([
        { id: 'planr@openplanr-local', version: cliVersion },
        { id: 'planr@openplanr', version: '2.6.1' },
      ]),
      fetchImpl: registryFetch(registryDocument(cliVersion)),
    });
    expect(result.installed.skills).toBe(cliVersion);
    // The duplicate is doctor's warning, not a legacy id and never an upgrade verdict.
    expect(result.legacyPlugins).toEqual([]);
    expect(result.status).toBe('aligned');
  });

  it('ignores a registry document without a parseable pipeline pin', async () => {
    const result = await reconcileInstalledTuple('/tmp/project', {
      claudeCommandRunner: makeRunner({ available: false }),
      fetchImpl: registryFetch({ name: 'openplanr', version: cliVersion }),
    });
    expect(result.status).toBe('unknown');
    expect(result.ecosystemSource).toBe('unavailable');
  });
});
