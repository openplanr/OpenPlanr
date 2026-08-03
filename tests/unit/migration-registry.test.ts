import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type Migration,
  type MigrationRunResult,
  OPERATE_PROFILE_MIGRATION_ID,
  OPERATE_PROFILE_MIGRATION_VERSION,
  REGISTERED_MIGRATIONS,
  runPendingMigrations,
} from '../../src/services/migration-registry.js';
import { inspectOperatingProfileMigration } from '../../src/services/operate/profile-migration.js';
import {
  executeCliHalfUpgrade,
  type MigrationRunner,
  type NpmCommandRunner,
} from '../../src/services/upgrade-service.js';

// The registered operate-profile migration is keyed to the CHANGELOG-verified
// version (1.22.0) that introduced `.planr/operate-profile.json` migration
// support. These are the INJECTED versions the crossing tests bracket — not
// wall-clock, not the ambient installed version.
const V = OPERATE_PROFILE_MIGRATION_VERSION;
const BELOW = '1.21.0';
const ABOVE = '1.23.0';

// The same legacy profile shape the profile-migration suite uses: compatible
// intent (id, strings, a recognized role subset, valid caps) plus fields the
// current schema rejects (an unknown provider, non-frozen budgets, an unknown
// role, an unknown key) — so the real migration has genuine work to do.
const LEGACY_PROFILE = {
  id: 'engineering',
  title: 'Engineering board',
  description: 'Delivery, reliability, and risk.',
  enabledRoles: ['technology-risk', 'chair', 'not-a-role'],
  caps: { surfacedFindings: 10, newSpecs: 3, openDecisions: 3, agentArtifacts: 2 },
  enabledProviders: ['repository', 'planr', 'git', 'linear'],
  budgets: { maxFiles: 5, maxItems: 5, maxBytes: 5, maxDurationMs: 5 },
  owner: 'a-legacy-field',
};

let root: string;
let projectDir: string;

const profilePath = () => join(projectDir, '.planr', 'operate-profile.json');
const seedLegacyProfile = () => writeFile(profilePath(), `${JSON.stringify(LEGACY_PROFILE)}\n`);
const profileResult = (results: MigrationRunResult[]) =>
  results.find((entry) => entry.id === OPERATE_PROFILE_MIGRATION_ID);

// Each test uses a fresh project dir (its own machine key), and the global test
// setup (`tests/setup/isolate-user-state.ts`) already points OPENPLANR_STATE_ROOT
// at an isolated temp dir, so the delegated migration's backups and locks never
// touch real user state.
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openplanr-migration-registry-'));
  projectDir = join(root, 'project');
  await mkdir(join(projectDir, '.planr'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('runPendingMigrations — version-boundary gating (crossing-only)', () => {
  it('runs a migration when the upgrade crosses its version', async () => {
    await seedLegacyProfile();
    const before = await readFile(profilePath(), 'utf8');

    const results = await runPendingMigrations(BELOW, V, { projectDir });

    const profile = profileResult(results);
    expect(profile).toMatchObject({ applied: true, alreadyApplied: false });
    expect(profile?.failure).toBeUndefined();
    // The proof it actually ran: the profile file was rewritten to the subset.
    expect(await readFile(profilePath(), 'utf8')).not.toBe(before);
  });

  it('does not run a migration when the old version is already past it', async () => {
    await seedLegacyProfile();
    const before = await readFile(profilePath(), 'utf8');

    // Upgrading from the migration's own version forward never re-crosses it.
    const results = await runPendingMigrations(V, ABOVE, { projectDir });

    // Not in the result list at all — it was never attempted.
    expect(profileResult(results)).toBeUndefined();
    // Non-vacuous: relax `crossesVersion`'s strict lower bound to `<=` and this
    // byte-identical assertion goes red, because the migration would rewrite it.
    expect(await readFile(profilePath(), 'utf8')).toBe(before);
  });
});

describe('runPendingMigrations — idempotency', () => {
  it('a second crossing run reports alreadyApplied and does not rewrite the profile', async () => {
    await seedLegacyProfile();

    const first = await runPendingMigrations(BELOW, V, { projectDir });
    expect(profileResult(first)).toMatchObject({ applied: true, alreadyApplied: false });
    const afterFirst = await readFile(profilePath(), 'utf8');

    const second = await runPendingMigrations(BELOW, V, { projectDir });
    // The already-applied verdict is the profile migration's OWN result for a
    // profile that no longer needs converting — not a registry re-derivation.
    expect(profileResult(second)).toMatchObject({ applied: false, alreadyApplied: true });
    // Byte-identical: a second run is inert, never a second mutation.
    expect(await readFile(profilePath(), 'utf8')).toBe(afterFirst);
  });
});

describe('runPendingMigrations — runs the real operate-profile migration (no fork)', () => {
  it('matches inspectOperatingProfileMigration classification of the same file', async () => {
    await seedLegacyProfile();
    // The real classifier's verdict for this exact file, captured before apply.
    const inspection = await inspectOperatingProfileMigration({ projectRoot: projectDir });
    expect(inspection.converted.map((entry) => entry.field)).toEqual(['enabledRoles']);
    expect(inspection.unsupported.map((entry) => entry.field)).toEqual([
      'budgets',
      'enabledProviders',
      'owner',
    ]);

    const results = await runPendingMigrations(BELOW, V, { projectDir });
    expect(profileResult(results)?.applied).toBe(true);

    // The registry's on-disk result is exactly the classifier's `migratedProfile`
    // — the same converted/unsupported handling — proving the shipped migration
    // ran rather than a reimplementation that could classify differently.
    const migrated = JSON.parse(await readFile(profilePath(), 'utf8'));
    expect(migrated).toEqual(inspection.migratedProfile);
    expect(migrated).not.toHaveProperty('enabledProviders');
    expect(migrated).not.toHaveProperty('budgets');
    expect(migrated).not.toHaveProperty('owner');
  });

  it('registers the operate-profile migration keyed to its CHANGELOG version', () => {
    // The proving case is actually wired as an entry, not merely a synthetic
    // example the registry is capable of running.
    const entry = REGISTERED_MIGRATIONS.find((m) => m.id === OPERATE_PROFILE_MIGRATION_ID);
    expect(entry?.version).toBe('1.22.0');
    // And that version is the one the CHANGELOG records for the migration.
    const changelog = readFileSync(resolve('CHANGELOG.md'), 'utf8');
    const section = changelog.slice(changelog.indexOf('## 1.22.0'), changelog.indexOf('## 1.21.2'));
    expect(section).toContain('Legacy operating-profile migration');
  });
});

describe('runPendingMigrations — honest failure reporting (Trap D)', () => {
  it('reports a throwing migration as a failure without aborting the others', async () => {
    const boom: Migration = {
      id: 'boom',
      version: V,
      run: async () => {
        throw new Error('migration blew up');
      },
    };
    const ok: Migration = {
      id: 'ok',
      version: V,
      run: async () => ({ applied: true, alreadyApplied: false }),
    };

    const results = await runPendingMigrations(BELOW, V, { projectDir }, [boom, ok]);

    // A throw is caught into a failure result, and the later migration still runs
    // — one failure never prevents the others from being attempted or reported.
    expect(results).toEqual([
      { id: 'boom', applied: false, alreadyApplied: false, failure: 'migration blew up' },
      { id: 'ok', applied: true, alreadyApplied: false },
    ]);
  });
});

describe('executeCliHalfUpgrade — a failed migration flips ok, never cliUpgraded (Trap D)', () => {
  const cliVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version as string;

  // A throwing migration driven through the REAL registry runner: the registry
  // catches the throw into a failure, and executeCliHalfUpgrade must surface it.
  const throwingMigration: Migration = {
    id: 'always-throws',
    version: '0.0.1',
    run: async () => {
      throw new Error('post-upgrade migration blew up');
    },
  };
  const throwingRunner: MigrationRunner = (_from, _to, ctx) =>
    runPendingMigrations('0.0.0', '0.0.1', ctx, [throwingMigration]);

  it('reports cliUpgraded:true, ok:false, and names the failed migration', async () => {
    // A no-op npm targeting the version already on disk, so the real
    // verify-after-write passes and the migration step is genuinely reached.
    const npm: NpmCommandRunner = () => ({ status: 0, stdout: '', stderr: '' });

    const result = await executeCliHalfUpgrade({
      projectDir: '/tmp/project',
      targetCliVersion: cliVersion,
      npmCommandRunner: npm,
      migrationRunner: throwingRunner,
    });

    // The npm half genuinely landed and verified — its success is not hidden.
    expect(result.cliUpgraded).toBe(true);
    expect(result.installedVersion).toBe(cliVersion);
    // Non-vacuous: delete the `if (failedMigration)` early-return in
    // executeCliHalfUpgrade and `ok` falls through to true — this goes red.
    expect(result.ok).toBe(false);
    expect(result.migrations).toEqual([
      {
        id: 'always-throws',
        applied: false,
        alreadyApplied: false,
        failure: 'post-upgrade migration blew up',
      },
    ]);
    expect(result.failure?.step).toBe('migration');
    expect(result.failure?.message).toContain('always-throws');
  });
});
