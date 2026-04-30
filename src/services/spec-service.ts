/**
 * spec-service — directory-aware CRUD for spec-driven planning mode.
 *
 * Unlike agile/QT artifacts which are flat single files, each spec is a
 * **self-contained directory** (per BL-011 addendum + design doc):
 *
 *   .planr/specs/SPEC-NNN-{slug}/
 *   ├── SPEC-NNN-{slug}.md              ← the spec document
 *   ├── design/                         ← UI mockups + design-spec.md (if any)
 *   │   ├── *.png
 *   │   └── design-spec.md              ← reserved path (written by planr-pipeline's designer-agent)
 *   ├── stories/
 *   │   └── US-NNN-{slug}.md            ← US-NNN scoped to this spec
 *   └── tasks/
 *       └── T-NNN-{slug}.md             ← T-NNN scoped to this spec
 *
 * Why directory-per-spec:
 *  - Self-contained / portable / `rm -rf` clean
 *  - `PREFIX-NNN-slug` naming consistent with every other planr artifact
 *  - US-NNN and T-NNN are SCOPED TO THE PARENT SPEC (not project-globally
 *    unique). Two specs can each have their own US-001. Disambiguation is
 *    via the path or via `specId` frontmatter.
 *  - Schema matches planr-pipeline plugin verbatim — both products
 *    share one contract. See https://github.com/openplanr/planr-pipeline
 *
 * This service owns spec authoring inside the planr CLI. The
 * planr-pipeline plugin is the executor: it reads `.planr/specs/` (when
 * spec mode is active) and runs the PO/DEV phases to ship code.
 */

import path from 'node:path';
import type { OpenPlanrConfig } from '../models/types.js';
import { ensureDir, fileExists, listFiles, readFile, writeFile } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import { parseMarkdown } from '../utils/markdown.js';
import { slugify } from '../utils/slugify.js';
import { atomicWriteFile } from './atomic-write-service.js';
import { getNextId } from './id-service.js';
import { renderTemplate } from './template-service.js';

// ---------------------------------------------------------------------------
// Path resolvers
// ---------------------------------------------------------------------------

/** Root directory holding all specs (e.g., `.planr/specs/`). */
export function getSpecsRootDir(projectDir: string, config: OpenPlanrConfig): string {
  return path.join(projectDir, config.outputPaths.agile, 'specs');
}

/** Self-contained directory for a single spec, e.g. `.planr/specs/SPEC-001-auth-flow/`. */
export function getSpecDir(
  projectDir: string,
  config: OpenPlanrConfig,
  specId: string,
  slug: string,
): string {
  return path.join(getSpecsRootDir(projectDir, config), `${specId}-${slug}`);
}

/** Stories subdirectory inside a spec. */
export function getSpecStoriesDir(specDir: string): string {
  return path.join(specDir, 'stories');
}

/** Tasks subdirectory inside a spec. */
export function getSpecTasksDir(specDir: string): string {
  return path.join(specDir, 'tasks');
}

/** Design assets subdirectory inside a spec (PNGs + design-spec.md). */
export function getSpecDesignDir(specDir: string): string {
  return path.join(specDir, 'design');
}

// ---------------------------------------------------------------------------
// Spec resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a spec ID (e.g. `SPEC-001`) to its on-disk directory by scanning
 * `.planr/specs/` for a matching `SPEC-NNN-{slug}` directory. Returns null
 * if the spec isn't found.
 *
 * The directory name encodes both ID and slug, so we don't need to read the
 * spec file to find it.
 */
export async function resolveSpecDir(
  projectDir: string,
  config: OpenPlanrConfig,
  specId: string,
): Promise<{ dir: string; slug: string } | null> {
  const specsRoot = getSpecsRootDir(projectDir, config);
  const exists = await fileExists(specsRoot);
  if (!exists) return null;

  const fs = await import('node:fs/promises');
  const entries = await fs.readdir(specsRoot, { withFileTypes: true });
  const escapedId = specId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escapedId}-(.+)$`);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const m = entry.name.match(re);
    if (m) {
      return { dir: path.join(specsRoot, entry.name), slug: m[1] };
    }
  }
  return null;
}

/** Spec metadata returned by listSpecs. */
export interface SpecListing {
  id: string;
  slug: string;
  title: string;
  status: string;
  dirName: string;
  storyCount: number;
  taskCount: number;
}

/**
 * List every spec under `.planr/specs/`.
 * Reads each spec's frontmatter for title + status; counts stories + tasks.
 */
export async function listSpecs(
  projectDir: string,
  config: OpenPlanrConfig,
): Promise<SpecListing[]> {
  const specsRoot = getSpecsRootDir(projectDir, config);
  const exists = await fileExists(specsRoot);
  if (!exists) return [];

  const fs = await import('node:fs/promises');
  const entries = await fs.readdir(specsRoot, { withFileTypes: true });
  const dirRegex = /^([A-Z]+-\d{3})-(.+)$/;
  const results: SpecListing[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const m = entry.name.match(dirRegex);
    if (!m) continue;
    const [, id, slug] = m;
    const specDir = path.join(specsRoot, entry.name);
    const specFile = path.join(specDir, `${id}-${slug}.md`);
    const specFileExists = await fileExists(specFile);
    if (!specFileExists) continue;

    let title = slug.replace(/-/g, ' ');
    let status = 'pending';
    try {
      const raw = await readFile(specFile);
      const parsed = parseMarkdown(raw);
      if (typeof parsed.data.title === 'string') title = parsed.data.title;
      if (typeof parsed.data.status === 'string') status = parsed.data.status;
    } catch (err) {
      logger.debug(`Failed to parse spec ${id} frontmatter: ${(err as Error).message}`);
    }

    const stories = await listSpecStories(specDir);
    const tasks = await listSpecTasks(specDir);

    results.push({
      id,
      slug,
      title,
      status,
      dirName: entry.name,
      storyCount: stories.length,
      taskCount: tasks.length,
    });
  }

  return results.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Spec creation
// ---------------------------------------------------------------------------

export interface CreateSpecOptions {
  /** Optional explicit slug (kebab-case). If omitted, derived from title. */
  slug?: string;
  /** Priority (P0 / P1 / P2). Defaults to P1. */
  priority?: string;
  /** Milestone string (e.g., `v1.0`). */
  milestone?: string;
  /** Author handle. */
  po?: string;
}

/**
 * Create a new spec directory + spec file from the template.
 * Returns the assigned ID and the absolute file path of the spec markdown.
 *
 * Refuses if a directory with the same slug already exists, to avoid
 * accidental overwrites.
 */
export async function createSpec(
  projectDir: string,
  config: OpenPlanrConfig,
  title: string,
  options: CreateSpecOptions = {},
): Promise<{ id: string; slug: string; specDir: string; specFile: string }> {
  const slug = options.slug ? slugify(options.slug) : slugify(title);
  if (!slug) {
    throw new Error('Could not derive a slug from the title. Provide --slug explicitly.');
  }

  const specsRoot = getSpecsRootDir(projectDir, config);
  await ensureDir(specsRoot);

  // Cross-spec slug-collision check. Two specs with the same slug would be
  // ambiguous in pipeline handoffs (`/planr-pipeline:plan {slug}` —
  // which spec?), and they'd be hard to distinguish in `planr spec list`.
  // Refuse early with a clear suggestion.
  {
    const fs = await import('node:fs/promises');
    let entries: import('node:fs').Dirent[] = [];
    try {
      entries = await fs.readdir(specsRoot, { withFileTypes: true });
    } catch {
      // specs/ may not exist yet — fine
    }
    const slugRe = new RegExp(`^[A-Z]+-\\d{3}-${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    const collision = entries.find((e) => e.isDirectory() && slugRe.test(e.name));
    if (collision) {
      throw new Error(
        `A spec with slug "${slug}" already exists at ${collision.name}. Use a different --slug or delete the existing spec with \`planr spec destroy ${collision.name.split('-').slice(0, 2).join('-')}\`.`,
      );
    }
  }

  const prefix = config.idPrefix.spec || 'SPEC';
  // Custom-scan: getNextId() looks for files; here we look at *directories*.
  // We compose a synthetic "files-only" view by listing entries with the prefix.
  const id = await nextSpecId(specsRoot, prefix);
  const dirName = `${id}-${slug}`;
  const specDir = path.join(specsRoot, dirName);

  if (await fileExists(specDir)) {
    throw new Error(
      `Spec directory ${dirName} already exists. Use a different --slug or delete the existing spec with \`planr spec destroy ${id}\`.`,
    );
  }

  await ensureDir(specDir);
  await ensureDir(getSpecStoriesDir(specDir));
  await ensureDir(getSpecTasksDir(specDir));
  await ensureDir(getSpecDesignDir(specDir));

  const specFile = path.join(specDir, `${id}-${slug}.md`);
  const today = new Date().toISOString().split('T')[0];
  const content = await renderTemplate(
    'spec/spec.md.hbs',
    {
      id,
      slug,
      title,
      status: 'pending',
      schemaVersion: '1.0.0',
      priority: options.priority || 'P1',
      milestone: options.milestone || '',
      po: options.po || '',
      date: today,
      projectName: config.projectName,
    },
    config.templateOverrides,
  );
  await writeFile(specFile, content);

  // Drop a .gitkeep into design/ so the empty subdir survives commits
  // (stories/ and tasks/ will be populated by `planr spec decompose` later).
  await writeFile(path.join(getSpecDesignDir(specDir), '.gitkeep'), '');

  logger.debug(`Created spec ${id}: ${specDir}`);
  return { id, slug, specDir, specFile };
}

/**
 * Pick the next available SPEC ID by scanning sibling directories under
 * `.planr/specs/`. Mirrors `id-service.getNextId()` but for directories.
 */
async function nextSpecId(specsRoot: string, prefix: string): Promise<string> {
  const fs = await import('node:fs/promises');
  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = await fs.readdir(specsRoot, { withFileTypes: true });
  } catch {
    return `${prefix}-001`;
  }
  const re = new RegExp(`^${prefix}-(\\d{3})-`);
  const taken = new Set<number>();
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const m = e.name.match(re);
    if (m) taken.add(Number.parseInt(m[1], 10));
  }
  let n = 1;
  while (taken.has(n)) n++;
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Spec read / update / destroy
// ---------------------------------------------------------------------------

export interface SpecArtifact {
  id: string;
  slug: string;
  specDir: string;
  specFile: string;
  data: Record<string, unknown>;
  content: string;
}

export async function readSpec(
  projectDir: string,
  config: OpenPlanrConfig,
  specId: string,
): Promise<SpecArtifact | null> {
  const resolved = await resolveSpecDir(projectDir, config, specId);
  if (!resolved) return null;
  const { dir: specDir, slug } = resolved;
  const specFile = path.join(specDir, `${specId}-${slug}.md`);
  const specFileExists = await fileExists(specFile);
  if (!specFileExists) return null;

  const raw = await readFile(specFile);
  try {
    const parsed = parseMarkdown(raw);
    return { id: specId, slug, specDir, specFile, data: parsed.data, content: parsed.content };
  } catch (err) {
    logger.warn(
      `Skipping spec ${specId}: frontmatter parse error.\n  ${specFile}\n  ${(err as Error).message}`,
    );
    return null;
  }
}

/** Overwrite the spec markdown file in place. Atomic. */
export async function updateSpec(
  projectDir: string,
  config: OpenPlanrConfig,
  specId: string,
  content: string,
): Promise<void> {
  const resolved = await resolveSpecDir(projectDir, config, specId);
  if (!resolved) throw new Error(`Spec ${specId} not found.`);
  const specFile = path.join(resolved.dir, `${specId}-${resolved.slug}.md`);
  await atomicWriteFile(specFile, content);
}

/**
 * Surgical YAML frontmatter update for a spec.
 * Mirrors artifact-service.updateArtifactFields shape.
 */
export async function updateSpecFields(
  projectDir: string,
  config: OpenPlanrConfig,
  specId: string,
  fields: Partial<Record<string, unknown>>,
): Promise<void> {
  const resolved = await resolveSpecDir(projectDir, config, specId);
  if (!resolved) throw new Error(`Spec ${specId} not found.`);
  const specFile = path.join(resolved.dir, `${specId}-${resolved.slug}.md`);
  const raw = await readFile(specFile);
  const today = new Date().toISOString().split('T')[0];
  const allFields = { ...fields, updated: today };

  const openIdx = raw.indexOf('---');
  const closeIdx = raw.indexOf('\n---', openIdx + 3);
  if (openIdx === -1 || closeIdx === -1) {
    throw new Error(`Spec ${specId} has no valid frontmatter.`);
  }
  let frontmatter = raw.slice(openIdx, closeIdx);
  const body = raw.slice(closeIdx);

  for (const [key, value] of Object.entries(allFields)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedKey}:\\s*.*$`, 'm');
    const replacement = `${key}: ${formatYamlValue(value)}`;
    if (pattern.test(frontmatter)) {
      frontmatter = frontmatter.replace(pattern, () => replacement);
    } else {
      frontmatter += `\n${replacement}`;
    }
  }
  await atomicWriteFile(specFile, frontmatter + body);
}

/**
 * Format a JS value as valid YAML for frontmatter.
 * - Arrays → inline-flow: `["a", "b"]` (so they round-trip as arrays, not strings)
 * - Empty arrays → `[]`
 * - Other → double-quoted scalar with escapes
 */
function formatYamlValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    return `[${items.join(', ')}]`;
  }
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// ---------------------------------------------------------------------------
// Sync — orphaned-artifact detection + integrity repair
// ---------------------------------------------------------------------------

export interface SyncSpecReport {
  specId: string;
  specSlug: string;
  /** Issues that were auto-repaired (file was rewritten). */
  fixed: string[];
  /** Issues that need human attention (orphans, schema drift, etc.). */
  warnings: string[];
}

/**
 * Validate one spec's internal integrity and repair safe inconsistencies.
 *
 * Checks performed:
 *  1. Orphaned task: `task.storyId` doesn't match any existing US in the same
 *     spec → WARN (don't auto-delete; user reviews and either fixes the
 *     storyId or destroys the task)
 *  2. Story without tasks: WARN (decomposition is incomplete)
 *  3. Missing `specId` in US/Task frontmatter → AUTO-FIX from path
 *  4. Schema version mismatch (artifact's schemaVersion older than current)
 *     → WARN (no auto-migration in v1; flagged for follow-up)
 *
 * Note: this is a *read-mostly* operation. The only writes happen in case 3
 * (adding a missing `specId` field via updateSpecFields-equivalent); all
 * other findings are reported as warnings so the user controls the fix.
 *
 * `dryRun: true` skips writes entirely; only report.
 */
export async function syncSpec(
  projectDir: string,
  config: OpenPlanrConfig,
  specId: string,
  opts: { dryRun?: boolean } = {},
): Promise<SyncSpecReport> {
  const spec = await readSpec(projectDir, config, specId);
  if (!spec) throw new Error(`Spec ${specId} not found.`);

  const fixed: string[] = [];
  const warnings: string[] = [];
  const stories = await listSpecStories(spec.specDir);
  const tasks = await listSpecTasks(spec.specDir);

  // ── Check 1: orphaned tasks ────────────────────────────────────────────
  const storyIds = new Set(stories.map((s) => s.id));
  for (const t of tasks) {
    if (!t.storyId) {
      warnings.push(
        `Task ${t.id} (${t.filename}) has no storyId — set it manually or via \`planr spec decompose --force\`.`,
      );
    } else if (!storyIds.has(t.storyId)) {
      warnings.push(
        `Task ${t.id} (${t.filename}) references non-existent story ${t.storyId} in this spec. ` +
          `Fix the storyId or destroy the task.`,
      );
    }
  }

  // ── Check 2: stories without tasks ────────────────────────────────────
  const tasksByStory = new Map<string, number>();
  for (const t of tasks) {
    if (t.storyId) tasksByStory.set(t.storyId, (tasksByStory.get(t.storyId) ?? 0) + 1);
  }
  for (const s of stories) {
    if (!tasksByStory.has(s.id)) {
      warnings.push(
        `Story ${s.id} has no tasks — decomposition incomplete. Run \`planr spec decompose ${specId} --force\` or hand-author tasks.`,
      );
    }
  }

  // ── Check 3: missing specId in US/Task frontmatter ────────────────────
  // (auto-fixable; fix from path)
  const fs = await import('node:fs/promises');
  for (const s of stories) {
    const raw = await readFile(s.filePath);
    if (!/^specId:\s*"/m.test(raw)) {
      if (!opts.dryRun) {
        const insertion = `\nspecId: "${specId}"`;
        const fixedContent = raw.replace(/^id:\s*"[^"]+"$/m, (m) => m + insertion);
        await fs.writeFile(s.filePath, fixedContent);
      }
      fixed.push(
        `Story ${s.id}: added missing specId frontmatter${opts.dryRun ? ' [dry-run]' : ''}.`,
      );
    }
  }
  for (const t of tasks) {
    const raw = await readFile(t.filePath);
    if (!/^specId:\s*"/m.test(raw)) {
      if (!opts.dryRun) {
        const insertion = `\nspecId: "${specId}"`;
        const fixedContent = raw.replace(/^id:\s*"[^"]+"$/m, (m) => m + insertion);
        await fs.writeFile(t.filePath, fixedContent);
      }
      fixed.push(
        `Task ${t.id}: added missing specId frontmatter${opts.dryRun ? ' [dry-run]' : ''}.`,
      );
    }
  }

  // ── Check 4: schema version drift ─────────────────────────────────────
  const CURRENT_SCHEMA_VERSION = '1.0.0';
  const specSchemaVersion =
    typeof spec.data.schemaVersion === 'string' ? spec.data.schemaVersion : null;
  if (specSchemaVersion && specSchemaVersion !== CURRENT_SCHEMA_VERSION) {
    warnings.push(
      `Spec uses schemaVersion ${specSchemaVersion} (current: ${CURRENT_SCHEMA_VERSION}). No auto-migration in v1 — review manually.`,
    );
  }

  return {
    specId: spec.id,
    specSlug: spec.slug,
    fixed,
    warnings,
  };
}

/**
 * Run syncSpec across every spec in the project.
 * Aggregates per-spec reports.
 */
export async function syncAllSpecs(
  projectDir: string,
  config: OpenPlanrConfig,
  opts: { dryRun?: boolean } = {},
): Promise<{
  specsScanned: number;
  reports: SyncSpecReport[];
}> {
  const specs = await listSpecs(projectDir, config);
  const reports: SyncSpecReport[] = [];
  for (const s of specs) {
    reports.push(await syncSpec(projectDir, config, s.id, opts));
  }
  return { specsScanned: specs.length, reports };
}

// ---------------------------------------------------------------------------
// Decompose — AI-driven US + Task generation
// ---------------------------------------------------------------------------

export interface DecomposeSpecOptions {
  /** When true, overwrite existing US/Task files. Default false. */
  force?: boolean;
  /**
   * When true, skip the codebase scanner. Faster but generated tasks
   * reference generic paths the user must edit afterwards.
   */
  noCodeContext?: boolean;
  /** Cap the number of stories the AI emits (1-8, default 6 from prompt). */
  maxStories?: number;
}

export interface DecomposeSpecResult {
  storiesCreated: number;
  tasksCreated: number;
  decompositionNotes: string;
}

/**
 * Decompose a SPEC into User Stories + Tasks via AI.
 *
 * High-level flow:
 *   1. Read the spec; refuse if stories/ or tasks/ already populated
 *      (unless `opts.force === true`)
 *   2. Read `input/tech/stack.md` (best-effort; passed as a hint to the AI)
 *   3. Build codebase context via planr's existing scanner (skipped if
 *      `opts.noCodeContext === true`)
 *   4. Build prompt + call AI provider via `generateStreamingJSON`
 *   5. Validate the response with `aiSpecDecomposeResponseSchema`
 *   6. Write each US via `createSpecStory` and each Task via `createSpecTask`
 *   7. Update SPEC frontmatter status: pending|shaping → decomposing → decomposed
 */
export async function decomposeSpec(
  projectDir: string,
  config: OpenPlanrConfig,
  specId: string,
  opts: DecomposeSpecOptions = {},
): Promise<DecomposeSpecResult> {
  const spec = await readSpec(projectDir, config, specId);
  if (!spec) throw new Error(`Spec ${specId} not found.`);

  // ── Guard: refuse to overwrite existing decomposition ─────────────────
  const existingStories = await listSpecStories(spec.specDir);
  const existingTasks = await listSpecTasks(spec.specDir);
  if ((existingStories.length > 0 || existingTasks.length > 0) && !opts.force) {
    throw new Error(
      `Spec ${specId} already has ${existingStories.length} stor${
        existingStories.length === 1 ? 'y' : 'ies'
      } and ${existingTasks.length} task${existingTasks.length === 1 ? '' : 's'}. ` +
        `Pass --force to overwrite, or \`planr spec destroy ${specId}\` to start fresh.`,
    );
  }
  // If forcing, wipe existing US + Task files BEFORE the AI call so a failed
  // decomposition doesn't leave a half-overwritten tree.
  if (opts.force && (existingStories.length > 0 || existingTasks.length > 0)) {
    const fs = await import('node:fs/promises');
    for (const s of existingStories) await fs.rm(s.filePath, { force: true });
    for (const t of existingTasks) await fs.rm(t.filePath, { force: true });
  }

  // ── Determine PNG presence (drives 1-vs-2 tasks per US per rules.md R2) ─
  const uiFilesData = spec.data.ui_files;
  const hasPNGs = Array.isArray(uiFilesData) && uiFilesData.length > 0;

  // ── Read stack.md (best-effort) ───────────────────────────────────────
  let stackInfo: string | undefined;
  try {
    const stackPath = path.join(projectDir, 'input/tech/stack.md');
    if (await fileExists(stackPath)) {
      stackInfo = await readFile(stackPath);
    }
  } catch {
    // best-effort
  }

  // ── Build codebase context (lazy import keeps startup fast) ───────────
  let codebaseContext: string | undefined;
  if (!opts.noCodeContext) {
    try {
      const { buildCodebaseContext, extractKeywords, formatCodebaseContext } = await import(
        '../ai/codebase/index.js'
      );
      const keywordSource = `${typeof spec.data.title === 'string' ? spec.data.title : ''}\n${spec.content}`;
      const keywords = extractKeywords(keywordSource);
      const ctx = await buildCodebaseContext(projectDir, keywords);
      codebaseContext = formatCodebaseContext(ctx);
      const stackHint = ctx.techStack
        ? ` — ${ctx.techStack.language}${ctx.techStack.framework ? ` + ${ctx.techStack.framework}` : ''}`
        : '';
      logger.dim(`  Scanned codebase${stackHint}`);
    } catch (err) {
      logger.debug('Codebase scanning failed during spec decompose', err);
    }
  }

  // ── Update status to "decomposing" so observers see in-progress state ─
  await updateSpecFields(projectDir, config, specId, { status: 'decomposing' });

  // ── Call AI (lazy imports — keep heavy deps off startup path) ─────────
  const { buildSpecDecomposePrompt } = await import('../ai/prompts/prompt-builder.js');
  const { aiSpecDecomposeResponseSchema } = await import('../ai/schemas/ai-response-schemas.js');
  const { generateStreamingJSON, getAIProvider } = await import('./ai-service.js');
  const { TOKEN_BUDGETS } = await import('../ai/types.js');

  const provider = await getAIProvider(config);
  const messages = buildSpecDecomposePrompt(
    spec.content,
    hasPNGs,
    stackInfo,
    codebaseContext,
    opts.maxStories,
  );
  const { result } = await generateStreamingJSON(
    provider,
    messages,
    aiSpecDecomposeResponseSchema,
    { maxTokens: TOKEN_BUDGETS.taskFeature },
  );

  // ── Persist stories + tasks ────────────────────────────────────────────
  let storiesCreated = 0;
  let tasksCreated = 0;
  for (const aiStory of result.stories) {
    const created = await createSpecStory(projectDir, config, specId, aiStory.title, {
      roleAction: aiStory.roleAction,
      benefit: aiStory.benefit,
      scope: aiStory.scope,
      acceptanceCriteria: aiStory.acceptanceCriteria,
    });
    storiesCreated++;

    for (const aiTask of aiStory.tasks) {
      await createSpecTask(projectDir, config, specId, {
        storyId: created.id,
        title: aiTask.title,
        type: aiTask.type,
        agent: aiTask.agent,
        filesCreate: aiTask.filesCreate,
        filesModify: aiTask.filesModify,
        filesPreserve: aiTask.filesPreserve,
        objective: aiTask.objective,
        technicalSpec: aiTask.technicalSpec,
        testRequirements: aiTask.testRequirements,
      });
      tasksCreated++;
    }
  }

  // ── Final status: decomposed ──────────────────────────────────────────
  await updateSpecFields(projectDir, config, specId, { status: 'decomposed' });

  logger.debug(`Decomposed ${specId}: ${storiesCreated} stories, ${tasksCreated} tasks written`);

  return {
    storiesCreated,
    tasksCreated,
    decompositionNotes: result.decompositionNotes,
  };
}

// ---------------------------------------------------------------------------
// Shape — guided 4-question SPEC body authoring
// ---------------------------------------------------------------------------

/**
 * Answers gathered by `planr spec shape` from the PO.
 *
 * The shape command captures four areas: business context, functional
 * requirements, business rules / constraints, and acceptance criteria.
 * `decompositionNotes` is optional — hints for `planr spec decompose` later.
 */
export interface ShapeSpecAnswers {
  context: string;
  functionalRequirements: string[];
  businessRules?: string;
  outOfScope?: string[];
  acceptanceCriteria: string[];
  decompositionNotes?: string;
}

/**
 * Re-render the SPEC body from a structured set of answers and write it back
 * atomically. Preserves frontmatter values that the user (or `planr spec
 * create`) already set: priority, milestone, po, ui_files, created, etc.
 *
 * Updates `status` to `shaping` so subsequent commands (`decompose`, `promote`)
 * can see the spec has moved past the initial empty placeholder body.
 */
export async function shapeSpec(
  projectDir: string,
  config: OpenPlanrConfig,
  specId: string,
  answers: ShapeSpecAnswers,
): Promise<{ specFile: string }> {
  const spec = await readSpec(projectDir, config, specId);
  if (!spec) throw new Error(`Spec ${specId} not found.`);

  const today = new Date().toISOString().split('T')[0];

  // Carry through every frontmatter field that was already set, so we don't
  // accidentally erase user customizations on re-shape.
  const data = spec.data;
  const uiFilesRaw = data.ui_files;
  let uiFiles: string[] = [];
  if (Array.isArray(uiFilesRaw)) {
    uiFiles = uiFilesRaw.filter((f): f is string => typeof f === 'string');
  }

  const content = await renderTemplate(
    'spec/spec-shaped.md.hbs',
    {
      id: spec.id,
      slug: spec.slug,
      title: typeof data.title === 'string' ? data.title : spec.slug,
      schemaVersion: typeof data.schemaVersion === 'string' ? data.schemaVersion : '1.0.0',
      priority: typeof data.priority === 'string' ? data.priority : 'P1',
      milestone: typeof data.milestone === 'string' ? data.milestone : '',
      po: typeof data.po === 'string' ? data.po : '',
      created: typeof data.created === 'string' ? data.created : today,
      date: today,
      uiFiles,
      context: answers.context.trim(),
      functionalRequirements: answers.functionalRequirements.map((s) => s.trim()).filter(Boolean),
      businessRules: (answers.businessRules || '').trim(),
      outOfScope: (answers.outOfScope || []).map((s) => s.trim()).filter(Boolean),
      acceptanceCriteria: answers.acceptanceCriteria.map((s) => s.trim()).filter(Boolean),
      decompositionNotes: (answers.decompositionNotes || '').trim(),
      projectName: config.projectName,
    },
    config.templateOverrides,
  );

  await atomicWriteFile(spec.specFile, content);
  logger.debug(`Shaped spec ${spec.id} (status: shaping)`);
  return { specFile: spec.specFile };
}

/**
 * Destroy a spec directory. Self-contained = single `rm -rf` of the
 * spec's own directory. Stories and tasks are removed atomically with the
 * spec. No cross-spec references to clean up.
 */
export async function destroySpec(
  projectDir: string,
  config: OpenPlanrConfig,
  specId: string,
): Promise<void> {
  const resolved = await resolveSpecDir(projectDir, config, specId);
  if (!resolved) throw new Error(`Spec ${specId} not found.`);
  const fs = await import('node:fs/promises');
  await fs.rm(resolved.dir, { recursive: true, force: true });
  logger.debug(`Destroyed spec ${specId}: ${resolved.dir}`);
}

// ---------------------------------------------------------------------------
// Stories (US-NNN scoped to a spec)
// ---------------------------------------------------------------------------

export interface SpecStoryListing {
  id: string;
  slug: string;
  title: string;
  status: string;
  filename: string;
  filePath: string;
}

/**
 * List US-NNN files inside a spec's stories/ subdirectory.
 * Returns IDs scoped to this spec — two specs can each have US-001.
 */
export async function listSpecStories(specDir: string): Promise<SpecStoryListing[]> {
  const storiesDir = getSpecStoriesDir(specDir);
  const exists = await fileExists(storiesDir);
  if (!exists) return [];

  const files = await listFiles(storiesDir, /^US-\d{3}-.+\.md$/);
  const out: SpecStoryListing[] = [];
  for (const filename of files.sort()) {
    const m = filename.match(/^(US-\d{3})-(.+)\.md$/);
    if (!m) continue;
    const [, id, slug] = m;
    let title = slug.replace(/-/g, ' ');
    let status = 'pending';
    try {
      const raw = await readFile(path.join(storiesDir, filename));
      const parsed = parseMarkdown(raw);
      if (typeof parsed.data.title === 'string') title = parsed.data.title;
      if (typeof parsed.data.status === 'string') status = parsed.data.status;
    } catch {
      // Best-effort; preserve listing even if frontmatter is malformed.
    }
    out.push({ id, slug, title, status, filename, filePath: path.join(storiesDir, filename) });
  }
  return out;
}

/** Append a US-NNN-{slug}.md file under the spec's stories/ directory. */
export async function createSpecStory(
  projectDir: string,
  config: OpenPlanrConfig,
  specId: string,
  title: string,
  body: { roleAction: string; benefit: string; scope?: string; acceptanceCriteria?: string[] },
): Promise<{ id: string; slug: string; filePath: string }> {
  const resolved = await resolveSpecDir(projectDir, config, specId);
  if (!resolved) throw new Error(`Spec ${specId} not found.`);

  const storiesDir = getSpecStoriesDir(resolved.dir);
  await ensureDir(storiesDir);

  const slug = slugify(title);
  const prefix = config.idPrefix.story || 'US';
  const id = await getNextId(storiesDir, prefix);
  const filename = `${id}-${slug}.md`;
  const filePath = path.join(storiesDir, filename);
  const today = new Date().toISOString().split('T')[0];

  const content = await renderTemplate(
    'spec/story.md.hbs',
    {
      id,
      slug,
      title,
      specId,
      schemaVersion: '1.0.0',
      status: 'pending',
      date: today,
      roleAction: body.roleAction,
      benefit: body.benefit,
      scope: body.scope || '',
      acceptanceCriteria: body.acceptanceCriteria || [],
      projectName: config.projectName,
    },
    config.templateOverrides,
  );
  await writeFile(filePath, content);
  return { id, slug, filePath };
}

// ---------------------------------------------------------------------------
// Tasks (T-NNN scoped to a spec)
// ---------------------------------------------------------------------------

export interface SpecTaskListing {
  id: string;
  slug: string;
  title: string;
  status: string;
  type: string;
  agent: string;
  storyId: string;
  filename: string;
  filePath: string;
}

/**
 * List T-NNN files inside a spec's tasks/ subdirectory.
 */
export async function listSpecTasks(specDir: string): Promise<SpecTaskListing[]> {
  const tasksDir = getSpecTasksDir(specDir);
  const exists = await fileExists(tasksDir);
  if (!exists) return [];

  const files = await listFiles(tasksDir, /^T-\d{3}-.+\.md$/);
  const out: SpecTaskListing[] = [];
  for (const filename of files.sort()) {
    const m = filename.match(/^(T-\d{3})-(.+)\.md$/);
    if (!m) continue;
    const [, id, slug] = m;
    let title = slug.replace(/-/g, ' ');
    let status = 'pending';
    let type = 'Tech';
    let agent = 'backend-agent';
    let storyId = '';
    try {
      const raw = await readFile(path.join(tasksDir, filename));
      const parsed = parseMarkdown(raw);
      if (typeof parsed.data.title === 'string') title = parsed.data.title;
      if (typeof parsed.data.status === 'string') status = parsed.data.status;
      if (typeof parsed.data.type === 'string') type = parsed.data.type;
      if (typeof parsed.data.agent === 'string') agent = parsed.data.agent;
      if (typeof parsed.data.storyId === 'string') storyId = parsed.data.storyId;
    } catch {
      // best-effort
    }
    out.push({
      id,
      slug,
      title,
      status,
      type,
      agent,
      storyId,
      filename,
      filePath: path.join(tasksDir, filename),
    });
  }
  return out;
}

export interface CreateSpecTaskInput {
  storyId: string; // US-NNN this task belongs to
  title: string;
  type: 'UI' | 'Tech';
  agent: string; // free-form: matches planr-pipeline subagent names by default
  filesCreate?: string[];
  filesModify?: string[];
  filesPreserve?: string[];
  objective?: string;
  technicalSpec?: string;
  testRequirements?: string;
}

/** Create a new T-NNN task file under the spec's tasks/ directory. */
export async function createSpecTask(
  projectDir: string,
  config: OpenPlanrConfig,
  specId: string,
  input: CreateSpecTaskInput,
): Promise<{ id: string; slug: string; filePath: string }> {
  const resolved = await resolveSpecDir(projectDir, config, specId);
  if (!resolved) throw new Error(`Spec ${specId} not found.`);

  const tasksDir = getSpecTasksDir(resolved.dir);
  await ensureDir(tasksDir);

  const slug = slugify(input.title);
  // Task ID prefix: 'T' (single letter) by convention in spec mode
  // (vs agile mode's 'TASK'). Matches planr-pipeline schema.
  const id = await getNextId(tasksDir, 'T');
  const filename = `${id}-${slug}.md`;
  const filePath = path.join(tasksDir, filename);
  const today = new Date().toISOString().split('T')[0];

  const content = await renderTemplate(
    'spec/task.md.hbs',
    {
      id,
      slug,
      title: input.title,
      storyId: input.storyId,
      specId,
      schemaVersion: '1.0.0',
      type: input.type,
      agent: input.agent,
      status: 'pending',
      date: today,
      filesCreate: input.filesCreate || [],
      filesModify: input.filesModify || [],
      filesPreserve: input.filesPreserve || [],
      objective: input.objective || '',
      technicalSpec: input.technicalSpec || '',
      testRequirements: input.testRequirements || '',
      projectName: config.projectName,
    },
    config.templateOverrides,
  );
  await writeFile(filePath, content);
  return { id, slug, filePath };
}

// ---------------------------------------------------------------------------
// Design assets
// ---------------------------------------------------------------------------

/**
 * Copy PNG mockup files into a spec's design/ directory. Updates the
 * spec frontmatter `ui_files` to list the copied filenames.
 */
export async function attachSpecDesigns(
  projectDir: string,
  config: OpenPlanrConfig,
  specId: string,
  pngPaths: string[],
): Promise<{ copied: string[]; designDir: string }> {
  const resolved = await resolveSpecDir(projectDir, config, specId);
  if (!resolved) throw new Error(`Spec ${specId} not found.`);

  const designDir = getSpecDesignDir(resolved.dir);
  await ensureDir(designDir);

  const fs = await import('node:fs/promises');
  const copied: string[] = [];
  for (const src of pngPaths) {
    if (!src.toLowerCase().endsWith('.png')) {
      logger.warn(`Skipping non-PNG file: ${src}`);
      continue;
    }
    const exists = await fileExists(src);
    if (!exists) {
      logger.warn(`Source PNG not found: ${src}`);
      continue;
    }
    const filename = path.basename(src);
    const dest = path.join(designDir, filename);
    await fs.copyFile(src, dest);
    copied.push(filename);
  }

  if (copied.length > 0) {
    // Update SPEC frontmatter ui_files (relative paths inside the spec dir).
    // Pass the actual array — updateSpecFields → formatYamlValue serializes
    // it as a YAML inline-flow list so it round-trips back as an array.
    const uiPaths = copied.map((f) => `design/${f}`);
    await updateSpecFields(projectDir, config, specId, { ui_files: uiPaths });
  }

  return { copied, designDir };
}

// ---------------------------------------------------------------------------
// Status / sync helpers
// ---------------------------------------------------------------------------

/**
 * Snapshot of all specs + their decomposition state. Used by `planr spec status`.
 */
export interface SpecStatusReport {
  specCount: number;
  specs: SpecListing[];
  totalStories: number;
  totalTasks: number;
}

export async function getSpecStatus(
  projectDir: string,
  config: OpenPlanrConfig,
): Promise<SpecStatusReport> {
  const specs = await listSpecs(projectDir, config);
  const totalStories = specs.reduce((acc, s) => acc + s.storyCount, 0);
  const totalTasks = specs.reduce((acc, s) => acc + s.taskCount, 0);
  return { specCount: specs.length, specs, totalStories, totalTasks };
}

/**
 * Validate that a spec is ready to hand off to planr-pipeline.
 * Returns the list of issues, or empty array if ready.
 */
export async function validateSpecForPromotion(
  projectDir: string,
  config: OpenPlanrConfig,
  specId: string,
): Promise<{ ready: boolean; issues: string[] }> {
  const issues: string[] = [];
  const spec = await readSpec(projectDir, config, specId);
  if (!spec) {
    return { ready: false, issues: [`Spec ${specId} not found.`] };
  }

  const stories = await listSpecStories(spec.specDir);
  if (stories.length === 0) {
    issues.push(`No User Stories found. Run \`planr spec decompose ${specId}\` first.`);
  }

  const tasks = await listSpecTasks(spec.specDir);
  if (tasks.length === 0) {
    issues.push(`No Tasks found. Run \`planr spec decompose ${specId}\` first.`);
  }

  // Each story should have at least 1 task
  const storyIds = new Set(stories.map((s) => s.id));
  const storiesWithTasks = new Set(tasks.map((t) => t.storyId).filter(Boolean));
  for (const storyId of storyIds) {
    if (!storiesWithTasks.has(storyId)) {
      issues.push(`Story ${storyId} has no tasks. Decomposition incomplete.`);
    }
  }

  // Spec body should be non-trivial (> placeholder)
  if (spec.content.trim().length < 100) {
    issues.push(
      `Spec body is very short (< 100 chars). Run \`planr spec shape ${specId}\` to flesh it out.`,
    );
  }

  return { ready: issues.length === 0, issues };
}
