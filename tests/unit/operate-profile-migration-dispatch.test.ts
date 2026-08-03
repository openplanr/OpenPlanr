import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeOperateAction } from '../../src/services/operate/index.js';
import {
  detectOperatingStorageLayout,
  type OperatingStorageLayout,
} from '../../src/services/operate/migration.js';
import type { OperateActionRequest } from '../../src/services/operate/types.js';

/**
 * T-018 — the `profiles migrate inspect|apply` commands must dispatch through
 * `executeOperateAction`, not straight to `profile-migration.ts`, so the mutating
 * `apply` receives the storage-layout auto-migration guard every other opening
 * *write* action gets (FR5 / E-005). QA flagged that the T-009 direct wiring
 * skipped that guard.
 *
 * The apply proof is behavioural: `apply` is run against a genuine SPEC-002 (v1.2)
 * layout that NEEDS migration. If the guard runs (i.e. `apply` truly went through
 * the dispatcher and is not treated as read-only), the on-disk layout is
 * reconciled to v1.3 before the profile is rewritten. If the routing were reverted
 * — direct module call, or the action added to the read-only allowlist — the
 * layout would stay v1.2 and that test fails.
 *
 * `inspect` is the inverse: it is a read-only preview (FR10 previews without
 * mutating), so running it against a v1.2 tree must LEAVE the layout v1.2 and the
 * profile file byte-identical — it must never migrate storage as a side effect.
 *
 * T-009's own migration tests (`operate-profile-migration.test.ts`) still assert
 * the unchanged idempotent backup/rollback semantics against the module directly.
 */

let root: string;
let projectRoot: string;
let localRoot: string;

const profilePath = () => join(projectRoot, '.planr', 'operate-profile.json');

// A legacy profile that drifts from the current schema: a compatible id/role/caps
// subset plus fields the CLI rejects, so migration has real work to do.
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

async function writeProfile(profile: unknown): Promise<string> {
  const bytes = `${JSON.stringify(profile)}\n`;
  await writeFile(profilePath(), bytes);
  return bytes;
}

/**
 * Seed a minimal-but-genuine SPEC-002 (v1.2) storage layout. An empty
 * `records/sha256` directory is enough for `detectOperatingStorageLayout` to
 * classify the project as v1.2, which the auto-migration guard then reconciles to
 * v1.3 through the write-ahead journal (identical to the full fixture, with zero
 * records to carry).
 */
async function seedLegacyStorageLayout(): Promise<void> {
  await mkdir(join(projectRoot, '.planr', 'operate', 'records', 'sha256'), { recursive: true });
}

function layout(): Promise<OperatingStorageLayout> {
  return detectOperatingStorageLayout(projectRoot, { localRoot });
}

function request(action: string, options: Record<string, unknown> = {}): OperateActionRequest {
  return {
    action,
    projectRoot,
    interactive: false,
    arguments: {},
    options: { localRoot, json: true, ...options },
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openplanr-profile-migration-dispatch-'));
  projectRoot = join(root, 'project');
  localRoot = join(root, 'state');
  await mkdir(join(projectRoot, '.planr'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('profiles migrate dispatch (T-018)', () => {
  it('registers both commands in the action map (no unknown-action failure)', async () => {
    await writeProfile({ id: 'saas', title: 'SaaS', description: 'Balanced.' });

    const inspect = await executeOperateAction(request('profiles.migrate.inspect'));
    const apply = await executeOperateAction(request('profiles.migrate.apply', { yes: true }));

    for (const result of [inspect, apply]) {
      expect(result.ok).toBe(true);
      expect(result.code).not.toBe('E_OPERATE_ACTION_UNKNOWN');
    }
  });

  it('runs the storage-layout auto-migration guard when apply opens a v1.2 tree', async () => {
    const original = await writeProfile(LEGACY_PROFILE);
    await seedLegacyStorageLayout();
    expect(await layout()).toBe('v1.2');

    const result = await executeOperateAction(request('profiles.migrate.apply', { yes: true }));

    // Dispatch reached the guard: the SPEC-002 layout was migrated to v1.3 on open.
    // A bypass (direct module call, or a read-only classification) leaves it v1.2.
    expect(result.ok).toBe(true);
    expect(await layout()).toBe('v1.3');

    // The profile migration itself still ran through the handler: exact backup +
    // supported-subset rewrite (semantics owned by profile-migration.ts).
    const data = result.data as {
      applied: boolean;
      backupPath: string | null;
      converted: unknown[];
      unsupported: unknown[];
    };
    expect(data.applied).toBe(true);
    expect(data.backupPath).toBeTruthy();
    expect(await readFile(data.backupPath as string, 'utf8')).toBe(original);
    const migrated = JSON.parse(await readFile(profilePath(), 'utf8'));
    expect(migrated).toEqual({
      id: 'engineering',
      title: 'Engineering board',
      description: 'Delivery, reliability, and risk.',
      enabledRoles: ['technology-risk', 'chair'],
      caps: { surfacedFindings: 10, newSpecs: 3, openDecisions: 3, agentArtifacts: 2 },
    });
  });

  it('leaves a v1.2 tree unmigrated when inspect previews it (read-only, no side effect)', async () => {
    const original = await writeProfile(LEGACY_PROFILE);
    await seedLegacyStorageLayout();
    expect(await layout()).toBe('v1.2');

    const result = await executeOperateAction(request('profiles.migrate.inspect'));

    // Inspect is a read-only preview (FR10): it reports the pending migration but
    // must NOT reconcile the storage layout — a preview run to decide *whether* to
    // migrate must never perform part of a migration as a side effect.
    expect(result.ok).toBe(true);
    expect((result.data as { changed: boolean }).changed).toBe(true);
    expect(await layout()).toBe('v1.2');

    // Nothing on disk was mutated: neither the storage layout nor the profile file.
    expect(await readFile(profilePath(), 'utf8')).toBe(original);
  });

  it('stays a fast no-op on an already-v1.3 tree while still applying the profile migration', async () => {
    await writeProfile(LEGACY_PROFILE);

    // No SPEC-002 residue: detection is 'absent', so the guard has nothing to do
    // and the profile migration proceeds normally through the dispatcher.
    expect(await layout()).toBe('absent');
    const result = await executeOperateAction(request('profiles.migrate.apply', { yes: true }));

    expect(result.ok).toBe(true);
    expect((result.data as { applied: boolean }).applied).toBe(true);
    expect(await layout()).toBe('absent');
  });

  it('keeps the idempotent apply reporting already-applied through the dispatcher', async () => {
    await writeProfile(LEGACY_PROFILE);

    const first = await executeOperateAction(request('profiles.migrate.apply', { yes: true }));
    expect((first.data as { applied: boolean }).applied).toBe(true);
    const afterFirst = await readFile(profilePath(), 'utf8');

    const second = await executeOperateAction(request('profiles.migrate.apply', { yes: true }));
    expect(second.ok).toBe(true);
    expect(second.data).toMatchObject({ applied: false, alreadyApplied: true });
    expect(await readFile(profilePath(), 'utf8')).toBe(afterFirst);
  });

  it('surfaces an authority failure when apply is dispatched without confirmation', async () => {
    await writeProfile(LEGACY_PROFILE);

    const result = await executeOperateAction(request('profiles.migrate.apply', { yes: false }));

    expect(result.ok).toBe(false);
    expect(result.code).toBe('E_OPERATE_AUTHORITY_REQUIRED');
    // The profile is left untouched when confirmation is withheld.
    expect(JSON.parse(await readFile(profilePath(), 'utf8'))).toMatchObject({
      owner: 'a-legacy-field',
    });
  });
});
