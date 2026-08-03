import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ClaudeCommandRunner,
  type ClaudePluginOperation,
  formatClaudePluginOperationCommand,
  inspectClaudePluginIntegration,
  OPENPLANR_CLAUDE_MARKETPLACE_SOURCE,
} from './claude-plugin-service.js';
import { resolvePipelinePackage } from './pipeline-package-service.js';
import { readOpenPlanrVersion } from './provenance-service.js';
import { classifyComponentDrift, runtimeRoot } from './runtime-manager-service.js';

/**
 * One component of the published compatibility manifest (`ecosystem.json`'s
 * `components.*`). Each artifact carries its own version plus the mutual
 * compatibility range it requires of its sibling.
 */
export interface EcosystemComponent {
  version: string;
  cliRange?: string;
  pipelineRange?: string;
}

export interface EcosystemComponents {
  cli: EcosystemComponent;
  pipeline: EcosystemComponent;
  skills: EcosystemComponent;
  marketplace?: EcosystemComponent;
}

/**
 * Where the compatibility manifest came from for this reconciliation.
 *
 * - `network`  — freshly fetched and cached this run.
 * - `cache`    — a still-fresh cache (within the TTL); no network was touched.
 * - `stale-cache` — the fetch failed, so a past cache was reused.
 * - `unavailable` — neither a fetch nor any cache; the tuple cannot be judged.
 */
export type EcosystemSource = 'network' | 'cache' | 'stale-cache' | 'unavailable';

export interface UpgradeReconciliation {
  status: 'aligned' | 'upgrade-available' | 'incompatible' | 'unknown';
  installed: { cli: string; skills: string | null; pipeline: string | null };
  published: EcosystemComponents | null;
  ecosystemSource: EcosystemSource;
}

export interface ReconcileOptions {
  /** Injectable `claude` runner; defaults to the real host command. */
  claudeCommandRunner?: ClaudeCommandRunner;
  /** Injectable fetch, for hermetic offline/hung-network tests. */
  fetchImpl?: typeof fetch;
  /** Clock override (ms since epoch), for deterministic TTL tests. */
  now?: number;
  /** Hard fetch timeout in ms; a hung network must never exceed this. */
  timeoutMs?: number;
}

/**
 * The published manifest lives at `main` HEAD of the marketplace repository,
 * whose closeout sequence guarantees HEAD only reflects a finalized operation.
 * `OPENPLANR_ECOSYSTEM_SOURCE` overrides it with an `http(s)` URL (a local stub
 * server) or a filesystem path (a fixture), which the packed e2e test uses to
 * avoid any real network.
 */
const DEFAULT_ECOSYSTEM_URL = `https://raw.githubusercontent.com/${OPENPLANR_CLAUDE_MARKETPLACE_SOURCE}/main/ecosystem.json`;

/**
 * Within the TTL the cached manifest is trusted without a network round-trip.
 * This is what keeps an otherwise-offline-capable CLI from acquiring a network
 * dependency on every check.
 */
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * A short hard ceiling on the fetch. A captive portal, a VPN, or an airplane
 * must never make `planr` hang: past this, the fetch is abandoned and the CLI
 * falls back to cache (or reports the manifest unavailable).
 */
const DEFAULT_FETCH_TIMEOUT_MS = 2_000;

function ecosystemSourceLocation(): string {
  return process.env.OPENPLANR_ECOSYSTEM_SOURCE?.trim() || DEFAULT_ECOSYSTEM_URL;
}

function ecosystemCachePath(): string {
  return path.join(runtimeRoot(), 'ecosystem-cache.json');
}

/** Narrow the raw manifest JSON to the compatibility components we reconcile. */
function parseComponents(text: string): EcosystemComponents | null {
  try {
    const data = JSON.parse(text) as {
      components?: {
        cli?: EcosystemComponent;
        pipeline?: EcosystemComponent;
        skills?: EcosystemComponent;
        marketplace?: EcosystemComponent;
      };
    };
    const components = data.components;
    if (!components?.cli?.version || !components.pipeline?.version || !components.skills?.version) {
      return null;
    }
    return {
      cli: { version: components.cli.version, ...pickRange(components.cli) },
      pipeline: { version: components.pipeline.version, ...pickRange(components.pipeline) },
      skills: { version: components.skills.version, ...pickRange(components.skills) },
      ...(components.marketplace?.version
        ? { marketplace: { version: components.marketplace.version } }
        : {}),
    };
  } catch {
    return null;
  }
}

function pickRange(component: EcosystemComponent): {
  cliRange?: string;
  pipelineRange?: string;
} {
  return {
    ...(component.cliRange ? { cliRange: component.cliRange } : {}),
    ...(component.pipelineRange ? { pipelineRange: component.pipelineRange } : {}),
  };
}

interface CacheFile {
  fetchedAt: number;
  components: EcosystemComponents;
}

function readCache(): CacheFile | null {
  const cachePath = ecosystemCachePath();
  if (!existsSync(cachePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as Partial<CacheFile>;
    if (typeof parsed.fetchedAt !== 'number' || !parsed.components?.cli?.version) return null;
    return { fetchedAt: parsed.fetchedAt, components: parsed.components };
  } catch {
    return null;
  }
}

async function writeCache(components: EcosystemComponents, now: number): Promise<void> {
  const cachePath = ecosystemCachePath();
  await mkdir(path.dirname(cachePath), { recursive: true });
  const payload: CacheFile = { fetchedAt: now, components };
  await writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * Read the manifest text, bounded by a hard timeout that always wins even if
 * the underlying fetch ignores the abort signal. A local filesystem source is
 * read directly (no timeout needed). Any failure resolves to `null`.
 */
async function fetchManifestText(
  location: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  if (!/^https?:\/\//i.test(location)) {
    try {
      return await readFile(location, 'utf8');
    } catch {
      return null;
    }
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  const attempt = (async (): Promise<string | null> => {
    try {
      const response = await fetchImpl(location, { signal: controller.signal });
      if (!response.ok) return null;
      return await response.text();
    } catch {
      return null;
    }
  })();

  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadEcosystem(
  options: ReconcileOptions,
): Promise<{ components: EcosystemComponents | null; source: EcosystemSource }> {
  const now = options.now ?? Date.now();
  const cache = readCache();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { components: cache.components, source: 'cache' };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const text = await fetchManifestText(ecosystemSourceLocation(), fetchImpl, timeoutMs);
  const fetched = text ? parseComponents(text) : null;
  if (fetched) {
    await writeCache(fetched, now);
    return { components: fetched, source: 'network' };
  }

  if (cache) return { components: cache.components, source: 'stale-cache' };
  return { components: null, source: 'unavailable' };
}

/** Parse an `X.Y.Z` version into numeric parts, or `null` if it is not stable. */
function stableVersionParts(version: string): number[] | null {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
  return version.split('.').map(Number);
}

/**
 * The same major/minor compatibility window `claude-plugin-service.ts`'s
 * `newestCompatibleTarget` already applies, expressed as range satisfaction so
 * no `semver` dependency is added: a caret range `^X.Y.Z` is satisfied by the
 * same major (and, when the major is 0, the same minor) at or above the base.
 * Anything unparseable is treated as satisfied — an absent range must never be
 * reported as an incompatibility.
 */
function satisfiesRange(version: string, range: string): boolean {
  const base = range.startsWith('^') ? range.slice(1) : range;
  const target = stableVersionParts(base);
  const actual = stableVersionParts(version);
  if (!target || !actual) return true;
  if (actual[0] !== target[0]) return false;
  if (target[0] === 0 && actual[1] !== target[1]) return false;
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] > target[index]) return true;
    if (actual[index] < target[index]) return false;
  }
  return true;
}

/** A present installed version that falls outside a declared range is a violation. */
function violatesRange(version: string | null, range: string | undefined): boolean {
  if (!version || !range) return false;
  return !satisfiesRange(version, range);
}

/**
 * FR3: read the published compatibility manifest, compare it against the real
 * installed tuple (this CLI's version, plus both host-plugin versions), and
 * report whether the tuple is aligned, has an upgrade available, or is
 * genuinely incompatible. The warn-vs-fail call is delegated to
 * `classifyComponentDrift` so it is doctor's exact distinction, not a re-derivation.
 */
export async function reconcileInstalledTuple(
  _projectDir: string,
  options: ReconcileOptions = {},
): Promise<UpgradeReconciliation> {
  const cliVersion = readOpenPlanrVersion();
  const pipelinePackageVersion = resolvePipelinePackage(false)?.version ?? cliVersion;
  const inspection = inspectClaudePluginIntegration(
    pipelinePackageVersion,
    options.claudeCommandRunner,
  );
  const skillsInstalled =
    inspection.plugins.find((plugin) => plugin.name === 'openplanr')?.installedVersion ?? null;
  const pipelineInstalled =
    inspection.plugins.find((plugin) => plugin.name === 'planr-pipeline')?.installedVersion ?? null;
  const installed = { cli: cliVersion, skills: skillsInstalled, pipeline: pipelineInstalled };

  const { components: published, source: ecosystemSource } = await loadEcosystem(options);
  if (!published) {
    return { status: 'unknown', installed, published: null, ecosystemSource };
  }

  const cliDrift = installed.cli !== published.cli.version;
  const componentDrift =
    cliDrift ||
    (installed.skills !== null && installed.skills !== published.skills.version) ||
    (installed.pipeline !== null && installed.pipeline !== published.pipeline.version);
  // A real mutual-compatibility violation: an installed component sits outside
  // the range its published sibling declares. Absent (uninstalled) plugins are
  // not violations — that is a different condition from incompatibility.
  const incompatibleDrift =
    violatesRange(installed.pipeline, published.cli.pipelineRange) ||
    violatesRange(installed.cli, published.skills.cliRange) ||
    violatesRange(installed.cli, published.pipeline.cliRange);

  const classification = classifyComponentDrift({ cliDrift, componentDrift, incompatibleDrift });
  const status =
    classification.status === 'pass'
      ? 'aligned'
      : classification.status === 'warn'
        ? 'upgrade-available'
        : 'incompatible';

  return { status, installed, published, ecosystemSource };
}

// ===========================================================================
// T-003 — Execute the CLI-half upgrade safely, prescribe the plugin half
// (FR4/FR8/FR9). Additive to the reconcile region above: this consumes
// `reconcileInstalledTuple`'s verdict, it never re-derives it.
// ===========================================================================

export interface NpmCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type NpmCommandRunner = (args: string[]) => NpmCommandResult;

/**
 * The npm-owned half of an upgrade is a single global install. This mirrors
 * `claude-plugin-service.ts`'s `defaultRunner`: a thin `spawnSync` wrapper that
 * surfaces exit status and streams rather than throwing.
 *
 * `OPENPLANR_NPM_BIN` is a test seam of the same shape as T-002's
 * `OPENPLANR_ECOSYSTEM_SOURCE`: a path to a Node script that stands in for the
 * npm binary, so the packed-install e2e can drive a real `apply` without a real,
 * machine-wide `npm install -g`. Unset in production, where the real `npm` runs.
 */
function defaultNpmRunner(args: string[]): NpmCommandResult {
  const override = process.env.OPENPLANR_NPM_BIN?.trim();
  const onWindows = process.platform === 'win32';
  const command = override ? process.execPath : onWindows ? 'npm.cmd' : 'npm';
  const commandArgs = override ? [override, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    windowsHide: true,
    shell: !override && onWindows,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error } : {}),
  };
}

/** Compare two `X.Y.Z` versions: -1 (a<b), 0 (equal or unparseable), 1 (a>b). */
function compareStableVersions(a: string, b: string): number {
  const left = stableVersionParts(a);
  const right = stableVersionParts(b);
  if (!left || !right) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

export interface UpgradePlan {
  proceed: boolean;
  targetCliVersion: string | null;
  reason: string;
}

/**
 * FR4 ownership split, decided once so the CLI command stays thin: the npm half
 * is executed only when the CLI itself can move forward — `upgrade-available`,
 * or `incompatible` with the CLI genuinely behind the published version. An
 * `incompatible` tuple whose CLI is not behind cannot be fixed by upgrading the
 * CLI (the plugin half must move); apply prints the prescription instead of
 * mutating. `aligned`/`unknown` never mutate.
 */
export function planCliUpgrade(reconciliation: UpgradeReconciliation): UpgradePlan {
  const { status, installed, published } = reconciliation;
  if (!published) {
    return {
      proceed: false,
      targetCliVersion: null,
      reason:
        'The published compatibility manifest is unavailable; no upgrade target can be determined.',
    };
  }
  const target = published.cli.version;
  if (status === 'aligned') {
    return {
      proceed: false,
      targetCliVersion: null,
      reason:
        'The installed tuple already matches the published compatible set; nothing to upgrade.',
    };
  }
  if (status === 'upgrade-available') {
    return {
      proceed: true,
      targetCliVersion: target,
      reason: `An upgrade is available: the CLI can move from ${installed.cli} to ${target}.`,
    };
  }
  if (status === 'incompatible' && compareStableVersions(installed.cli, target) < 0) {
    return {
      proceed: true,
      targetCliVersion: target,
      reason: `The tuple is incompatible and the CLI is behind; moving the CLI from ${installed.cli} to ${target}.`,
    };
  }
  if (status === 'incompatible') {
    return {
      proceed: false,
      targetCliVersion: null,
      reason: `The tuple is incompatible but the CLI (${installed.cli}) is not behind the published ${target}; the plugin half must move — run the prescribed commands below.`,
    };
  }
  return {
    proceed: false,
    targetCliVersion: null,
    reason: 'The tuple could not be judged.',
  };
}

/**
 * The changelog is read from the package that is on disk *after* the install,
 * so a successful upgrade summarises the target's own entries. Resolved the same
 * way `readOpenPlanrVersion` finds `package.json`, and shipped in the package's
 * `files` list so this works on a real installed tuple, not only in-repo.
 */
function locateChangelog(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    path.resolve(here, '../../CHANGELOG.md'),
    path.resolve(here, '../../../CHANGELOG.md'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function changelogHeaderMatches(line: string, version: string): boolean {
  const trimmed = line.trim();
  return trimmed === `## ${version}` || trimmed === `## [${version}]`;
}

/**
 * Extract only the real `-` list items from a slice of changelog lines. A
 * changeset commit-hash link prefix is stripped so the text is user-facing, and
 * because only a leading prefix is removed each returned bullet stays a verbatim
 * substring of the file — a summary can never carry a change the changelog does
 * not. Multi-line wrapped items keep only their first line, which preserves that
 * substring guarantee.
 */
function extractChangelogBullets(lines: string[]): string[] {
  const bullets: string[] = [];
  for (const raw of lines) {
    const match = /^\s*-\s+(.*\S)\s*$/.exec(raw);
    if (!match) continue;
    const cleaned = match[1].replace(/^\[`[0-9a-f]+`\]\([^)]*\)\s*/, '').trim();
    if (cleaned) bullets.push(cleaned);
  }
  return bullets;
}

/**
 * FR8 — "what's new, honestly." Return the changelog bullets between two
 * `## <version>` headers: everything after `## <newVersion>` and before
 * `## <oldVersion>` (the changelog is newest-first, so the new version sits
 * above the old one). Only real list items in that window are returned, each
 * verbatim from the file. When the window or its entries are missing — an
 * unreleased target, a CHANGELOG the package does not ship, a shifted file, no
 * bullets — the result is empty, and the caller says so rather than inventing a
 * summary. If the old header is absent, the window is bounded at the next
 * version header so a summary can never reach back past the target's section.
 */
export function summarizeChangelogBetween(oldVersion: string, newVersion: string): string[] {
  const changelogPath = locateChangelog();
  if (!changelogPath) return [];
  let text: string;
  try {
    text = readFileSync(changelogPath, 'utf8');
  } catch {
    return [];
  }
  const lines = text.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => changelogHeaderMatches(line, newVersion));
  if (startIndex === -1) return [];

  let endIndex = lines.length;
  let firstHeaderAfterStart = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (firstHeaderAfterStart === lines.length && /^##\s/.test(lines[index].trim())) {
      firstHeaderAfterStart = index;
    }
    if (changelogHeaderMatches(lines[index], oldVersion)) {
      endIndex = index;
      break;
    }
  }
  // Old header never found: bound at the target's own section rather than
  // over-claiming every older entry as "new".
  if (endIndex === lines.length) endIndex = firstHeaderAfterStart;

  return extractChangelogBullets(lines.slice(startIndex + 1, endIndex));
}

/**
 * FR4's manifest-refresh guarantee: the marketplace add/refresh command is
 * printed FIRST — "without which the installer reinstalls the stale version." A
 * stable sort keeps every other operation in the order
 * `inspectClaudePluginIntegration` produced, and each is rendered by
 * `formatClaudePluginOperationCommand` (the same argv an apply would run), so
 * the prescription can never drift from what would actually execute. This is a
 * pure formatter — it prints the plugin half, it never runs it.
 */
export function prescribePluginHalfCommands(operations: ClaudePluginOperation[]): string[] {
  const rank = (operation: ClaudePluginOperation): number =>
    operation.kind === 'add-marketplace' || operation.kind === 'refresh-marketplace' ? 0 : 1;
  return [...operations].sort((a, b) => rank(a) - rank(b)).map(formatClaudePluginOperationCommand);
}

/** One migration's outcome as the injected registry runner reports it (T-006). */
export interface MigrationRunResult {
  id: string;
  applied: boolean;
  alreadyApplied: boolean;
  failure?: string;
}

/**
 * FR7's migration registry, injected rather than imported so this service owns
 * only the call site and result field (the registry lives in
 * `migration-registry.ts`). Called with the pre-upgrade and verified
 * post-upgrade versions so a migration runs only when the upgrade crosses its
 * version. `runPendingMigrations` satisfies this shape structurally.
 */
export type MigrationRunner = (
  fromVersion: string,
  toVersion: string,
  ctx: { projectDir: string },
) => Promise<MigrationRunResult[]>;

export interface ExecuteCliHalfUpgradeInput {
  projectDir: string;
  targetCliVersion: string;
  /** Injectable npm runner; defaults to the real (or `OPENPLANR_NPM_BIN`) npm. */
  npmCommandRunner?: NpmCommandRunner;
  /** Injectable `claude` runner for the prescription's inspection (hermetic tests). */
  claudeCommandRunner?: ClaudeCommandRunner;
  /**
   * FR7 migration runner, run after the CLI half verifies. Omitted (no runner)
   * means no migrations are attempted; the `apply` command injects the real
   * registry's `runPendingMigrations`.
   */
  migrationRunner?: MigrationRunner;
}

export interface ExecuteCliHalfUpgradeResult {
  ok: boolean;
  cliUpgraded: boolean;
  installedVersion: string;
  restoredTo?: string;
  changelogBullets: string[];
  pluginHalfCommands: string[];
  /** Per-migration results for every registered migration this upgrade crossed. */
  migrations: MigrationRunResult[];
  failure?: {
    step: 'npm-install' | 'verify' | 'changelog' | 'migration';
    message: string;
  };
}

/**
 * FR4/FR8/FR9. Execute the one half the CLI owns — a global npm install — and
 * prescribe (never execute) the plugin half.
 *
 * FR9's atomicity is enforced by verify-after-write: the previously installed
 * version is captured *before* any mutation as the restorable backup, and after
 * a zero-exit install the on-disk version is re-read. A clean exit that did not
 * land the target is the decisive case the spec names — it triggers an automatic
 * reinstall of the captured previous version and reports exactly what was
 * restored, so a partially-upgraded install can never report success. `ok` is
 * `false` whenever an owned step fails, even when npm itself exited zero.
 */
export async function executeCliHalfUpgrade(
  input: ExecuteCliHalfUpgradeInput,
): Promise<ExecuteCliHalfUpgradeResult> {
  const runNpm = input.npmCommandRunner ?? defaultNpmRunner;
  // The restorable backup, captured before any mutation: the version we can
  // always reinstall to undo a bad upgrade.
  const previousVersion = readOpenPlanrVersion();

  const install = runNpm(['install', '-g', `openplanr@${input.targetCliVersion}`]);
  if (install.error || install.status !== 0) {
    // A failed global install leaves the previous package in place — npm never
    // half-replaces a package. Report honestly; render nothing.
    const detail =
      install.error?.message || install.stderr.trim() || `npm exited with status ${install.status}`;
    return {
      ok: false,
      cliUpgraded: false,
      installedVersion: readOpenPlanrVersion(),
      changelogBullets: [],
      pluginHalfCommands: [],
      migrations: [],
      failure: {
        step: 'npm-install',
        message: `npm install of openplanr@${input.targetCliVersion} failed: ${detail}. The previous version ${previousVersion} is untouched.`,
      },
    };
  }

  // Verify-after-write: re-read the on-disk version the install just wrote.
  const verifiedVersion = readOpenPlanrVersion();
  if (verifiedVersion !== input.targetCliVersion) {
    // The decisive FR9 case: a clean exit that did NOT land the target. Restore
    // the captured previous version and never report success.
    const restore = runNpm(['install', '-g', `openplanr@${previousVersion}`]);
    const restoredVersion = readOpenPlanrVersion();
    const restored = !restore.error && restore.status === 0 && restoredVersion === previousVersion;
    const message = restored
      ? `npm reported success but installed ${verifiedVersion}, not ${input.targetCliVersion}. Restored the previous version ${previousVersion}. Retry with \`planr upgrade apply\` once the registry serves ${input.targetCliVersion}.`
      : `npm reported success but installed ${verifiedVersion}, not ${input.targetCliVersion}, and the automatic restore did not complete (now ${restoredVersion}). Reinstall manually: \`npm install -g openplanr@${previousVersion}\`.`;
    return {
      ok: false,
      cliUpgraded: false,
      installedVersion: restoredVersion,
      restoredTo: previousVersion,
      changelogBullets: [],
      pluginHalfCommands: [],
      migrations: [],
      failure: { step: 'verify', message },
    };
  }

  // The CLI half landed and verified — `cliUpgraded` is now true and stays true
  // regardless of what follows, so the npm step's own success is reported
  // accurately. FR7: run the migrations this upgrade crosses. Each owns its
  // restorable backup, so a failure is recoverable; the registry reports each
  // result rather than swallowing it.
  const migrations = input.migrationRunner
    ? await input.migrationRunner(previousVersion, verifiedVersion, {
        projectDir: input.projectDir,
      })
    : [];
  const failedMigration = migrations.find((migration) => migration.failure !== undefined);
  if (failedMigration) {
    // The decisive FR7/FR9 case: the CLI upgraded, but a post-upgrade migration
    // failed. `ok` is false and the migration is named, so a half-migrated
    // install can never report success — while `cliUpgraded` stays true, because
    // the migration's failure must not hide the npm step's real success.
    return {
      ok: false,
      cliUpgraded: true,
      installedVersion: verifiedVersion,
      changelogBullets: [],
      pluginHalfCommands: [],
      migrations,
      failure: {
        step: 'migration',
        message: `The CLI upgraded to ${verifiedVersion}, but the post-upgrade migration \`${failedMigration.id}\` failed: ${failedMigration.failure}. Each migration takes its own restorable backup before mutating; re-run \`planr upgrade apply\` to retry it.`,
      },
    };
  }

  // Success: the CLI half landed and every crossed migration completed. Now the
  // honest reporting half. Reading/summarising the changelog is a report step,
  // never a mutation, so it does not flip `ok`: an empty summary is reported as
  // "no entries", not as a failed upgrade (which would misreport a machine that
  // is, in fact, upgraded).
  const changelogBullets = summarizeChangelogBetween(previousVersion, verifiedVersion);
  const pipelineVersion = resolvePipelinePackage(false)?.version ?? verifiedVersion;
  const inspection = inspectClaudePluginIntegration(pipelineVersion, input.claudeCommandRunner);
  const pluginHalfCommands = prescribePluginHalfCommands(inspection.operations);

  return {
    ok: true,
    cliUpgraded: true,
    installedVersion: verifiedVersion,
    changelogBullets,
    pluginHalfCommands,
    migrations,
  };
}
