/**
 * Ship-equivalent prechecks (pure Node, stdlib-only) for SPEC-007 orchestration tests.
 * Mirrors `.cursor/rules/planr-pipeline-ship.mdc` §1b stories/tasks requirements in spec-driven mode.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const US_FILE = /^US-.*\.md$/i;

/** @returns {boolean} */
export function isSpecDrivenWorkspace(projectRoot) {
  try {
    const p = join(projectRoot, '.planr', 'config.json');
    if (!existsSync(p)) return false;
    const cfg = JSON.parse(readFileSync(p, 'utf-8'));
    const specPrefix = cfg?.idPrefix?.spec;
    return typeof specPrefix === 'string' && specPrefix.trim().length > 0;
  } catch {
    return false;
  }
}

/** Lexicographically first subdirectory of `.planr/specs/` matching `^[A-Z]+-\\d{3}-${slug}$`. */
export function resolveSpecDirectoryForSlug(projectRoot, slug) {
  const root = join(projectRoot, '.planr', 'specs');
  if (!existsSync(root)) return null;
  const slugRePart = slug.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
  const re = new RegExp(`^[A-Z]+-\\d{3}-${slugRePart}$`);
  const dirs = readdirSync(root).filter((name) => {
    try {
      return statSync(join(root, name)).isDirectory() && re.test(name);
    } catch {
      return false;
    }
  });
  if (dirs.length === 0) return null;
  dirs.sort();
  return join(root, dirs[0]);
}

export function listUserStoryFiles(specDir) {
  const stories = join(specDir, 'stories');
  if (!existsSync(stories)) return [];
  return readdirSync(stories).filter((f) => US_FILE.test(f));
}

export function listTaskFiles(specDir) {
  const tasks = join(specDir, 'tasks');
  if (!existsSync(tasks)) return [];
  return readdirSync(tasks).filter(
    (f) => /^T-.*\.md$/i.test(f) && !/error-report\.md$/i.test(f),
  );
}

/**
 * R1-style gate: block ship when PO decomposition (user stories) is missing.
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
export function assertShipStoriesReady(projectRoot, slug) {
  if (!isSpecDrivenWorkspace(projectRoot)) {
    return {
      ok: false,
      code: 'NOT_SPEC_DRIVEN',
      message: 'Spec-driven workspace not detected (.planr/config.json + idPrefix.spec).',
    };
  }
  const specDir = resolveSpecDirectoryForSlug(projectRoot, slug);
  if (!specDir) {
    return {
      ok: false,
      code: 'SPEC_DIR_MISSING',
      message: `No spec directory under .planr/specs/ matches slug "${slug}" for this workspace.`,
    };
  }
  const storiesPath = join(specDir, 'stories');
  if (!existsSync(storiesPath)) {
    return {
      ok: false,
      code: 'R1_MISSING_STORIES_DIR',
      message:
        `Missing PO decomposition output: <SPEC_DIR>/stories/ absent (${storiesPath}). Human review gate (R1) requires ≥1 US-*.md under stories/.`,
    };
  }
  const stories = listUserStoryFiles(specDir);
  if (stories.length === 0) {
    return {
      ok: false,
      code: 'R1_MISSING_USER_STORIES',
      message:
        `Missing PO decomposition output: stories/ exists but contains no US-*.md files under ${storiesPath}.`,
    };
  }
  return { ok: true, specDir, storyFiles: stories };
}

/**
 * Broader `/ship` Step 1b check (spec-driven): stories + tasks + stack.md — no LLMs.
 * @returns {{ ok: true, specDir: string } | { ok: false, code: string, message: string }}
 */
export function assertSpecDrivenShipInputs(projectRoot, slug) {
  const storiesGate = assertShipStoriesReady(projectRoot, slug);
  if (!storiesGate.ok) return storiesGate;
  const { specDir } = storiesGate;
  const tasks = listTaskFiles(specDir);
  if (tasks.length === 0) {
    return {
      ok: false,
      code: 'MISSING_TASKS',
      message: `Ship requires ≥1 tasks/T-*.md under ${join(specDir, 'tasks')} (excluding *error-report*.md).`,
    };
  }
  const stack = join(projectRoot, 'input', 'tech', 'stack.md');
  if (!existsSync(stack)) {
    return {
      ok: false,
      code: 'MISSING_STACK',
      message: `Ship requires input/tech/stack.md at project root (missing: ${stack}).`,
    };
  }
  return { ok: true, specDir };
}

/**
 * Read-only `/plan --dry-run` style preview: loads config + resolves paths; MUST NOT write.
 * @returns {{ mode: 'spec-driven', specDir: string, slug: string }}
 */
export function planDryRunReadOnlyInspect(projectRoot, slug) {
  if (!isSpecDrivenWorkspace(projectRoot)) {
    throw new Error('Dry-run inspect: workspace is not spec-driven.');
  }
  const specDir = resolveSpecDirectoryForSlug(projectRoot, slug);
  if (!specDir) {
    throw new Error(`Dry-run inspect: unresolved spec dir for slug "${slug}".`);
  }
  assertShipStoriesReady(projectRoot, slug);
  const tasks = listTaskFiles(specDir);
  if (tasks.length === 0) {
    throw new Error('Dry-run inspect: expected ≥1 ordinary task markdown file.');
  }
  const stack = join(projectRoot, 'input', 'tech', 'stack.md');
  if (!existsSync(stack)) {
    throw new Error('Dry-run inspect: input/tech/stack.md missing.');
  }
  return { mode: 'spec-driven', specDir, slug };
}
