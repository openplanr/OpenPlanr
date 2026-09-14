import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OpenPlanrConfig } from '../models/types.js';
import { display, logger } from '../utils/logger.js';
import { saveConfig } from './config-service.js';
import { isNonInteractive } from './interactive-state.js';
import { promptSelect } from './prompt-service.js';
import { runtimeRoot } from './runtime-manager-service.js';
import {
  type ExecuteCliHalfUpgradeInput,
  type ExecuteCliHalfUpgradeResult,
  executeCliHalfUpgrade,
  planCliUpgrade,
  type ReconcileOptions,
  reconcileInstalledTuple,
  type UpgradeReconciliation,
} from './upgrade-service.js';

/**
 * FR5/FR6 — offer an available upgrade at a natural moment (wherever the user
 * already is) rather than making them run a diagnostic to discover they are
 * stale. This service owns three surfaces:
 *
 *  - the four-way choice (upgrade now · always keep me current · not now ·
 *    never ask), presented only when the reconciled tuple is `upgrade-available`;
 *  - the machine-local snooze/never-ask state at
 *    `runtimeRoot()/upgrade-state.json`, read fail-open so a corrupt file can
 *    never crash the `preAction` hook it wires into;
 *  - the escalating "not now" backoff (24h → 48h → one week) that keeps the
 *    offer from ever nagging.
 *
 * The hard constraint T-002 established is preserved and outranks the feature:
 * a durable snooze/never-ask short-circuits before any reconcile call, so an
 * ordinary command that already declined pays no network cost and no delay.
 */

/** The four choices FR5 names. */
export type UpgradeOfferChoice = 'upgrade-now' | 'always' | 'not-now' | 'never';

/**
 * Machine-local, per-user preference — never the team-shared `config.json`.
 * `snoozeStage` keys the escalating-backoff table; `snoozeUntil` is an ISO
 * instant before which the offer stays silent.
 */
export interface UpgradeSnoozeState {
  neverAsk: boolean;
  snoozeUntil: string | null;
  snoozeStage: 0 | 1 | 2;
}

const DEFAULT_SNOOZE_STATE: UpgradeSnoozeState = {
  neverAsk: false,
  snoozeUntil: null,
  snoozeStage: 0,
};

/**
 * FR5 escalating backoff, keyed by the stage the user is snoozing *at*. The
 * first "not now" (stage 0) waits a day; the next (stage 1) two days; every one
 * after that (stage 2) a full week — so a prompt that was dismissed never
 * reappears frequently enough to train a reflexive dismissal.
 */
const BACKOFF_MS: Record<0 | 1 | 2, number> = {
  0: 24 * 60 * 60 * 1000,
  1: 48 * 60 * 60 * 1000,
  2: 7 * 24 * 60 * 60 * 1000,
};

/**
 * FR6's "exact re-enable command" — stated verbatim both when the user chooses
 * "never ask again" in the offer and when they set it via
 * `planr config set-upgrade-policy --never-ask`, so a permanent opt-out is never
 * a trap the user cannot find how to undo.
 */
export const UPGRADE_REENABLE_COMMAND = 'planr config set-upgrade-policy --ask-again';

/** Where the machine-local snooze/never-ask state lives (reuses T-002's root). */
export function upgradeStatePath(): string {
  return path.join(runtimeRoot(), 'upgrade-state.json');
}

/**
 * Read the snooze state, failing open on *any* problem. A missing file is the
 * common first-run case; a corrupt file is the crash-mid-write case the task's
 * atomicity note calls out — both resolve to "no snooze recorded" so a bad local
 * preference file can never throw out of every subsequent `preAction` hook.
 */
export function readSnoozeState(): UpgradeSnoozeState {
  const statePath = upgradeStatePath();
  if (!existsSync(statePath)) return { ...DEFAULT_SNOOZE_STATE };
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as Partial<UpgradeSnoozeState>;
    const stage = parsed.snoozeStage;
    return {
      neverAsk: parsed.neverAsk === true,
      snoozeUntil: typeof parsed.snoozeUntil === 'string' ? parsed.snoozeUntil : null,
      snoozeStage: stage === 1 || stage === 2 ? stage : 0,
    };
  } catch {
    return { ...DEFAULT_SNOOZE_STATE };
  }
}

/** Persist the snooze state. Proportionate to a non-critical local file: a plain write. */
export async function writeSnoozeState(state: UpgradeSnoozeState): Promise<void> {
  const statePath = upgradeStatePath();
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * A test seam of the same shape as T-002's `OPENPLANR_ECOSYSTEM_SOURCE` and
 * T-003's `OPENPLANR_NPM_BIN`: unset in production, it lets a hermetic
 * subprocess integration test drive the offer path — which has no TTY — with a
 * pre-selected choice instead of a live prompt.
 */
export function injectedOfferChoice(): UpgradeOfferChoice | null {
  const raw = process.env.OPENPLANR_UPGRADE_OFFER_CHOICE?.trim();
  if (raw === 'upgrade-now' || raw === 'always' || raw === 'not-now' || raw === 'never') return raw;
  return null;
}

/**
 * Whether the offer can be surfaced from `preAction`. In production this reduces
 * exactly to `!isNonInteractive()` — the offer is shown only where a human can
 * answer it. The injected-choice seam additionally makes the path reachable from
 * a TTY-less test subprocess.
 */
export function upgradeOfferReachable(): boolean {
  return !isNonInteractive() || injectedOfferChoice() !== null;
}

/** Optional injected clock (ms since epoch), for a deterministic subprocess test. */
function injectedNow(): number | undefined {
  const raw = process.env.OPENPLANR_UPGRADE_NOW?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

const OFFER_CHOICES: Array<{ name: string; value: UpgradeOfferChoice }> = [
  { name: '[u] Upgrade now', value: 'upgrade-now' },
  { name: '[a] Always keep me current (upgrade automatically from now on)', value: 'always' },
  { name: '[n] Not now (ask again later)', value: 'not-now' },
  { name: '[x] Never ask again', value: 'never' },
];

/**
 * The default prompter: the injected-choice seam wins (test subprocess),
 * otherwise the existing `promptSelect` helper renders the four-way menu with
 * "not now" as the safe default.
 */
async function defaultChooseAction(targetVersion: string): Promise<UpgradeOfferChoice> {
  const injected = injectedOfferChoice();
  if (injected !== null) return injected;
  return promptSelect<UpgradeOfferChoice>(
    `OpenPlanr ${targetVersion} is available — how would you like to proceed?`,
    OFFER_CHOICES,
    'not-now',
  );
}

/** Human phrase for the backoff about to be applied at a given stage. */
function describeBackoff(stage: 0 | 1 | 2): string {
  return stage === 0 ? 'in 24 hours' : stage === 1 ? 'in 48 hours' : 'in a week';
}

export type MaybeOfferUpgradeReason =
  | 'never-ask'
  | 'snoozed'
  | 'update-check-disabled'
  | 'not-upgrade-available'
  | 'auto-upgraded'
  | 'offered'
  | 'error';

export interface MaybeOfferUpgradeResult {
  surfaced: boolean;
  choice: UpgradeOfferChoice | null;
  reason: MaybeOfferUpgradeReason;
}

/**
 * Injectable dependencies. Production passes none — the real reconcile,
 * executor, prompt, and wall clock are used. Unit tests inject deterministic
 * stubs so the offer's decisions can be asserted without a network, an npm, or
 * a TTY.
 */
export interface MaybeOfferUpgradeDeps {
  now?: number;
  reconcile?: (projectDir: string, options?: ReconcileOptions) => Promise<UpgradeReconciliation>;
  executeUpgrade?: (input: ExecuteCliHalfUpgradeInput) => Promise<ExecuteCliHalfUpgradeResult>;
  chooseAction?: (targetVersion: string) => Promise<UpgradeOfferChoice>;
}

/**
 * The entry point wired into `src/cli/index.ts`'s `preAction` hook. Fail-open at
 * the top level: nothing about an upgrade offer may ever break the command the
 * user actually ran, so every path below is wrapped and a thrown error degrades
 * to "did not surface" rather than propagating out of the hook.
 */
export async function maybeOfferUpgrade(
  projectDir: string,
  config: OpenPlanrConfig | null | undefined,
  deps: MaybeOfferUpgradeDeps = {},
): Promise<MaybeOfferUpgradeResult> {
  try {
    return await runOffer(projectDir, config ?? null, deps);
  } catch {
    return { surfaced: false, choice: null, reason: 'error' };
  }
}

async function runOffer(
  projectDir: string,
  config: OpenPlanrConfig | null,
  deps: MaybeOfferUpgradeDeps,
): Promise<MaybeOfferUpgradeResult> {
  const now = deps.now ?? injectedNow() ?? Date.now();
  const reconcile = deps.reconcile ?? reconcileInstalledTuple;
  const runUpgrade = deps.executeUpgrade ?? executeCliHalfUpgrade;
  const chooseAction = deps.chooseAction ?? defaultChooseAction;

  const state = readSnoozeState();

  // (1) Permanent opt-out — honoured before anything else. Zero reconcile.
  if (state.neverAsk) return { surfaced: false, choice: null, reason: 'never-ask' };

  // (2) Active snooze — the whole point of the backoff. This is the no-delay
  //     guarantee: a still-snoozed command touches no network and no reconcile.
  if (state.snoozeUntil && now < Date.parse(state.snoozeUntil)) {
    return { surfaced: false, choice: null, reason: 'snoozed' };
  }

  // (3) Team opt-out of the check itself — `update_check: false` skips reconcile
  //     entirely: no network, no prompt.
  if (config?.upgrade?.updateCheck === false) {
    return { surfaced: false, choice: null, reason: 'update-check-disabled' };
  }

  // Only now do we consult reconcile — bounded, cache-first, and offline-safe by
  // T-002's construction. `unknown`/`aligned`/`incompatible` never offer here.
  const reconciliation = await reconcile(projectDir, { now });
  if (reconciliation.status !== 'upgrade-available') {
    return { surfaced: false, choice: null, reason: 'not-upgrade-available' };
  }

  const plan = planCliUpgrade(reconciliation);
  const targetVersion =
    plan.targetCliVersion ?? reconciliation.published?.cli.version ?? 'a newer version';

  // (4) `auto_upgrade: true` — the team asked us to skip the prompt entirely.
  if (config?.upgrade?.autoUpgrade === true) {
    await performUpgrade(projectDir, plan, runUpgrade);
    await writeSnoozeState({ ...DEFAULT_SNOOZE_STATE });
    return { surfaced: false, choice: null, reason: 'auto-upgraded' };
  }

  // (5) The four-way offer.
  logger.info(
    `An OpenPlanr upgrade is available (${reconciliation.installed.cli} → ${targetVersion}).`,
  );
  const choice = await chooseAction(targetVersion);
  await applyChoice({ choice, projectDir, config, plan, now, state, runUpgrade });
  return { surfaced: true, choice, reason: 'offered' };
}

interface ApplyChoiceInput {
  choice: UpgradeOfferChoice;
  projectDir: string;
  config: OpenPlanrConfig | null;
  plan: ReturnType<typeof planCliUpgrade>;
  now: number;
  state: UpgradeSnoozeState;
  runUpgrade: (input: ExecuteCliHalfUpgradeInput) => Promise<ExecuteCliHalfUpgradeResult>;
}

async function applyChoice(input: ApplyChoiceInput): Promise<void> {
  const { choice, projectDir, config, plan, now, state, runUpgrade } = input;
  switch (choice) {
    case 'upgrade-now':
      await performUpgrade(projectDir, plan, runUpgrade);
      // A satisfied upgrade clears any prior snooze so future drift starts fresh.
      await writeSnoozeState({ ...DEFAULT_SNOOZE_STATE });
      return;
    case 'always':
      await enableAutoUpgrade(projectDir, config);
      await performUpgrade(projectDir, plan, runUpgrade);
      await writeSnoozeState({ ...DEFAULT_SNOOZE_STATE });
      return;
    case 'not-now':
      await recordSnooze(state, now);
      return;
    case 'never':
      await recordNeverAsk(state);
      return;
  }
}

/** FR5 escalating snooze: wait `BACKOFF_MS[stage]`, then advance the stage (capped at 2). */
async function recordSnooze(state: UpgradeSnoozeState, now: number): Promise<void> {
  const stage = state.snoozeStage;
  const snoozeUntil = new Date(now + BACKOFF_MS[stage]).toISOString();
  const nextStage: 0 | 1 | 2 = stage < 2 ? ((stage + 1) as 1 | 2) : 2;
  await writeSnoozeState({ neverAsk: false, snoozeUntil, snoozeStage: nextStage });
  logger.info(`Snoozed — I'll check for an upgrade again ${describeBackoff(stage)}.`);
}

/** FR6 permanent, reversible opt-out. States the exact re-enable command. */
async function recordNeverAsk(state: UpgradeSnoozeState): Promise<void> {
  await writeSnoozeState({ ...state, neverAsk: true, snoozeUntil: null });
  logger.info('You will not be asked about upgrades again on this machine.');
  logger.info(`To re-enable the reminder, run: ${UPGRADE_REENABLE_COMMAND}`);
}

/** Persist the team-shared `auto_upgrade` preference into `config.json`. */
async function enableAutoUpgrade(
  projectDir: string,
  config: OpenPlanrConfig | null,
): Promise<void> {
  if (!config) {
    logger.warn(
      'No project config found, so auto-upgrade could not be saved for the team — upgrading now.',
    );
    return;
  }
  const updated: OpenPlanrConfig = {
    ...config,
    upgrade: { ...config.upgrade, autoUpgrade: true },
  };
  await saveConfig(projectDir, updated);
  logger.success('Auto-upgrade enabled — future upgrades will run without asking.');
}

/**
 * Delegate the CLI-owned half to T-003's executor and render its result. This
 * re-uses `executeCliHalfUpgrade` verbatim: the offer never re-implements the
 * npm install, the verify-after-write, or the plugin-half prescription.
 */
async function performUpgrade(
  projectDir: string,
  plan: ReturnType<typeof planCliUpgrade>,
  runUpgrade: (input: ExecuteCliHalfUpgradeInput) => Promise<ExecuteCliHalfUpgradeResult>,
): Promise<void> {
  if (!plan.proceed || !plan.targetCliVersion) {
    logger.warn(plan.reason);
    return;
  }
  logger.info(`Upgrading the OpenPlanr CLI to ${plan.targetCliVersion}…`);
  const result = await runUpgrade({ projectDir, targetCliVersion: plan.targetCliVersion });
  renderUpgradeResult(result);
}

/** Mirror `planr upgrade apply`'s rendering so the inline offer reads identically. */
function renderUpgradeResult(result: ExecuteCliHalfUpgradeResult): void {
  if (result.ok) {
    logger.success(`CLI upgraded to ${result.installedVersion}.`);
    if (result.changelogBullets.length > 0) {
      display.blank();
      display.heading("What's new");
      for (const bullet of result.changelogBullets) display.bullet(bullet);
    }
    if (result.pluginHalfCommands.length > 0) {
      display.blank();
      display.heading('Plugin half — the CLI cannot install host plugins');
      logger.info('Run these yourself, in order (the first refreshes the marketplace):');
      result.pluginHalfCommands.forEach((command, index) => {
        display.numbered(index + 1, command);
      });
    }
  } else {
    logger.error(result.failure?.message ?? 'The upgrade did not complete.');
    if (result.restoredTo) logger.info(`Restored the previous version ${result.restoredTo}.`);
  }
}
