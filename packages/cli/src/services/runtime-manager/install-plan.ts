import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { RuntimeId } from './inventory.js';

export type PlannedFileAction = Readonly<{
  runtime: RuntimeId | 'core';
  scope: 'user' | 'project';
  target: string;
  content: Buffer;
  kind: 'file' | 'managed-block';
  marker?: string;
  description: string;
}>;

export type PlannedOwnedFile = Readonly<{
  runtime: RuntimeId | 'core';
  scope?: 'user' | 'project';
  target: string;
  kind: 'file' | 'managed-block';
  marker?: string;
  hash: string;
}>;

type Conflict = (message: string, recovery: string) => never;

const KNOWN_STALE_SKILL_FINGERPRINTS = new Map([
  [
    `${path.sep}planr-operate${path.sep}SKILL.md`,
    'b77ca2825036994a3950e6754e471d427e6382bfe160d5c74d267e5b92910aa0',
  ],
]);

function isKnownStaleSkill(target: string, digest: string): boolean {
  return [...KNOWN_STALE_SKILL_FINGERPRINTS.entries()].some(
    ([suffix, fingerprint]) => target.endsWith(suffix) && digest === fingerprint,
  );
}

/** Inventories every exact regular file under one owned skill root and rejects links/specials. */
export function inventoryManagedSkillFiles(root: string, conflict: Conflict): string[] {
  const stat = lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return conflict(
      `Refusing to use non-directory or symbolic-link Codex skill root ${root}.`,
      'Preserve the existing entry and replace it with a real skill directory before rerunning setup.',
    );
  }
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        conflict(
          `Refusing to traverse symbolic link ${target} in a managed Codex skill tree.`,
          'Preserve or move the link outside the managed skill directory before rerunning setup.',
        );
      }
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) files.push(path.resolve(target));
      else {
        conflict(
          `Refusing unsupported filesystem entry ${target} in a managed Codex skill tree.`,
          'Preserve or move the entry outside the managed skill directory before rerunning setup.',
        );
      }
    }
  };
  visit(root);
  return files;
}

function desiredSkillRoots(
  actions: Iterable<PlannedFileAction>,
  skillsRoot: string,
  pathIsWithin: (candidate: string, root: string) => boolean,
): string[] {
  const roots = new Set<string>();
  for (const action of actions) {
    if (
      action.runtime !== 'codex' ||
      action.scope !== 'user' ||
      !pathIsWithin(action.target, skillsRoot)
    ) {
      continue;
    }
    const first = path.relative(skillsRoot, action.target).split(path.sep)[0];
    if (first) roots.add(path.join(skillsRoot, first));
  }
  return [...roots];
}

/** Owns the complete fail-closed transition plan for the global Codex skill bundle. */
export function planCodexUserBundleTransition(input: {
  actions: PlannedFileAction[];
  existing: PlannedOwnedFile[];
  skillsRoot: string;
  pathIsWithin: (candidate: string, root: string) => boolean;
  assertUserOwnedTarget: (
    entry: PlannedFileAction | PlannedOwnedFile,
    runtime: 'codex',
    code: 'E_MIGRATION_CONFLICT' | 'E_RUNTIME_STATE_INVALID',
  ) => void;
  ownershipHash: (
    content: string | Buffer,
    kind: PlannedFileAction['kind'],
    marker?: string,
  ) => string;
  hash: (content: string | Buffer) => string;
  actionBytes: (action: PlannedFileAction) => Buffer;
  conflict: Conflict;
}): { retired: PlannedOwnedFile[] } {
  const desired = new Map(
    input.actions
      .filter((action) => action.runtime === 'codex' && action.scope === 'user')
      .map((action) => [action.target, action]),
  );
  for (const action of desired.values()) {
    input.assertUserOwnedTarget(action, 'codex', 'E_MIGRATION_CONFLICT');
  }
  for (const file of input.existing) {
    input.assertUserOwnedTarget(file, 'codex', 'E_RUNTIME_STATE_INVALID');
  }
  const tracked = new Map(input.existing.map((file) => [file.target, file]));
  const allowed = new Set(
    [...desired.keys(), ...tracked.keys()].map((target) => path.resolve(target)),
  );

  for (const root of desiredSkillRoots(desired.values(), input.skillsRoot, input.pathIsWithin)) {
    if (!existsSync(root)) continue;
    const unknown = inventoryManagedSkillFiles(root, input.conflict).find(
      (target) => !allowed.has(target),
    );
    if (unknown) {
      return input.conflict(
        `Refusing to install into a Codex skill tree containing unknown file ${unknown}.`,
        'The unknown file was preserved. Move it aside or explicitly reconcile it before rerunning setup.',
      );
    }
  }

  for (const file of input.existing) {
    if (!existsSync(file.target)) continue;
    const current = input.ownershipHash(readFileSync(file.target), file.kind, file.marker);
    if (current !== file.hash && !isKnownStaleSkill(file.target, current)) {
      return input.conflict(
        `Refusing to replace modified global Codex bundle content at ${file.target}.`,
        'Preserve the modified file, restore the last managed bytes, or choose a separate skill home.',
      );
    }
  }
  for (const action of desired.values()) {
    if (!existsSync(action.target) || tracked.has(action.target)) continue;
    const current = input.hash(readFileSync(action.target));
    const expected = input.hash(input.actionBytes(action));
    if (current !== expected && !isKnownStaleSkill(action.target, current)) {
      return input.conflict(
        `Refusing to overwrite unknown Codex skill bytes at ${action.target}.`,
        'Move the unknown file aside or explicitly reconcile it before rerunning setup.',
      );
    }
  }
  return { retired: input.existing.filter((file) => !desired.has(file.target)) };
}
