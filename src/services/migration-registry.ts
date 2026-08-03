import { applyOperatingProfileMigration } from './operate/profile-migration.js';

/**
 * FR7 — a versioned migration registry.
 *
 * A migration reconciles state a reinstall cannot fix — stale config, orphaned
 * files, a changed on-disk layout. Each is idempotent, keyed to the CLI version
 * that introduced the state it repairs, and runs ONLY when an upgrade crosses
 * that version. The registry does not re-implement backup/restore: every
 * migration owns its own restorable backup, so the registry's sole job is to
 * decide which migrations a given upgrade crosses, run them in ascending version
 * order, and report each result honestly — one failure never prevents the others
 * from being attempted or from being reported individually.
 *
 * This runs after a verified-successful CLI-half upgrade (T-003's
 * `executeCliHalfUpgrade`), which injects `runPendingMigrations` as its migration
 * runner. It never re-derives the upgrade executor and never runs a mutation on
 * an install the CLI half did not first land and verify.
 */

/** The single input a migration reconciles: the user's project on disk. */
export interface MigrationContext {
  projectDir: string;
}

/**
 * The verdict of a single migration. `applied` — it mutated state this run;
 * `alreadyApplied` — the state was already reconciled, so this run was inert (a
 * safe idempotent no-op); `failure` — it could not complete, reported rather
 * than swallowed. A migration reports a soft failure here or throws (which the
 * runner catches into the same shape).
 */
export interface MigrationOutcome {
  applied: boolean;
  alreadyApplied: boolean;
  failure?: string;
}

export interface Migration {
  /** Stable identity, surfaced in the per-migration result. */
  id: string;
  /**
   * The CLI version that introduced the state this migration reconciles. The
   * migration runs iff an upgrade crosses this version.
   */
  version: string;
  run(ctx: MigrationContext): Promise<MigrationOutcome>;
}

/** A migration's outcome paired with its id, as `runPendingMigrations` returns it. */
export interface MigrationRunResult extends MigrationOutcome {
  id: string;
}

/** Parse a plain `X.Y.Z` version, or `null` when it is not a stable release. */
function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** -1 | 0 | 1 comparing two `X.Y.Z` versions, or `null` when either is not stable. */
function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

/**
 * A migration keyed to `version` runs iff the upgrade crosses it:
 * `fromVersion < version <= toVersion`. The strict lower bound is deliberate — a
 * migration whose version is at or below the version already installed has
 * already been carried and must never re-run. When either endpoint is not a plain
 * `X.Y.Z` (a prerelease or unknown build), the window cannot be judged, so the
 * migration is treated as NOT crossing: a state mutation must never run on an
 * ambiguous version boundary.
 */
export function crossesVersion(fromVersion: string, toVersion: string, version: string): boolean {
  const lower = compareVersions(fromVersion, version); // fromVersion vs version
  const upper = compareVersions(version, toVersion); // version vs toVersion
  if (lower === null || upper === null) return false;
  return lower < 0 && upper <= 0;
}

/**
 * The legacy operating-profile migration, keyed to `1.22.0` — the
 * CHANGELOG-verified version that introduced `.planr/operate-profile.json`
 * migration support. It shipped as a bespoke, manually-invoked command (`planr
 * operate profiles migrate inspect|apply`) precisely because this registry did
 * not yet exist, which makes it the proving case: an upgrade crossing `1.22.0`
 * must carry the user across automatically rather than leaving them to discover a
 * one-off command.
 *
 * This entry does NOT fork that logic — it delegates to the shipped
 * `applyOperatingProfileMigration`, so its exact-backup-before-mutation,
 * journalled write with rollback, and idempotency guarantees (and their tests)
 * are the ones already proven. `confirmed` is set because the crossing only
 * happens inside a `planr upgrade apply` the user already confirmed; the
 * delegated apply still takes its own restorable backup before any mutation, so a
 * failure stays recoverable. An absent profile is a safe no-op.
 */
export const OPERATE_PROFILE_MIGRATION_ID = 'operate-profile-schema';
export const OPERATE_PROFILE_MIGRATION_VERSION = '1.22.0';

const operateProfileMigration: Migration = {
  id: OPERATE_PROFILE_MIGRATION_ID,
  version: OPERATE_PROFILE_MIGRATION_VERSION,
  async run(ctx) {
    const result = await applyOperatingProfileMigration({
      projectRoot: ctx.projectDir,
      confirmed: true,
    });
    return { applied: result.applied, alreadyApplied: result.alreadyApplied };
  },
};

/**
 * The ordered registry. New migrations append here, each keyed to the version
 * that introduced the state it reconciles.
 */
export const REGISTERED_MIGRATIONS: readonly Migration[] = [operateProfileMigration];

/**
 * Run every registered migration the upgrade crosses, in ascending version
 * order, collecting one result per migration. A migration that throws is caught
 * and reported as `{ applied: false, alreadyApplied: false, failure }`, so a
 * single failure neither aborts the run nor is silently swallowed into an overall
 * success — the caller decides what a failure means for the upgrade as a whole. A
 * migration this upgrade does not cross is not in the returned list at all.
 *
 * `migrations` is a test seam (a synthetic registry); production omits it and
 * runs the real `REGISTERED_MIGRATIONS`.
 */
export async function runPendingMigrations(
  fromVersion: string,
  toVersion: string,
  ctx: MigrationContext,
  migrations: readonly Migration[] = REGISTERED_MIGRATIONS,
): Promise<MigrationRunResult[]> {
  const pending = [...migrations]
    .filter((migration) => crossesVersion(fromVersion, toVersion, migration.version))
    .sort((a, b) => compareVersions(a.version, b.version) ?? 0);

  const results: MigrationRunResult[] = [];
  for (const migration of pending) {
    try {
      const outcome = await migration.run(ctx);
      results.push({ id: migration.id, ...outcome });
    } catch (error) {
      results.push({
        id: migration.id,
        applied: false,
        alreadyApplied: false,
        failure: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
