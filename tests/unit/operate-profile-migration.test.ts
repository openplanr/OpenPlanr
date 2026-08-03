import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyOperatingProfileMigration,
  classifyLegacyOperatingProfile,
  compareLegacyProfileToOperatingConfig,
  inspectOperatingProfileMigration,
} from '../../src/services/operate/profile-migration.js';

let root: string;
let projectRoot: string;
let localRoot: string;

const profilePath = () => join(projectRoot, '.planr', 'operate-profile.json');

async function writeProfile(profile: unknown): Promise<string> {
  const bytes = `${JSON.stringify(profile)}\n`;
  await writeFile(profilePath(), bytes);
  return bytes;
}

// A legacy profile that carries both compatible intent (id, author strings, a
// recognized role subset, valid caps) and fields the current CLI rejects
// (an unknown provider, non-frozen budgets, an unknown role, an unknown key).
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

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openplanr-profile-migration-'));
  projectRoot = join(root, 'project');
  localRoot = join(root, 'state');
  await mkdir(join(projectRoot, '.planr'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('classifyLegacyOperatingProfile', () => {
  it('preserves supported intent, converts a compatible role list, and reports unsupported fields', () => {
    const classification = classifyLegacyOperatingProfile(LEGACY_PROFILE);
    expect(classification.id).toBe('engineering');
    expect(classification.preserved).toEqual(['caps', 'description', 'id', 'title']);
    expect(classification.migratedProfile).toEqual({
      id: 'engineering',
      title: 'Engineering board',
      description: 'Delivery, reliability, and risk.',
      enabledRoles: ['technology-risk', 'chair'],
      caps: { surfacedFindings: 10, newSpecs: 3, openDecisions: 3, agentArtifacts: 2 },
    });
    expect(classification.converted.map((entry) => entry.field)).toEqual(['enabledRoles']);
    expect(classification.unsupported.map((entry) => entry.field)).toEqual([
      'budgets',
      'enabledProviders',
      'owner',
    ]);
    // The migrated form carries none of the rejected fields.
    expect(classification.migratedProfile).not.toHaveProperty('enabledProviders');
    expect(classification.migratedProfile).not.toHaveProperty('budgets');
    expect(classification.migratedProfile).not.toHaveProperty('owner');
  });

  it('treats a schema-clean profile as requiring no conversion', () => {
    const classification = classifyLegacyOperatingProfile({
      id: 'saas',
      title: 'SaaS',
      description: 'Balanced.',
    });
    expect(classification.converted).toEqual([]);
    expect(classification.unsupported).toEqual([]);
  });
});

describe('inspectOperatingProfileMigration', () => {
  it('reports the preview and unsupported fields without mutating the profile file', async () => {
    const original = await writeProfile(LEGACY_PROFILE);

    const inspection = await inspectOperatingProfileMigration({ projectRoot, localRoot });

    expect(inspection.present).toBe(true);
    expect(inspection.changed).toBe(true);
    expect(inspection.id).toBe('engineering');
    expect(inspection.converted.map((entry) => entry.field)).toEqual(['enabledRoles']);
    expect(inspection.unsupported.map((entry) => entry.field)).toEqual([
      'budgets',
      'enabledProviders',
      'owner',
    ]);
    expect(inspection.migratedProfile).not.toHaveProperty('enabledProviders');

    // Inspect is write-free: the profile file is byte-identical afterwards.
    expect(await readFile(profilePath(), 'utf8')).toBe(original);
  });

  it('reports an absent profile without error', async () => {
    const inspection = await inspectOperatingProfileMigration({ projectRoot, localRoot });
    expect(inspection).toMatchObject({ present: false, changed: false, migratedProfile: null });
  });

  it('reports a schema-clean profile as unchanged', async () => {
    await writeProfile({ id: 'saas', title: 'SaaS', description: 'Balanced.' });
    const inspection = await inspectOperatingProfileMigration({ projectRoot, localRoot });
    expect(inspection).toMatchObject({ present: true, changed: false });
  });
});

describe('applyOperatingProfileMigration', () => {
  it('requires explicit confirmation before mutating a drifting profile', async () => {
    await writeProfile(LEGACY_PROFILE);
    await expect(
      applyOperatingProfileMigration({ projectRoot, confirmed: false, localRoot }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_AUTHORITY_REQUIRED' });
  });

  it('writes an exact pre-migration backup and rewrites the profile to the supported subset', async () => {
    const original = await writeProfile(LEGACY_PROFILE);

    const applied = await applyOperatingProfileMigration({
      projectRoot,
      confirmed: true,
      localRoot,
    });

    expect(applied).toMatchObject({ present: true, applied: true, alreadyApplied: false });
    expect(applied.backupPath).toBeTruthy();

    // The backup holds the EXACT pre-migration bytes.
    expect(await readFile(applied.backupPath as string, 'utf8')).toBe(original);

    // The profile now carries only supported fields.
    const migrated = JSON.parse(await readFile(profilePath(), 'utf8'));
    expect(migrated).toEqual({
      id: 'engineering',
      title: 'Engineering board',
      description: 'Delivery, reliability, and risk.',
      enabledRoles: ['technology-risk', 'chair'],
      caps: { surfacedFindings: 10, newSpecs: 3, openDecisions: 3, agentArtifacts: 2 },
    });
    expect(migrated).not.toHaveProperty('enabledProviders');
    expect(migrated).not.toHaveProperty('budgets');
  });

  it('is idempotent: a second apply reports already-applied and makes no further change', async () => {
    await writeProfile(LEGACY_PROFILE);

    const first = await applyOperatingProfileMigration({ projectRoot, confirmed: true, localRoot });
    expect(first.applied).toBe(true);
    const afterFirst = await readFile(profilePath(), 'utf8');

    const second = await applyOperatingProfileMigration({
      projectRoot,
      confirmed: true,
      localRoot,
    });
    expect(second).toMatchObject({ present: true, applied: false, alreadyApplied: true });

    // No further change: the file is byte-identical to the first apply's output.
    expect(await readFile(profilePath(), 'utf8')).toBe(afterFirst);
  });

  it('is a no-op for a schema-clean profile', async () => {
    const clean = await writeProfile({ id: 'saas', title: 'SaaS', description: 'Balanced.' });
    const applied = await applyOperatingProfileMigration({
      projectRoot,
      confirmed: true,
      localRoot,
    });
    expect(applied).toMatchObject({ present: true, applied: false, alreadyApplied: true });
    expect(applied.backupPath).toBeNull();
    expect(await readFile(profilePath(), 'utf8')).toBe(clean);
  });

  it('reports an absent profile without error', async () => {
    const applied = await applyOperatingProfileMigration({
      projectRoot,
      confirmed: true,
      localRoot,
    });
    expect(applied).toMatchObject({ present: false, applied: false, alreadyApplied: false });
  });
});

describe('compareLegacyProfileToOperatingConfig', () => {
  const config = {
    profile: 'engineering',
    enabledRoles: ['technology-risk', 'product-activation', 'operations-customer', 'chair'],
    caps: { surfacedFindings: 10, newSpecs: 3, openDecisions: 3, agentArtifacts: 2 },
    enabledProviders: ['repository', 'planr', 'git'],
    budgets: { maxFiles: 1000, maxItems: 2000, maxBytes: 10485760, maxDurationMs: 60000 },
  };

  it('names the fields that differ between a legacy profile and the live config', () => {
    const drift = compareLegacyProfileToOperatingConfig(
      {
        id: 'engineering',
        enabledProviders: ['repository', 'planr', 'git', 'linear'],
        budgets: { maxFiles: 5, maxItems: 5, maxBytes: 5, maxDurationMs: 5 },
      },
      config,
    );
    expect(drift).toEqual(['budgets', 'enabledProviders']);
  });

  it('reports no drift when the compared fields match (order-insensitive for sets)', () => {
    const drift = compareLegacyProfileToOperatingConfig(
      { id: 'engineering', enabledProviders: ['git', 'planr', 'repository'] },
      config,
    );
    expect(drift).toEqual([]);
  });
});
