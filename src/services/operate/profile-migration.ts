import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDigest, canonicalize, sha256Digest } from './canonical.js';
import {
  FROZEN_OPERATING_BUDGETS,
  FROZEN_OPERATING_PROVIDERS,
  operatingProjectKey,
} from './config.js';
import { applyJournalTransaction, prepareJournalTransaction } from './journal.js';
import { withOperatingLock } from './lock-service.js';
import { OperateError, type OperatingEventHead, type OperatingProfile } from './types.js';
import { resolveOperatingPaths } from './workspace.js';

/**
 * FR10 / T-009 — migrate a stale `.planr/operate-profile.json` into a form the
 * current CLI accepts. This is deliberately a DIFFERENT feature from
 * `legacy-import-service.ts` (which imports legacy PLAN-era board data — findings,
 * decisions, gaps, routes, outcomes — into the event store). Here the subject is
 * the operating profile file itself: guided init used to suggest a profile whose
 * `enabledProviders`/`budgets` the same CLI then rejects. This module classifies
 * each field against the live schema, converts what is compatible, drops what the
 * profile schema cannot carry (reporting it explicitly), keeps role selection,
 * sources, budgets, caps, and author intent where supported, backs up the exact
 * pre-migration bytes before mutating, and is idempotent.
 */

const LEGACY_PROFILE_RELATIVE_PATH = '.planr/operate-profile.json';
const MAX_PROFILE_FILE_BYTES = 64 * 1024;

/** The profile file carries no event-chain state, so its journal write is anchored
 *  to the genesis head rather than the live event store — it stays fully decoupled
 *  from board state and works whether or not the board is initialized. */
const GENESIS_EVENT_HEAD: OperatingEventHead = { sequence: 0, hash: null };

const KNOWN_PROFILE_IDS = new Set<OperatingProfile['id']>([
  'saas',
  'product',
  'engineering',
  'custom',
]);

/** The six operating roles a profile may select (mirrors config.ts's ALL_ROLES,
 *  which is module-private there — doctor.ts keeps its own copy the same way). */
const KNOWN_OPERATING_ROLES = new Set<string>([
  'strategy-finance',
  'technology-risk',
  'product-activation',
  'growth-market',
  'operations-customer',
  'chair',
]);

const CAP_MAXIMA: Readonly<Record<string, number>> = {
  surfacedFindings: 50,
  newSpecs: 12,
  openDecisions: 20,
  agentArtifacts: 20,
};

/** Fields the current operating-profile schema recognizes at the top level. Any
 *  other key is reported as unsupported so nothing is silently discarded. */
const KNOWN_LEGACY_PROFILE_KEYS = new Set([
  'id',
  'title',
  'description',
  'enabledRoles',
  'caps',
  'enabledProviders',
  'budgets',
]);

export interface LegacyProfileFieldConversion {
  field: string;
  detail: string;
}

export interface LegacyProfileUnsupportedField {
  field: string;
  reason: string;
}

export interface LegacyProfileClassification {
  /** The concrete migrated profile — only fields the current schema accepts. */
  migratedProfile: Record<string, unknown>;
  /** The recognized profile id, when the legacy file named a valid one. */
  id: OperatingProfile['id'] | null;
  /** Fields carried through unchanged. */
  preserved: string[];
  /** Fields whose value was normalized to satisfy the current schema. */
  converted: LegacyProfileFieldConversion[];
  /** Fields the current profile schema cannot carry, reported explicitly. */
  unsupported: LegacyProfileUnsupportedField[];
}

export interface OperatingProfileMigrationInspection {
  present: boolean;
  sourcePath: string;
  sourceDigest: `sha256:${string}` | null;
  migrationId: string | null;
  migratedProfile: Record<string, unknown> | null;
  id: OperatingProfile['id'] | null;
  preserved: string[];
  converted: LegacyProfileFieldConversion[];
  unsupported: LegacyProfileUnsupportedField[];
  /** True when applying the migration would rewrite the profile file. */
  changed: boolean;
}

export interface OperatingProfileMigrationResult {
  present: boolean;
  applied: boolean;
  alreadyApplied: boolean;
  migrationId: string | null;
  backupPath: string | null;
  sourceDigest: `sha256:${string}` | null;
  preserved: string[];
  converted: LegacyProfileFieldConversion[];
  unsupported: LegacyProfileUnsupportedField[];
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizedStringSet(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return null;
  return [...new Set((value as string[]).map((entry) => entry.trim()).filter(Boolean))].sort();
}

/**
 * Classify a parsed legacy operating-profile object against the current schema.
 * Pure and total: it never reads the filesystem and never throws on arbitrary
 * JSON, so both guided init (detect-don't-ask) and the migration command can rely
 * on the same field-level verdicts.
 */
export function classifyLegacyOperatingProfile(
  record: Record<string, unknown>,
): LegacyProfileClassification {
  const migratedProfile: Record<string, unknown> = {};
  const preserved: string[] = [];
  const converted: LegacyProfileFieldConversion[] = [];
  const unsupported: LegacyProfileUnsupportedField[] = [];

  let id: OperatingProfile['id'] | null = null;
  if (record.id !== undefined) {
    if (
      typeof record.id === 'string' &&
      KNOWN_PROFILE_IDS.has(record.id as OperatingProfile['id'])
    ) {
      id = record.id as OperatingProfile['id'];
      migratedProfile.id = id;
      preserved.push('id');
    } else {
      unsupported.push({
        field: 'id',
        reason: `names an unknown operating profile \`${String(record.id)}\``,
      });
    }
  }

  for (const key of ['title', 'description'] as const) {
    const value = record[key];
    if (value === undefined) continue;
    if (typeof value === 'string' && value.trim().length > 0 && value.length <= 1024) {
      migratedProfile[key] = value.trim();
      preserved.push(key);
    } else {
      unsupported.push({ field: key, reason: `${key} is not a bounded non-empty string` });
    }
  }

  if (record.enabledRoles !== undefined) {
    const roles = Array.isArray(record.enabledRoles) ? record.enabledRoles : [];
    const stringRoles = roles.filter((role): role is string => typeof role === 'string');
    const unique = [...new Set(stringRoles.map((role) => role.trim()).filter(Boolean))];
    const recognized = unique.filter((role) => KNOWN_OPERATING_ROLES.has(role));
    const dropped = unique.filter((role) => !KNOWN_OPERATING_ROLES.has(role));
    const malformed = !Array.isArray(record.enabledRoles) || stringRoles.length !== roles.length;
    if (recognized.length === 0) {
      unsupported.push({
        field: 'enabledRoles',
        reason: 'names no recognized operating role',
      });
    } else if (dropped.length > 0 || malformed) {
      migratedProfile.enabledRoles = recognized;
      converted.push({
        field: 'enabledRoles',
        detail:
          dropped.length > 0
            ? `dropped unrecognized role(s): ${dropped.join(', ')}`
            : 'dropped malformed role entries',
      });
    } else {
      migratedProfile.enabledRoles = recognized;
      preserved.push('enabledRoles');
    }
  }

  if (record.caps !== undefined) {
    const caps = classifyCaps(record.caps);
    if (caps.ok) {
      migratedProfile.caps = caps.caps;
      preserved.push('caps');
    } else {
      unsupported.push({ field: 'caps', reason: caps.reason });
    }
  }

  // Providers ("sources") and budgets are fixed by the engine and are not carried
  // on the profile schema, so they are always dropped from the migrated file. A
  // value matching the fixed shape is a safe conversion; anything else is reported
  // as unsupported so the operator sees exactly what the CLI would not reuse.
  if (record.enabledProviders !== undefined) {
    const providers = normalizedStringSet(record.enabledProviders);
    const frozen = [...FROZEN_OPERATING_PROVIDERS].sort();
    if (
      providers &&
      providers.length === frozen.length &&
      providers.every((p, i) => p === frozen[i])
    ) {
      converted.push({
        field: 'enabledProviders',
        detail: `folded into the fixed providers (${frozen.join(', ')})`,
      });
    } else {
      const unknownProviders = (providers ?? []).filter(
        (provider) => !(FROZEN_OPERATING_PROVIDERS as readonly string[]).includes(provider),
      );
      unsupported.push({
        field: 'enabledProviders',
        reason:
          unknownProviders.length > 0
            ? `includes provider(s) the operating configuration does not accept: ${unknownProviders.join(', ')}`
            : `differs from the fixed providers (${frozen.join(', ')}) and will not be reused as-is`,
      });
    }
  }

  if (record.budgets !== undefined) {
    if (canonicalize(record.budgets) === canonicalize(FROZEN_OPERATING_BUDGETS)) {
      converted.push({ field: 'budgets', detail: 'matches the fixed operating budgets' });
    } else {
      unsupported.push({
        field: 'budgets',
        reason: 'differs from the fixed operating budgets and will not be reused as-is',
      });
    }
  }

  for (const key of Object.keys(record)) {
    if (!KNOWN_LEGACY_PROFILE_KEYS.has(key)) {
      unsupported.push({
        field: key,
        reason: 'is not part of the current operating profile schema',
      });
    }
  }

  return {
    migratedProfile,
    id,
    preserved: preserved.sort(),
    converted: converted.sort((a, b) => a.field.localeCompare(b.field)),
    unsupported: unsupported.sort((a, b) => a.field.localeCompare(b.field)),
  };
}

function classifyCaps(
  value: unknown,
): { ok: true; caps: Record<string, number> } | { ok: false; reason: string } {
  if (!plainObject(value)) return { ok: false, reason: 'caps must be a JSON object' };
  const unknown = Object.keys(value).filter((key) => !(key in CAP_MAXIMA));
  if (unknown.length > 0) {
    return { ok: false, reason: `caps has unsupported field(s): ${unknown.join(', ')}` };
  }
  const caps: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    const maximum = CAP_MAXIMA[key];
    if (!Number.isInteger(entry) || (entry as number) < 1 || (entry as number) > maximum) {
      return { ok: false, reason: `caps.${key} is outside the supported 1-${maximum} range` };
    }
    caps[key] = entry as number;
  }
  return { ok: true, caps };
}

/**
 * Compare a parsed legacy profile against a parsed operating-config, returning the
 * sorted names of the fields that differ. Only fields present on the profile are
 * compared. Used by the doctor profile/config-drift diagnostic. Pure and total.
 */
export function compareLegacyProfileToOperatingConfig(
  profile: Record<string, unknown>,
  config: Record<string, unknown>,
): string[] {
  const drift: string[] = [];
  if ('id' in profile && String(profile.id) !== String(config.profile)) drift.push('id');
  if ('enabledRoles' in profile && !sameStringSet(profile.enabledRoles, config.enabledRoles)) {
    drift.push('enabledRoles');
  }
  if (
    'caps' in profile &&
    canonicalize(profile.caps ?? null) !== canonicalize(config.caps ?? null)
  ) {
    drift.push('caps');
  }
  if (
    'enabledProviders' in profile &&
    !sameStringSet(profile.enabledProviders, config.enabledProviders)
  ) {
    drift.push('enabledProviders');
  }
  if (
    'budgets' in profile &&
    canonicalize(profile.budgets ?? null) !== canonicalize(config.budgets ?? null)
  ) {
    drift.push('budgets');
  }
  return drift.sort();
}

function sameStringSet(left: unknown, right: unknown): boolean {
  const a = normalizedStringSet(left);
  const b = normalizedStringSet(right);
  if (a === null || b === null) return canonicalize(left ?? null) === canonicalize(right ?? null);
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

interface LegacyProfileFile {
  raw: string;
  buffer: Buffer;
  record: Record<string, unknown>;
  digest: `sha256:${string}`;
}

async function readLegacyProfileFile(projectRoot: string): Promise<LegacyProfileFile | null> {
  const target = path.join(projectRoot, '.planr', 'operate-profile.json');
  const buffer = await readFile(target).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (buffer === null) return null;
  if (buffer.byteLength > MAX_PROFILE_FILE_BYTES) {
    throw new OperateError(
      'E_OPERATE_INPUT_TOO_LARGE',
      `${LEGACY_PROFILE_RELATIVE_PATH} exceeds the ${MAX_PROFILE_FILE_BYTES}-byte limit.`,
    );
  }
  const raw = buffer.toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      `${LEGACY_PROFILE_RELATIVE_PATH} is not valid JSON.`,
    );
  }
  if (!plainObject(parsed)) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      `${LEGACY_PROFILE_RELATIVE_PATH} must be a JSON object.`,
    );
  }
  return { raw, buffer, record: parsed, digest: sha256Digest(buffer) };
}

function profileMigrationId(sourceDigest: `sha256:${string}`): string {
  return `PMIG-${sourceDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`;
}

/** A field is "changed" when applying would strip or rewrite it. */
function migrationChanges(classification: LegacyProfileClassification): boolean {
  return classification.converted.length > 0 || classification.unsupported.length > 0;
}

export async function inspectOperatingProfileMigration(input: {
  projectRoot: string;
  localRoot?: string;
}): Promise<OperatingProfileMigrationInspection> {
  const file = await readLegacyProfileFile(input.projectRoot);
  if (file === null) {
    return {
      present: false,
      sourcePath: LEGACY_PROFILE_RELATIVE_PATH,
      sourceDigest: null,
      migrationId: null,
      migratedProfile: null,
      id: null,
      preserved: [],
      converted: [],
      unsupported: [],
      changed: false,
    };
  }
  const classification = classifyLegacyOperatingProfile(file.record);
  return {
    present: true,
    sourcePath: LEGACY_PROFILE_RELATIVE_PATH,
    sourceDigest: file.digest,
    migrationId: profileMigrationId(file.digest),
    migratedProfile: classification.migratedProfile,
    id: classification.id,
    preserved: classification.preserved,
    converted: classification.converted,
    unsupported: classification.unsupported,
    changed: migrationChanges(classification),
  };
}

interface ProfileBackupManifest {
  implementation: 'openplanr-operate-profile-backup';
  version: '1.0.0';
  migrationId: string;
  sourcePath: typeof LEGACY_PROFILE_RELATIVE_PATH;
  sourceDigest: `sha256:${string}`;
  backupFile: 'operate-profile.json';
}

/** Write bytes at mode 0600, failing closed on any tampering. Re-writing the same
 *  bytes is a safe no-op so a resumed apply reuses the exact prior backup. */
async function writePrivateBytes(target: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    const handle = await open(target, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await readFile(target);
    if (sha256Digest(existing) !== sha256Digest(bytes)) {
      throw new OperateError(
        'E_OPERATE_MIGRATION_CONFLICT',
        `Operating profile backup changed unexpectedly: ${path.basename(target)}`,
      );
    }
  }
}

async function writeExactBackup(input: {
  projectRoot: string;
  localRoot?: string;
  migrationId: string;
  sourceBytes: Buffer;
  sourceDigest: `sha256:${string}`;
}): Promise<string> {
  const root = path.join(
    resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot }).localRoot,
    'profile-migration-backups',
    input.migrationId,
  );
  const backupFile = path.join(root, 'operate-profile.json');
  await writePrivateBytes(backupFile, input.sourceBytes);
  const manifest: ProfileBackupManifest = {
    implementation: 'openplanr-operate-profile-backup',
    version: '1.0.0',
    migrationId: input.migrationId,
    sourcePath: LEGACY_PROFILE_RELATIVE_PATH,
    sourceDigest: input.sourceDigest,
    backupFile: 'operate-profile.json',
  };
  await writePrivateBytes(
    path.join(root, 'manifest.json'),
    Buffer.from(`${canonicalize(manifest)}\n`),
  );
  return backupFile;
}

export async function applyOperatingProfileMigration(input: {
  projectRoot: string;
  confirmed: boolean;
  localRoot?: string;
  now?: string;
}): Promise<OperatingProfileMigrationResult> {
  const preview = await inspectOperatingProfileMigration(input);
  if (!preview.present) {
    return {
      present: false,
      applied: false,
      alreadyApplied: false,
      migrationId: null,
      backupPath: null,
      sourceDigest: null,
      preserved: [],
      converted: [],
      unsupported: [],
    };
  }
  if (!preview.changed) {
    // Idempotent: the profile already carries only supported fields, so a second
    // apply (or an apply of an already-clean profile) reports already-applied and
    // makes no further change.
    return {
      present: true,
      applied: false,
      alreadyApplied: true,
      migrationId: preview.migrationId,
      backupPath: null,
      sourceDigest: preview.sourceDigest,
      preserved: preview.preserved,
      converted: preview.converted,
      unsupported: preview.unsupported,
    };
  }
  if (!input.confirmed) {
    throw new OperateError(
      'E_OPERATE_AUTHORITY_REQUIRED',
      'Operating profile migration requires explicit confirmation of its preview.',
      { preview },
    );
  }

  return withOperatingLock(
    input.projectRoot,
    {
      projectKey: operatingProjectKey(input.projectRoot),
      name: 'profile-migration',
      expectedEventHead: GENESIS_EVENT_HEAD,
      currentEventHead: GENESIS_EVENT_HEAD,
      localRoot: input.localRoot,
    },
    async () => {
      const file = await readLegacyProfileFile(input.projectRoot);
      if (file === null) {
        return {
          present: false,
          applied: false,
          alreadyApplied: false,
          migrationId: null,
          backupPath: null,
          sourceDigest: null,
          preserved: [],
          converted: [],
          unsupported: [],
        };
      }
      const classification = classifyLegacyOperatingProfile(file.record);
      const migrationId = profileMigrationId(file.digest);
      if (!migrationChanges(classification)) {
        return {
          present: true,
          applied: false,
          alreadyApplied: true,
          migrationId,
          backupPath: null,
          sourceDigest: file.digest,
          preserved: classification.preserved,
          converted: classification.converted,
          unsupported: classification.unsupported,
        };
      }
      // Exact pre-migration backup BEFORE any mutation.
      const backupPath = await writeExactBackup({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
        migrationId,
        sourceBytes: file.buffer,
        sourceDigest: file.digest,
      });
      // Transactional, fsynced rewrite of the profile file (journal keeps a
      // before-image and rolls back on any failure). Anchored to the genesis head
      // because the profile is not part of the event chain.
      const desired = `${canonicalize(classification.migratedProfile)}\n`;
      const prepared = await prepareJournalTransaction(input.projectRoot, {
        transactionId: `TXN-${migrationId}-apply`,
        writes: [
          {
            relativePath: LEGACY_PROFILE_RELATIVE_PATH,
            operation: 'replace',
            content: desired,
            mode: '0644',
          },
        ],
        eventHead: GENESIS_EVENT_HEAD,
        previewDigest: canonicalDigest({
          migrationId,
          sourceDigest: file.digest,
          target: classification.migratedProfile,
        }),
        localRoot: input.localRoot,
        now: input.now,
      });
      await applyJournalTransaction(input.projectRoot, prepared, {
        currentEventHead: GENESIS_EVENT_HEAD,
      });
      return {
        present: true,
        applied: true,
        alreadyApplied: false,
        migrationId,
        backupPath,
        sourceDigest: file.digest,
        preserved: classification.preserved,
        converted: classification.converted,
        unsupported: classification.unsupported,
      };
    },
  );
}
