/**
 * `openplanr upgrade`: reconciles the installed CLI, bundled pipeline and host plugin with the
 * published compatible set (npm `latest`, cached, short fetch timeout), upgrades the CLI half
 * with verify-after-install and restore, runs crossed migrations and reports the command that
 * updates each installed coding agent. Entry points: `reconcileInstalledTuple`, `planCliUpgrade`,
 * `executeCliHalfUpgrade`. It never changes the host plugin itself.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { CLI_COMMAND } from '../utils/constants.js';
import { parseExternalJson } from '../utils/external-json.js';
import { logger } from '../utils/logger.js';
import {
  type ClaudeCommandRunner,
  inspectBundledClaudePluginIntegration,
  OPENPLANR_CLAUDE_PLUGIN,
} from './claude-plugin-service.js';
import { resolvePipelinePackage } from './pipeline-package-service.js';
import { readOpenPlanrVersion } from './provenance-service.js';
import { RUNTIME_LABELS, summarizeRuntimeChanges } from './runtime-change-summary.js';
import {
  bundledHostRoot,
  classifyComponentDrift,
  installedRuntimeScopes,
  previewSetup,
  type RuntimeId,
  RuntimeManagerError,
  runtimeRoot,
  type SetupPreview,
  type SkillInstallMode,
} from './runtime-manager-service.js';

/**
 * The command that registers the bundled `openplanr-local` marketplace and installs
 * `planr@openplanr-local` from it. Prescribed instead of `openplanr runtime update` when
 * Claude Code has no such marketplace yet, because only setup records the installation.
 */
export const CLAUDE_PLUGIN_SETUP_COMMAND = `${CLI_COMMAND} setup --runtime claude --scope user`;

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
  /**
   * `registry` when derived from the npm registry document for the CLI (the
   * pipeline is its exact bundled pin and the host plugin ships with it);
   * `manifest` for the legacy `components` tuple manifest with explicit ranges.
   */
  shape?: 'registry' | 'manifest';
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
  /** `agents-behind`: the CLI is current and a coding agent's OpenPlanr install needs updating. */
  status: 'aligned' | 'upgrade-available' | 'agents-behind' | 'incompatible' | 'unknown';
  installed: { cli: string; skills: string | null; pipeline: string | null };
  published: EcosystemComponents | null;
  ecosystemSource: EcosystemSource;
  /** The pipeline package this CLI bundles; `installed.pipeline` stays null since it ships inside the CLI. */
  bundledPipeline?: string | null;
  /** Retired host plugins (`openplanr@…`, `planr-pipeline@…`); informational, doctor warns about them. */
  legacyPlugins?: string[];
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
 * The published compatible set is the npm registry's `latest` document for the
 * CLI: its version is what a global install lands, and its exact `planr-pipeline`
 * pin is the pipeline it bundles. The unified host plugin ships with the CLI, so
 * no separate manifest describes it. `OPENPLANR_ECOSYSTEM_SOURCE` overrides the
 * location with an `http(s)` URL (a local stub server) or a filesystem path (a
 * fixture); either the registry document or the legacy `components` manifest is
 * accepted there.
 */
export const DEFAULT_ECOSYSTEM_SOURCE = 'https://registry.npmjs.org/openplanr/latest';

/**
 * Within the TTL the cached manifest is trusted without a network round-trip.
 * This is what keeps an otherwise-offline-capable CLI from acquiring a network
 * dependency on every check.
 */
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * A short hard ceiling on the fetch. A captive portal, a VPN, or an airplane
 * must never make `openplanr` hang: past this, the fetch is abandoned and the CLI
 * falls back to cache (or reports the manifest unavailable).
 */
const DEFAULT_FETCH_TIMEOUT_MS = 2_000;

function ecosystemSourceLocation(): string {
  return process.env.OPENPLANR_ECOSYSTEM_SOURCE?.trim() || DEFAULT_ECOSYSTEM_SOURCE;
}

function ecosystemCachePath(): string {
  return path.join(runtimeRoot(), 'ecosystem-cache.json');
}

const publishedComponentSchema = z.object({
  version: z.string().optional(),
  cliRange: z.string().optional(),
  pipelineRange: z.string().optional(),
});

const publishedDocumentSchema = z.object({
  components: z
    .object({
      cli: publishedComponentSchema.optional(),
      pipeline: publishedComponentSchema.optional(),
      skills: publishedComponentSchema.optional(),
      marketplace: publishedComponentSchema.optional(),
    })
    .optional(),
  name: z.string().optional(),
  version: z.string().optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
});

type RawPublishedDocument = z.infer<typeof publishedDocumentSchema>;

/** Narrow the raw published JSON to the compatibility components we reconcile. */
function parseComponents(text: string, location: string): EcosystemComponents | null {
  try {
    const data = parseExternalJson(text, publishedDocumentSchema, location);
    return parseTupleManifest(data) ?? parseRegistryDocument(data);
  } catch (error) {
    logger.debug('Ignoring the published compatibility manifest', error);
    return null;
  }
}

/** The legacy tuple manifest: three versioned components with explicit mutual ranges. */
function parseTupleManifest(data: RawPublishedDocument): EcosystemComponents | null {
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
    shape: 'manifest',
  };
}

/**
 * The npm registry document for the CLI. The pipeline component is the exact
 * `planr-pipeline` pin the published CLI bundles; the skills component is the
 * host plugin generated from that same CLI version.
 */
function parseRegistryDocument(data: RawPublishedDocument): EcosystemComponents | null {
  if (data.name !== 'openplanr' || typeof data.version !== 'string') return null;
  const pin =
    data.optionalDependencies?.['planr-pipeline'] ?? data.dependencies?.['planr-pipeline'];
  if (typeof pin !== 'string' || !stableVersionParts(pin)) return null;
  return {
    cli: { version: data.version },
    pipeline: { version: pin },
    skills: { version: data.version },
    shape: 'registry',
  };
}

function pickRange(component: { cliRange?: string; pipelineRange?: string }): {
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
    } catch (error) {
      logger.debug(`Could not read the compatibility manifest at ${location}`, error);
      return null;
    }
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      logger.debug(
        `The compatibility manifest request to ${location} timed out after ${timeoutMs}ms`,
      );
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  const attempt = (async (): Promise<string | null> => {
    try {
      const response = await fetchImpl(location, { signal: controller.signal });
      if (!response.ok) {
        logger.debug(
          `The compatibility manifest request to ${location} returned HTTP ${response.status}`,
        );
        return null;
      }
      return await response.text();
    } catch (error) {
      if (!controller.signal.aborted) {
        logger.debug(`The compatibility manifest request to ${location} failed`, error);
      }
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
  const location = ecosystemSourceLocation();
  const text = await fetchManifestText(location, fetchImpl, timeoutMs);
  const fetched = text ? parseComponents(text, location) : null;
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
 * A major/minor compatibility window expressed as range satisfaction so no
 * `semver` dependency is added: a caret range `^X.Y.Z` is satisfied by the
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
 * Only a version strictly *behind* another has an upgrade available. Drift used to be
 * plain inequality, which made "different" and "older" the same thing: an installed
 * build ahead of the registry — a linked dev build, a prerelease, a canary, or a
 * maintainer mid-release — classified as `upgrade-available`, and the offer rendered a
 * **downgrade** as an upgrade. Accepting "always keep me current" would then roll the
 * newer build back on every invocation.
 *
 * Direction is deliberately the only thing added here. `violatesRange` stays untouched:
 * a range violation is direction-independent and remains an incompatibility either way.
 * An unparseable version is never "behind" — a prerelease must not be silently rolled
 * back to a stable release just because its shape is unrecognised.
 */
function isBehind(installed: string | null, published: string | undefined): boolean {
  if (!installed || !published) return false;
  const actual = stableVersionParts(installed);
  const target = stableVersionParts(published);
  if (!actual || !target) return false;
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] < target[index]) return true;
    if (actual[index] > target[index]) return false;
  }
  return false;
}

/**
 * The host plugin `openplanr setup` manages, judged against the marketplace bundled with this
 * CLI. Doctor and setup read the same inspection, so the three surfaces never disagree
 * about which plugin is the OpenPlanr one.
 */
function inspectBundledHostPlugin(runner?: ClaudeCommandRunner) {
  return inspectBundledClaudePluginIntegration(bundledHostRoot('claude'), runner);
}

/**
 * Read the published compatibility manifest, compare it against the real
 * installed tuple (this CLI's version plus the host plugin), and report whether
 * the tuple is aligned, has an upgrade available, has a coding agent behind the
 * CLI, or is genuinely incompatible.
 * The warn-vs-fail call is delegated to `classifyComponentDrift` so it is
 * doctor's exact distinction, not a re-derivation.
 */
export async function reconcileInstalledTuple(
  _projectDir: string,
  options: ReconcileOptions = {},
): Promise<UpgradeReconciliation> {
  const cliVersion = readOpenPlanrVersion();
  const bundledPipeline = resolvePipelinePackage(false)?.version ?? null;
  const inspection = inspectBundledHostPlugin(options.claudeCommandRunner);
  const hostPlugin = inspection.plugins.find((plugin) => plugin.name === OPENPLANR_CLAUDE_PLUGIN);
  const installed = {
    cli: cliVersion,
    skills: hostPlugin?.installedVersion ?? null,
    pipeline: null,
  };
  const legacyPlugins = inspection.legacyPluginIds;

  const { components: published, source: ecosystemSource } = await loadEcosystem(options);
  if (!published) {
    return {
      status: 'unknown',
      installed,
      published: null,
      ecosystemSource,
      bundledPipeline,
      legacyPlugins,
    };
  }

  // "Behind", not "different". `classifyComponentDrift` documents `cliDrift` as "a CLI
  // that merely trails an upgrade", so a direction check is what that input was always
  // meant to carry — an installed component ahead of the registry has nothing to upgrade.
  const cliDrift = isBehind(installed.cli, published.cli.version);
  let agentsBehind: boolean;
  let pipelineBehind: boolean;
  let componentDrift: boolean;
  let incompatibleDrift: boolean;
  if (published.shape === 'registry') {
    // The host plugin is judged against the version the bundled marketplace carries, and
    // the pipeline against the pin the published CLI bundles. A registry-described set
    // declares no mutual ranges, so it cannot be incompatible; leftover legacy plugins are
    // reported for doctor's warning, not judged here.
    agentsBehind = inspection.plugins.some(
      (plugin) =>
        plugin.installed && isBehind(plugin.installedVersion ?? null, plugin.expectedVersion),
    );
    pipelineBehind = isBehind(installed.pipeline ?? bundledPipeline, published.pipeline.version);
    componentDrift = cliDrift || agentsBehind || pipelineBehind;
    incompatibleDrift = false;
  } else {
    agentsBehind = isBehind(installed.skills, published.skills.version);
    pipelineBehind = isBehind(installed.pipeline, published.pipeline.version);
    componentDrift = cliDrift || agentsBehind || pipelineBehind;
    // A real mutual-compatibility violation: an installed component sits outside
    // the range its published sibling declares. Absent (uninstalled) plugins are
    // not violations — that is a different condition from incompatibility.
    incompatibleDrift =
      violatesRange(installed.pipeline, published.cli.pipelineRange) ||
      violatesRange(installed.cli, published.skills.cliRange) ||
      violatesRange(installed.cli, published.pipeline.cliRange);
  }

  const classification = classifyComponentDrift({ cliDrift, componentDrift, incompatibleDrift });
  // A current CLI with an agent install behind it is an update to run, not an incompatibility.
  const status =
    classification.status === 'pass'
      ? 'aligned'
      : classification.status === 'warn'
        ? 'upgrade-available'
        : !classification.genuineDrift && agentsBehind && !pipelineBehind
          ? 'agents-behind'
          : 'incompatible';

  return { status, installed, published, ecosystemSource, bundledPipeline, legacyPlugins };
}

// ===========================================================================
// Execute the CLI-half upgrade safely, prescribe the plugin half.
// Additive to the reconcile region above: this consumes
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
 * `OPENPLANR_NPM_BIN` is a test seam of the same shape as
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
 * The ownership split, decided once so the CLI command stays thin: the npm half
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
      reason: 'The latest OpenPlanr version could not be checked; the npm registry is unreachable.',
    };
  }
  const target = published.cli.version;
  if (status === 'aligned') {
    return {
      proceed: false,
      targetCliVersion: null,
      reason:
        reconciliation.ecosystemSource === 'stale-cache'
          ? `OpenPlanr ${installed.cli} matches the stale cached compatible set; the latest release could not be checked.`
          : reconciliation.ecosystemSource === 'cache'
            ? `OpenPlanr ${installed.cli} matches the recently cached compatible set; the registry was not contacted this time.`
            : `OpenPlanr ${installed.cli} is up to date.`,
    };
  }
  if (status === 'upgrade-available') {
    return {
      proceed: true,
      targetCliVersion: target,
      reason: `OpenPlanr ${target} is available; ${installed.cli} is installed.`,
    };
  }
  if (status === 'agents-behind') {
    return {
      proceed: false,
      targetCliVersion: null,
      reason: `OpenPlanr ${installed.cli} is up to date. Update your coding agents with the commands below.`,
    };
  }
  if (status === 'incompatible' && compareStableVersions(installed.cli, target) < 0) {
    return {
      proceed: true,
      targetCliVersion: target,
      reason: `OpenPlanr ${target} is available, and the installed ${installed.cli} no longer matches its plugins.`,
    };
  }
  if (status === 'incompatible') {
    return {
      proceed: false,
      targetCliVersion: null,
      reason: `OpenPlanr ${installed.cli} is current, but a coding agent's plugin is behind it. Run the commands below.`,
    };
  }
  return {
    proceed: false,
    targetCliVersion: null,
    reason: 'The installed OpenPlanr version could not be judged.',
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
 * "What's new, honestly." Return the changelog bullets between two
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

/** One released version's changelog entries. */
export interface ReleaseNoteSection {
  version: string;
  entries: string[];
}

const CHANGESET_COMMIT_PREFIX = /^(?:\[`?[0-9a-f]{7,40}`?\]\([^)]*\):?|[0-9a-f]{7,40}:)\s+/;

/** `parseReleaseNotes` over the changelog this CLI ships, or nothing when it ships none. */
export function summarizeReleaseNotes(
  oldVersion: string,
  newVersion: string,
): ReleaseNoteSection[] {
  const changelogPath = locateChangelog();
  if (!changelogPath) return [];
  return parseReleaseNotes(readFileSync(changelogPath, 'utf8'), oldVersion, newVersion);
}

/**
 * The changelog entries released after `oldVersion` up to `newVersion`, newest first, without
 * commit hashes or dependency bumps. Without an `oldVersion` header only the target's own
 * section is returned.
 */
export function parseReleaseNotes(
  changelog: string,
  oldVersion: string,
  newVersion: string,
): ReleaseNoteSection[] {
  const lines = changelog.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => changelogHeaderMatches(line, newVersion));
  if (startIndex === -1) return [];
  const hasOldSection = lines.some((line) => changelogHeaderMatches(line, oldVersion));

  const sections: ReleaseNoteSection[] = [];
  let entry: string[] | undefined;
  let skipEntry = false;
  const closeEntry = () => {
    if (entry && !skipEntry) sections[sections.length - 1]?.entries.push(entry.join(' '));
    entry = undefined;
    skipEntry = false;
  };
  for (const line of lines.slice(startIndex)) {
    const header = /^##\s+\[?([^\]\s]+)\]?$/.exec(line.trim());
    if (header) {
      closeEntry();
      if (header[1] === oldVersion || (!hasOldSection && sections.length > 0)) break;
      sections.push({ version: header[1], entries: [] });
      continue;
    }
    const item = /^-\s+(.*\S)\s*$/.exec(line);
    if (item) {
      closeEntry();
      const text = item[1].replace(CHANGESET_COMMIT_PREFIX, '');
      skipEntry = /^Updated dependencies\b/.test(text);
      entry = [text];
    } else if (entry && /^\s+\S/.test(line)) {
      entry.push(line.trim().replace(/^-\s+/, ''));
    }
  }
  closeEntry();
  return sections.filter((section) => section.entries.length > 0);
}

/**
 * A command that brings one installed coding agent up to what this CLI bundles.
 * Without `runtime` it concerns OpenPlanr's own runtime state rather than one agent.
 */
export interface UpgradeNextStep {
  runtime?: RuntimeId;
  host: string;
  command: string;
  detail: string;
}

const RUNTIME_COMMAND_NAMES: Record<RuntimeId, string> = {
  'claude-code': 'claude',
  codex: 'codex',
  cursor: 'cursor',
};

function nextStepCommand(
  runtime: RuntimeId,
  scope: 'user' | 'project',
  skillMode: SkillInstallMode | undefined,
  operations: SetupPreview['runtimeOperations'],
): string {
  const claudeKinds = operations
    .filter((operation) => operation.runtime === 'claude-code')
    .map((operation) => operation.kind);
  // Only setup registers the local marketplace and may remove a retired plugin.
  if (claudeKinds.includes('add-marketplace') || claudeKinds.includes('remove')) {
    return `${CLAUDE_PLUGIN_SETUP_COMMAND}${claudeKinds.includes('remove') ? ' --replace-managed' : ''} --yes`;
  }
  // `runtime update` has no skill-mode flag and would move a unified-plugin install to direct skills.
  if (runtime === 'codex' && skillMode === 'unified-plugin') {
    return `${CLI_COMMAND} setup --runtime codex --scope ${scope} --skill-mode unified-plugin --yes`;
  }
  return `${CLI_COMMAND} runtime update ${RUNTIME_COMMAND_NAMES[runtime]} --scope ${scope} --yes`;
}

/** An `aligned` CLI whose coding agents still have steps to run reads as `agents-behind`. */
export function withAgentNextSteps(
  reconciliation: UpgradeReconciliation,
  nextSteps: readonly UpgradeNextStep[],
): UpgradeReconciliation {
  return reconciliation.status === 'aligned' && nextSteps.some((step) => step.runtime)
    ? { ...reconciliation, status: 'agents-behind' }
    : reconciliation;
}

type NextStepCandidate = Awaited<ReturnType<typeof installedRuntimeScopes>>[number];

/** Recorded installs, plus a Claude plugin installed without a record of it. */
async function nextStepCandidates(
  projectDir: string,
  claudeCommandRunner: ClaudeCommandRunner | undefined,
): Promise<{ candidates: NextStepCandidate[]; stateError?: RuntimeManagerError }> {
  let candidates: NextStepCandidate[] = [];
  let stateError: RuntimeManagerError | undefined;
  try {
    candidates = await installedRuntimeScopes(projectDir);
  } catch (error) {
    if (!(error instanceof RuntimeManagerError)) throw error;
    stateError = error;
  }
  if (!candidates.some(({ runtime, scope }) => runtime === 'claude-code' && scope === 'user')) {
    const plugin = inspectBundledHostPlugin(claudeCommandRunner).plugins.find(
      (entry) => entry.name === OPENPLANR_CLAUDE_PLUGIN,
    );
    if (plugin?.installed) candidates.unshift({ runtime: 'claude-code', scope: 'user' });
  }
  return { candidates, ...(stateError ? { stateError } : {}) };
}

/** The step one install needs, or `undefined` when it already matches this CLI. */
async function planNextStep(
  { runtime, scope, skillMode }: NextStepCandidate,
  projectDir: string,
  claudeCommandRunner: ClaudeCommandRunner | undefined,
): Promise<UpgradeNextStep | undefined> {
  const preview = await previewSetup({
    projectDir,
    cliVersion: readOpenPlanrVersion(),
    runtime,
    scope,
    dryRun: true,
    ...(skillMode ? { skillMode } : {}),
    ...(claudeCommandRunner ? { claudeCommandRunner } : {}),
  });
  // `runtime update` refuses to apply a preview with a failed check, so point at doctor instead.
  const failure = preview.runtimeDiagnostics.find(
    (diagnostic) => diagnostic.runtime === runtime && diagnostic.status === 'fail',
  );
  if (failure) {
    return {
      runtime,
      host: RUNTIME_LABELS[runtime],
      command: `${CLI_COMMAND} doctor`,
      detail: failure.fix ? `${failure.message} ${failure.fix}` : failure.message,
    };
  }
  const change = summarizeRuntimeChanges(preview, {
    bookkeepingRoot: runtimeRoot(),
    applied: false,
  }).find((entry) => entry.runtime === runtime);
  if (!change?.changed) return undefined;
  return {
    runtime,
    host: change.host,
    command: nextStepCommand(runtime, scope, skillMode, preview.runtimeOperations),
    detail: change.summary,
  };
}

/**
 * One command per installed coding agent whose OpenPlanr files or plugin trail this CLI,
 * planned with the same preview `openplanr runtime update` applies.
 */
export async function upgradeNextSteps(
  projectDir: string,
  options: { claudeCommandRunner?: ClaudeCommandRunner } = {},
): Promise<UpgradeNextStep[]> {
  const steps: UpgradeNextStep[] = [];
  const doctorStep = (error: Error, runtime?: RuntimeId) => {
    if (steps.some((step) => step.detail === error.message)) return;
    const repairable =
      error instanceof RuntimeManagerError && error.code === 'E_RUNTIME_PACKAGE_CHANGED';
    steps.push({
      ...(runtime ? { runtime } : {}),
      host: runtime ? RUNTIME_LABELS[runtime] : 'OpenPlanr',
      command: `${CLI_COMMAND} doctor${repairable ? ' --fix' : ''}`,
      detail: error.message,
    });
  };
  const { candidates, stateError } = await nextStepCandidates(
    projectDir,
    options.claudeCommandRunner,
  );
  if (stateError) doctorStep(stateError);
  for (const candidate of candidates) {
    try {
      const step = await planNextStep(candidate, projectDir, options.claudeCommandRunner);
      if (step) steps.push(step);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      doctorStep(error, candidate.runtime);
    }
  }
  return steps;
}

/** One migration's outcome as the injected registry runner reports it. */
export interface MigrationRunResult {
  id: string;
  applied: boolean;
  alreadyApplied: boolean;
  failure?: string;
}

/**
 * The migration registry, injected rather than imported so this service owns
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

/** Runs the OpenPlanr CLI now installed on disk with the given arguments. */
export type InstalledCliRunner = (args: string[]) => NpmCommandResult;

// After `npm install -g` this process still executes the previous version's modules,
// so only a fresh process of the same entry point runs the upgraded code.
function defaultInstalledCliRunner(args: string[]): NpmCommandResult {
  const entry = process.argv[1];
  if (!entry) {
    return {
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('The entry point of the running CLI is unknown.'),
    };
  }
  const result = spawnSync(process.execPath, [...process.execArgv, entry, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error } : {}),
  };
}

const nextStepsReportSchema = z.object({
  nextSteps: z.array(
    z.object({
      runtime: z.enum(['claude-code', 'codex', 'cursor']).optional(),
      host: z.string(),
      command: z.string(),
      detail: z.string(),
    }),
  ),
});

const installedStatusSchema = z.union([
  nextStepsReportSchema,
  z.object({ ok: z.literal(false), problem: z.string() }),
]);

/** The next steps as the upgraded CLI reports them from `openplanr upgrade status --json`. */
export function readInstalledCliNextSteps(
  projectDir: string,
  runner: InstalledCliRunner = defaultInstalledCliRunner,
): { nextSteps: UpgradeNextStep[]; error?: string } {
  const result = runner(['--project-dir', projectDir, 'upgrade', 'status', '--json']);
  if (result.error) {
    return { nextSteps: [], error: `The upgraded CLI could not be run: ${result.error.message}.` };
  }
  const report = result.stdout.trim().split(/\r?\n/).pop() ?? '';
  try {
    const parsed = parseExternalJson(
      report,
      installedStatusSchema,
      `${CLI_COMMAND} upgrade status --json`,
    );
    if ('nextSteps' in parsed) return { nextSteps: parsed.nextSteps };
    return {
      nextSteps: [],
      error: `The upgraded CLI could not list its next steps: ${parsed.problem}`,
    };
  } catch (error) {
    const detail = result.stderr.trim() || (error instanceof Error ? error.message : String(error));
    return {
      nextSteps: [],
      error: `The upgraded CLI did not report its next steps (exit ${result.status}): ${detail}`,
    };
  }
}

export interface ExecuteCliHalfUpgradeInput {
  projectDir: string;
  targetCliVersion: string;
  /** Injectable npm runner; defaults to the real (or `OPENPLANR_NPM_BIN`) npm. */
  npmCommandRunner?: NpmCommandRunner;
  /** Injectable runner for the upgraded CLI; defaults to a new process of this entry point. */
  installedCliRunner?: InstalledCliRunner;
  /**
   * Migration runner, run after the CLI half verifies. Omitted (no runner)
   * means no migrations are attempted; the `apply` command injects the real
   * registry's `runPendingMigrations`.
   */
  migrationRunner?: MigrationRunner;
}

export interface ExecuteCliHalfUpgradeResult {
  ok: boolean;
  cliUpgraded: boolean;
  previousVersion: string;
  installedVersion: string;
  restoredTo?: string;
  changelogBullets: string[];
  releaseNotes: ReleaseNoteSection[];
  releaseNotesError?: string;
  nextSteps: UpgradeNextStep[];
  nextStepsError?: string;
  /** The commands of `nextSteps`, for readers of the older field. */
  pluginHalfCommands: string[];
  /** Per-migration results for every registered migration this upgrade crossed. */
  migrations: MigrationRunResult[];
  failure?: {
    step: 'npm-install' | 'verify' | 'changelog' | 'migration';
    message: string;
  };
}

/**
 * Execute the one half the CLI owns — a global npm install — and
 * prescribe (never execute) the plugin half.
 *
 * Atomicity is enforced by verify-after-write: the previously installed
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
      previousVersion,
      changelogBullets: [],
      releaseNotes: [],
      nextSteps: [],
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
    // The decisive case: a clean exit that did NOT land the target. Restore
    // the captured previous version and never report success.
    const restore = runNpm(['install', '-g', `openplanr@${previousVersion}`]);
    const restoredVersion = readOpenPlanrVersion();
    const restored = !restore.error && restore.status === 0 && restoredVersion === previousVersion;
    const message = restored
      ? `npm reported success but installed ${verifiedVersion}, not ${input.targetCliVersion}. Restored the previous version ${previousVersion}. Retry with \`${CLI_COMMAND} upgrade apply\` once the registry serves ${input.targetCliVersion}.`
      : `npm reported success but installed ${verifiedVersion}, not ${input.targetCliVersion}, and the automatic restore did not complete (now ${restoredVersion}). Reinstall manually: \`npm install -g openplanr@${previousVersion}\`.`;
    return {
      ok: false,
      cliUpgraded: false,
      installedVersion: restoredVersion,
      restoredTo: previousVersion,
      previousVersion,
      changelogBullets: [],
      releaseNotes: [],
      nextSteps: [],
      pluginHalfCommands: [],
      migrations: [],
      failure: { step: 'verify', message },
    };
  }

  // The CLI half landed and verified — `cliUpgraded` is now true and stays true
  // regardless of what follows, so the npm step's own success is reported
  // accurately. Then run the migrations this upgrade crosses. Each owns its
  // restorable backup, so a failure is recoverable; the registry reports each
  // result rather than swallowing it.
  const migrations = input.migrationRunner
    ? await input.migrationRunner(previousVersion, verifiedVersion, {
        projectDir: input.projectDir,
      })
    : [];
  const failedMigration = migrations.find((migration) => migration.failure !== undefined);
  if (failedMigration) {
    // The decisive migration case: the CLI upgraded, but a post-upgrade migration
    // failed. `ok` is false and the migration is named, so a half-migrated
    // install can never report success — while `cliUpgraded` stays true, because
    // the migration's failure must not hide the npm step's real success.
    return {
      ok: false,
      cliUpgraded: true,
      installedVersion: verifiedVersion,
      previousVersion,
      changelogBullets: [],
      releaseNotes: [],
      nextSteps: [],
      pluginHalfCommands: [],
      migrations,
      failure: {
        step: 'migration',
        message: `The CLI upgraded to ${verifiedVersion}, but the post-upgrade migration \`${failedMigration.id}\` failed: ${failedMigration.failure}. Each migration takes its own restorable backup before mutating; re-run \`${CLI_COMMAND} upgrade apply\` to retry it.`,
      },
    };
  }

  // Success: the CLI half landed and every crossed migration completed. Now the
  // honest reporting half. Reading/summarising the changelog is a report step,
  // never a mutation, so it does not flip `ok`: an empty summary is reported as
  // "no entries", not as a failed upgrade (which would misreport a machine that
  // is, in fact, upgraded).
  const changelogBullets = summarizeChangelogBetween(previousVersion, verifiedVersion);
  let releaseNotes: ReleaseNoteSection[] = [];
  let releaseNotesError: string | undefined;
  try {
    releaseNotes = summarizeReleaseNotes(previousVersion, verifiedVersion);
  } catch (error) {
    releaseNotesError = `The release notes could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }
  const next = readInstalledCliNextSteps(input.projectDir, input.installedCliRunner);

  return {
    ok: true,
    cliUpgraded: true,
    previousVersion,
    installedVersion: verifiedVersion,
    changelogBullets,
    releaseNotes,
    ...(releaseNotesError ? { releaseNotesError } : {}),
    nextSteps: next.nextSteps,
    ...(next.error ? { nextStepsError: next.error } : {}),
    pluginHalfCommands: next.nextSteps.map((step) => step.command),
    migrations,
  };
}
