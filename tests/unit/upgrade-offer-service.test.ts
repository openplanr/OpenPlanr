import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../src/services/config-service.js';
import {
  maybeOfferUpgrade,
  readSnoozeState,
  UPGRADE_REENABLE_COMMAND,
  upgradeStatePath,
} from '../../src/services/upgrade-offer-service.js';
import type {
  ExecuteCliHalfUpgradeResult,
  UpgradeReconciliation,
} from '../../src/services/upgrade-service.js';
import { logger } from '../../src/utils/logger.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openplanr-offer-'));
  // `runtimeRoot()` (and therefore `upgradeStatePath()`) is anchored on
  // OPENPLANR_HOME, the same isolation seam T-002's tests use.
  process.env.OPENPLANR_HOME = join(root, 'home');
  delete process.env.OPENPLANR_UPGRADE_OFFER_CHOICE;
  delete process.env.OPENPLANR_UPGRADE_NOW;
});

afterEach(() => {
  delete process.env.OPENPLANR_HOME;
  delete process.env.OPENPLANR_UPGRADE_OFFER_CHOICE;
  delete process.env.OPENPLANR_UPGRADE_NOW;
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** A reconciliation that reports an available CLI upgrade (1.22.0 → 1.23.0). */
const UPGRADE_AVAILABLE: UpgradeReconciliation = {
  status: 'upgrade-available',
  installed: { cli: '1.22.0', skills: null, pipeline: null },
  published: {
    cli: { version: '1.23.0' },
    pipeline: { version: '0.39.0' },
    skills: { version: '1.24.0' },
  },
  ecosystemSource: 'network',
};

const ALIGNED: UpgradeReconciliation = {
  ...UPGRADE_AVAILABLE,
  status: 'aligned',
};

const OK_UPGRADE: ExecuteCliHalfUpgradeResult = {
  ok: true,
  cliUpgraded: true,
  installedVersion: '1.23.0',
  changelogBullets: [],
  pluginHalfCommands: [],
};

const reconcileStub = async () => UPGRADE_AVAILABLE;

/** A reconcile stub that counts calls, to prove the short-circuits touch no network. */
function countingReconcile(): { fn: () => Promise<UpgradeReconciliation>; calls: () => number } {
  let calls = 0;
  return {
    fn: async () => {
      calls += 1;
      return UPGRADE_AVAILABLE;
    },
    calls: () => calls,
  };
}

function fullConfig(upgrade?: { autoUpgrade?: boolean; updateCheck?: boolean }) {
  const cfg = createDefaultConfig('offer-fixture');
  if (upgrade) cfg.upgrade = upgrade;
  return cfg;
}

describe('maybeOfferUpgrade — escalating snooze (FR5)', () => {
  it('escalates the "not now" backoff 24h → 48h → one week across three cycles (injected clock)', async () => {
    // The clock is injected via `now`, so the escalation is proven deterministically
    // without any wall-clock sleep. Each "not now" snoozes for the duration keyed
    // to the current stage, then advances the stage (capped at 2).
    const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);

    // 1st "not now" at stage 0 → 24h, stage advances to 1.
    await maybeOfferUpgrade('/p', null, {
      now: t0,
      reconcile: reconcileStub,
      chooseAction: async () => 'not-now',
    });
    let state = readSnoozeState();
    expect(state.snoozeUntil).not.toBeNull();
    expect(Date.parse(state.snoozeUntil as string) - t0).toBe(24 * HOUR);
    expect(state.snoozeStage).toBe(1);

    // While still inside the 24h window the offer never surfaces — and never
    // reconciles (the no-delay guarantee).
    const guard = countingReconcile();
    const snoozed = await maybeOfferUpgrade('/p', null, {
      now: t0 + 1 * HOUR,
      reconcile: guard.fn,
      chooseAction: async () => 'not-now',
    });
    expect(snoozed.reason).toBe('snoozed');
    expect(snoozed.surfaced).toBe(false);
    expect(guard.calls()).toBe(0);

    // 2nd "not now" just after the 24h window → 48h, stage advances to 2.
    const t1 = t0 + 24 * HOUR + 1000;
    await maybeOfferUpgrade('/p', null, {
      now: t1,
      reconcile: reconcileStub,
      chooseAction: async () => 'not-now',
    });
    state = readSnoozeState();
    expect(Date.parse(state.snoozeUntil as string) - t1).toBe(48 * HOUR);
    expect(state.snoozeStage).toBe(2);

    // 3rd "not now" after the 48h window → one week, stage stays capped at 2.
    const t2 = t1 + 48 * HOUR + 1000;
    await maybeOfferUpgrade('/p', null, {
      now: t2,
      reconcile: reconcileStub,
      chooseAction: async () => 'not-now',
    });
    state = readSnoozeState();
    expect(Date.parse(state.snoozeUntil as string) - t2).toBe(7 * DAY);
    expect(state.snoozeStage).toBe(2);
  });
});

describe('maybeOfferUpgrade — never-ask (FR6)', () => {
  it('persists never-ask and states the exact re-enable command (Trap E)', async () => {
    const messages: string[] = [];
    const spy = vi.spyOn(logger, 'info').mockImplementation((m: string) => {
      messages.push(m);
    });

    const result = await maybeOfferUpgrade('/p', null, {
      now: 1000,
      reconcile: reconcileStub,
      chooseAction: async () => 'never',
    });
    spy.mockRestore();

    expect(result.choice).toBe('never');
    expect(readSnoozeState().neverAsk).toBe(true);
    // The FR6 contract: the opt-out is reversible AND names the exact command.
    expect(messages.join('\n')).toContain(UPGRADE_REENABLE_COMMAND);

    // Persisted: a later invocation short-circuits before any reconcile is called.
    const guard = countingReconcile();
    const later = await maybeOfferUpgrade('/p', null, {
      now: 999_999_999,
      reconcile: guard.fn,
      chooseAction: async () => 'upgrade-now',
    });
    expect(later.reason).toBe('never-ask');
    expect(guard.calls()).toBe(0);
  });
});

describe('maybeOfferUpgrade — fail-open on a corrupt state file', () => {
  it('treats invalid JSON as "no snooze recorded" and still offers, never throwing', async () => {
    const statePath = upgradeStatePath();
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, '{ this is not valid json', 'utf8');

    // The read itself fails open to the default state.
    expect(readSnoozeState()).toEqual({ neverAsk: false, snoozeUntil: null, snoozeStage: 0 });

    // And the offer proceeds rather than crashing the caller.
    const result = await maybeOfferUpgrade('/p', null, {
      now: 1000,
      reconcile: reconcileStub,
      chooseAction: async () => 'not-now',
    });
    expect(result.surfaced).toBe(true);
    expect(result.choice).toBe('not-now');
  });
});

describe('maybeOfferUpgrade — config settings (FR6)', () => {
  it('never calls reconcile when update_check is false (no network, no prompt)', async () => {
    const guard = countingReconcile();
    let prompted = 0;
    const result = await maybeOfferUpgrade('/p', fullConfig({ updateCheck: false }), {
      now: 1000,
      reconcile: guard.fn,
      chooseAction: async () => {
        prompted += 1;
        return 'not-now';
      },
    });
    expect(guard.calls()).toBe(0);
    expect(prompted).toBe(0);
    expect(result.reason).toBe('update-check-disabled');
  });

  it('auto-upgrades without prompting when auto_upgrade is true', async () => {
    let upgraded = 0;
    let prompted = 0;
    const result = await maybeOfferUpgrade('/p', fullConfig({ autoUpgrade: true }), {
      now: 1000,
      reconcile: reconcileStub,
      executeUpgrade: async () => {
        upgraded += 1;
        return OK_UPGRADE;
      },
      chooseAction: async () => {
        prompted += 1;
        return 'not-now';
      },
    });
    expect(upgraded).toBe(1);
    expect(prompted).toBe(0);
    expect(result.reason).toBe('auto-upgraded');
  });
});

describe('maybeOfferUpgrade — the four choices', () => {
  it('"upgrade now" runs the executor and clears any prior snooze', async () => {
    // Seed a prior snooze, then accept the upgrade: the state must reset.
    await maybeOfferUpgrade('/p', null, {
      now: 1000,
      reconcile: reconcileStub,
      chooseAction: async () => 'not-now',
    });
    expect(readSnoozeState().snoozeStage).toBe(1);

    let upgraded = 0;
    const result = await maybeOfferUpgrade('/p', null, {
      now: 10 * DAY, // past the snooze window so the offer surfaces again
      reconcile: reconcileStub,
      executeUpgrade: async () => {
        upgraded += 1;
        return OK_UPGRADE;
      },
      chooseAction: async () => 'upgrade-now',
    });
    expect(upgraded).toBe(1);
    expect(result.choice).toBe('upgrade-now');
    expect(readSnoozeState()).toEqual({ neverAsk: false, snoozeUntil: null, snoozeStage: 0 });
  });

  it('"always" persists auto_upgrade into config.json and upgrades now', async () => {
    const projectDir = join(root, 'project');
    mkdirSync(projectDir, { recursive: true });
    const config = fullConfig();
    let upgraded = 0;

    const result = await maybeOfferUpgrade(projectDir, config, {
      now: 1000,
      reconcile: reconcileStub,
      executeUpgrade: async () => {
        upgraded += 1;
        return OK_UPGRADE;
      },
      chooseAction: async () => 'always',
    });

    expect(result.choice).toBe('always');
    expect(upgraded).toBe(1);
    const written = JSON.parse(readFileSync(join(projectDir, '.planr', 'config.json'), 'utf8'));
    expect(written.upgrade.autoUpgrade).toBe(true);
  });

  it('does not offer when the tuple is not upgrade-available', async () => {
    let prompted = 0;
    const result = await maybeOfferUpgrade('/p', null, {
      now: 1000,
      reconcile: async () => ALIGNED,
      chooseAction: async () => {
        prompted += 1;
        return 'not-now';
      },
    });
    expect(result.reason).toBe('not-upgrade-available');
    expect(result.surfaced).toBe(false);
    expect(prompted).toBe(0);
    expect(existsSync(upgradeStatePath())).toBe(false);
  });
});
