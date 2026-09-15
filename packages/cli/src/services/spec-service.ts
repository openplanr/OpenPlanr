/**
 * spec-service — directory-aware CRUD for spec-driven planning mode.
 *
 * Unlike agile/QT artifacts which are flat single files, each spec is a
 * **self-contained directory**:
 *
 *   .planr/specs/SPEC-NNN-{slug}/
 *   ├── SPEC-NNN-{slug}.md              ← the spec document
 *   ├── design/                         ← UI mockups + design-spec.md (if any)
 *   │   ├── *.png
 *   │   └── design-spec.md              ← reserved path (written by the host-native designer role)
 *   ├── stories/
 *   │   └── US-NNN-{slug}.md            ← project-global story ID
 *   └── tasks/
 *       └── T-NNN-{slug}.md             ← project-global task ID
 *
 * Why directory-per-spec:
 *  - Self-contained / portable / `rm -rf` clean
 *  - `PREFIX-NNN-slug` naming consistent with every other planr artifact
 *  - SPEC-NNN, US-NNN, and T-NNN IDs are project-global and monotonic. The
 *    sequence never reuses gaps; `specId` and `storyId` retain the hierarchy.
 *  - Schemas are owned by the OpenPlanr Protocol package and shared by all hosts.
 *
 * This service owns dedicated planning inside the planr CLI. The pipeline
 * independently provides feature-local PO planning as part of its complete
 * PO → Design → Review → DEV → QA flow. Both producers share the artifact
 * contract and record provenance so their intentional overlap stays clear.
 */

import { randomUUID } from 'node:crypto';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import type { ArtifactFrontmatter, OpenPlanrConfig } from '../models/types.js';
import { ensureDir, fileExists, listFiles, readFile, writeFile } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import { parseMarkdown, toMarkdownWithFrontmatter } from '../utils/markdown.js';
import { slugify } from '../utils/slugify.js';
import { atomicWriteFile } from './atomic-write-service.js';
import { previewPlanningIds, reservePlanningIds } from './planning-id-service.js';
import { appendOpenPlanrProvenance, readOpenPlanrVersion } from './provenance-service.js';
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
  const dirRegex = /^([A-Z]+-\d{3,})-(.+)$/;
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
  // ambiguous in host-native planning handoffs (`planr-plan {slug}` —
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
    const slugRe = new RegExp(`^[A-Z]+-\\d{3,}-${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    const collision = entries.find((e) => e.isDirectory() && slugRe.test(e.name));
    if (collision) {
      throw new Error(
        `A spec with slug "${slug}" already exists at ${collision.name}. Use a different --slug or delete the existing spec with \`planr spec destroy ${collision.name.split('-').slice(0, 2).join('-')}\`.`,
      );
    }
  }

  const id = (await reservePlanningIds(projectDir, config, { SPEC: 1 })).SPEC[0];
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
      schemaVersion: '1.7.0',
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
  // (stories/ and tasks/ are populated by the host-native planning skill).
  await writeFile(path.join(getSpecDesignDir(specDir), '.gitkeep'), '');

  logger.debug(`Created spec ${id}: ${specDir}`);
  return { id, slug, specDir, specFile };
}

/**
 * Preview the next project-global SPEC ID from sibling directories.
 * Reservation uses planning-id-service so deleted IDs are never reused.
 */
export async function nextSpecId(specsRoot: string, prefix: string): Promise<string> {
  const fs = await import('node:fs/promises');
  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = await fs.readdir(specsRoot, { withFileTypes: true });
  } catch {
    return `${prefix}-001`;
  }
  const re = new RegExp(`^${prefix}-(\\d{3,})-`);
  let maximum = 0;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const m = e.name.match(re);
    if (m) maximum = Math.max(maximum, Number.parseInt(m[1], 10));
  }
  const n = maximum + 1;
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

export type OperatingSpecDraftInput = {
  title: string;
  slug: string;
  actorId: string;
  framing: {
    problem: string;
    objective: string;
    users: string[];
    scope: string[];
    nonScope: string[];
    risks: string[];
    constraints: string[];
    requirements: string[];
    acceptanceOutcomes: string[];
  };
  operatingOrigin: {
    correlationId: string;
    proposalId: string;
    cycleId: string;
    decision: {
      decisionId: string;
      revision: number;
      title: string;
      outcome: string;
      rationale: string;
    };
    action: {
      actionId: string;
      revision: number;
      expectedResult: string;
    };
    perspectives: Array<{
      roleId: string;
      roleKind: 'advisor' | 'challenger' | 'chair';
      stance: string;
      summary: string;
      constraints: string[];
      uncertainties: string[];
    }>;
    evidence: Array<{
      evidenceRefId: string;
      relation: string;
      freshness: string;
      confidence: number;
      accessState: string;
      summary: string | null;
      limitations: string[];
    }>;
    omissions: Array<{ count: number; reason: string }>;
    verification: {
      metricId: string;
      baseline: number;
      target: number;
      window: string;
      method: string;
    };
  };
  createdAt: string;
};

export type PreparedOperatingSpecDraft = {
  id: string;
  slug: string;
  specDir: string;
  specFile: string;
  content: string;
};

function markdownInline(value: unknown): string {
  return String(value)
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[\\`*_[\]()!|<>]/gu, '\\$&');
}

function markdownCode(value: unknown): string {
  const text = String(value).replace(/\s+/gu, ' ').trim();
  const longestRun = Math.max(0, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length));
  const fence = '`'.repeat(longestRun + 1);
  const padding = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${padding}${text}${padding}${fence}`;
}

function operatingOriginSection(input: OperatingSpecDraftInput): string {
  const origin = input.operatingOrigin;
  const line = (label: string, value: unknown) => `- **${label}:** ${markdownInline(value)}`;
  const identity = (label: string, value: unknown) => `- **${label}:** ${markdownCode(value)}`;
  const nested = (label: string, values: string[]) =>
    values.length > 0
      ? `  - ${label}: ${values.map(markdownInline).join('; ')}`
      : `  - ${label}: none recorded`;
  const perspectives = origin.perspectives
    .map((perspective) =>
      [
        `- **${markdownInline(perspective.roleKind)} · ${markdownCode(perspective.roleId)}** (${markdownInline(perspective.stance)}): ${markdownInline(perspective.summary)}`,
        nested('Constraints', perspective.constraints),
        nested('Uncertainties', perspective.uncertainties),
      ].join('\n'),
    )
    .join('\n');
  const evidence =
    origin.evidence.length === 0
      ? '- No access-safe evidence reference was available.'
      : origin.evidence
          .map((entry) =>
            [
              `- ${markdownCode(entry.evidenceRefId)} · ${markdownInline(entry.relation)} · ${markdownInline(entry.freshness)} · confidence ${entry.confidence}`,
              `  - Summary: ${entry.summary === null ? 'restricted; summary unavailable' : markdownInline(entry.summary)}`,
              nested('Limitations', entry.limitations),
            ].join('\n'),
          )
          .join('\n');
  const omitted = origin.omissions.map((entry) => `${entry.count} ${markdownInline(entry.reason)}`);
  const actionPath = `#/operate/actions/${encodeURIComponent(origin.action.actionId)}/planning`;
  return [
    '## Operating origin',
    '',
    'This section is the access-safe human translation of the accepted Operate proposal. Machine authority remains in the adjacent `operating-origin.json` sidecar.',
    '',
    '### Problem and constraints',
    '',
    line('Problem', input.framing.problem),
    line(
      'Constraints',
      input.framing.constraints.length > 0 ? input.framing.constraints.join('; ') : 'none recorded',
    ),
    '',
    '### Decision and intended Outcome',
    '',
    identity('Correlation', origin.correlationId),
    identity('Proposal', origin.proposalId),
    `- **Decision:** ${markdownCode(origin.decision.decisionId)} revision ${origin.decision.revision}`,
    line('Decision title', origin.decision.title),
    line('Decision rationale', origin.decision.rationale),
    line('Intended Outcome', origin.decision.outcome),
    `- **Action:** ${markdownCode(origin.action.actionId)} revision ${origin.action.revision}`,
    line('Expected result', origin.action.expectedResult),
    '',
    '### Scope, non-scope, and risks',
    '',
    line('Scope', input.framing.scope.join('; ')),
    line(
      'Non-scope',
      input.framing.nonScope.length > 0 ? input.framing.nonScope.join('; ') : 'none recorded',
    ),
    line(
      'Risks',
      input.framing.risks.length > 0 ? input.framing.risks.join('; ') : 'none recorded',
    ),
    '',
    '### Accepted perspectives',
    '',
    perspectives,
    '',
    '### Evidence and limitations',
    '',
    evidence,
    ...(omitted.length > 0 ? ['', line('Access-safe omissions', omitted.join('; '))] : []),
    '',
    '### Verification',
    '',
    identity('Metric', origin.verification.metricId),
    line('Baseline', origin.verification.baseline),
    line('Target', origin.verification.target),
    line('Window', origin.verification.window),
    line('Method', origin.verification.method),
    '',
    '### Continue in Operate',
    '',
    `Run ${markdownCode(`planr operate dashboard ${origin.cycleId} --actor <authorizedActorId>`)}, then [open this Action in Planning](${actionPath}).`,
  ].join('\n');
}

/**
 * Render, but do not publish, a Protocol 1.7 SPEC for an approved Operate handoff.
 * Allocation reserves a project-global monotonic ID; the caller holds the
 * Planning bridge lock until its directory rename commits.
 */
export async function prepareOperatingSpecDraft(
  projectDir: string,
  config: OpenPlanrConfig,
  input: OperatingSpecDraftInput,
): Promise<PreparedOperatingSpecDraft> {
  const slug = slugify(input.slug);
  if (!slug || slug !== input.slug || Number.isNaN(Date.parse(input.createdAt))) {
    throw Object.assign(new Error('Operating Planning requires a canonical slug and timestamp.'), {
      code: 'E_OPERATE_PLANNING_INVALID',
    });
  }
  const specsRoot = getSpecsRootDir(projectDir, config);
  await ensureDir(specsRoot);
  const fs = await import('node:fs/promises');
  const entries = await fs.readdir(specsRoot, { withFileTypes: true });
  const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (
    entries.some(
      (entry) =>
        entry.isDirectory() && new RegExp(`^[A-Z]+-\\d{3,}-${escapedSlug}$`).test(entry.name),
    )
  ) {
    throw Object.assign(new Error('An existing SPEC already uses this canonical planning slug.'), {
      code: 'E_OPERATE_PLANNING_CONFLICT',
    });
  }
  const id = (await reservePlanningIds(projectDir, config, { SPEC: 1 })).SPEC[0];
  const specDir = getSpecDir(projectDir, config, id, slug);
  const specFile = path.join(specDir, `${id}-${slug}.md`);
  const date = input.createdAt.slice(0, 10);
  const list = (values: string[]) => values.map((value) => `- ${value}`).join('\n');
  const titlePlaceholder = '__OPENPLANR_OPERATING_SPEC_TITLE__';
  const rendered = await renderTemplate(
    'spec/spec-shaped.md.hbs',
    {
      id,
      slug,
      title: titlePlaceholder,
      schemaVersion: '1.7.0',
      priority: 'P1',
      milestone: '',
      po: '',
      created: date,
      date,
      uiFiles: [],
      context: `${input.framing.problem}\n\nObjective: ${input.framing.objective}\n\nUsers: ${input.framing.users.join('; ')}`,
      functionalRequirements: input.framing.requirements,
      businessRules: list(input.framing.constraints),
      outOfScope: input.framing.nonScope,
      acceptanceCriteria: input.framing.acceptanceOutcomes,
      decompositionNotes: [
        `Scope:\n${list(input.framing.scope)}`,
        input.framing.risks.length > 0 ? `Risks:\n${list(input.framing.risks)}` : '',
        'This SPEC inherits its operating origin through the adjacent closed sidecar. PLAN, Design, stories, tasks, and SHIP must not copy private operating bodies.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
    config.templateOverrides,
  );
  const parsed = parseMarkdown(rendered);
  const frontmatter: ArtifactFrontmatter = {
    id,
    title: input.title,
    slug,
    schemaVersion: '1.7.0',
    status: 'shaping',
    priority: 'P1',
    po: input.actorId,
    created: date,
    updated: date,
    ui_files: [],
    tech_dependencies: [],
  };
  const content = toMarkdownWithFrontmatter(
    frontmatter,
    `${parsed.content.replaceAll(titlePlaceholder, input.title).trimEnd()}\n\n${operatingOriginSection(input)}\n`,
  );
  return { id, slug, specDir, specFile, content };
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
  await atomicWriteFile(specFile, updateSpecFrontmatter(raw, { ...fields, updated: today }));
}

function updateSpecFrontmatter(raw: string, fields: Partial<Record<string, unknown>>): string {
  const openIdx = raw.indexOf('---');
  const closeIdx = raw.indexOf('\n---', openIdx + 3);
  if (openIdx === -1 || closeIdx === -1) {
    throw new Error('Spec has no valid frontmatter.');
  }
  let frontmatter = raw.slice(openIdx, closeIdx);
  const body = raw.slice(closeIdx);

  for (const [key, value] of Object.entries(fields)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedKey}:\\s*.*$`, 'm');
    const replacement = `${key}: ${formatYamlValue(value)}`;
    if (pattern.test(frontmatter)) {
      frontmatter = frontmatter.replace(pattern, () => replacement);
    } else {
      frontmatter += `\n${replacement}`;
    }
  }
  return frontmatter + body;
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
        `Task ${t.id} (${t.filename}) has no storyId — set it manually or regenerate it with planr-plan.`,
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
      warnings.push(`Story ${s.id} has no tasks — invoke planr-plan or hand-author tasks.`);
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
  const CURRENT_SCHEMA_VERSION = '1.7.0';
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
// Deterministic publication of host-authored User Stories and Tasks
// ---------------------------------------------------------------------------

export interface DecomposeSpecOptions {
  /** Deprecated compatibility alias for replaceExisting. */
  force?: boolean;
  /** Replace generated story/task files through the validated atomic swap. */
  replaceExisting?: boolean;
  /** Build and validate a decomposition without writing any project file. */
  preview?: boolean;
  /**
   * When true, skip the codebase scanner. Faster but generated tasks
   * reference generic paths the user must edit afterwards.
   */
  noCodeContext?: boolean;
  /** Cap the number of stories the AI emits (1-8, default 6 from prompt). */
  maxStories?: number;
  /** Host-authored, already validated semantic decomposition to publish deterministically. */
  decomposition?: SpecDecompositionInput;
}

export interface DecomposeSpecResult {
  storiesCreated: number;
  tasksCreated: number;
  decompositionNotes: string;
  preview: boolean;
  storyIds: string[];
  taskIds: string[];
  taskSelector: string;
  shipCommand: string;
}

export type SpecDecompositionTask = {
  id: string;
  type: 'UI' | 'Tech';
  agent: 'frontend-agent' | 'backend-agent';
  dependsOn: string[];
  acceptanceRefs: string[];
  title: string;
  rationale: string;
  filesCreate: string[];
  filesModify: string[];
  filesPreserve: string[];
  objective: string;
  technicalSpec: string;
  testRequirements: string;
  reviewRisks: string[];
  browserSurfaces: string[];
};

export type SpecDecompositionStory = {
  title: string;
  roleAction: string;
  benefit: string;
  scope: string;
  acceptanceCriteria: string[];
  tasks: SpecDecompositionTask[];
};

export interface SpecDecompositionInput {
  stories: SpecDecompositionStory[];
  decompositionNotes: string;
}

async function resolveDesignContext(
  projectDir: string,
  spec: SpecArtifact,
): Promise<{ hasDesign: boolean; context?: string }> {
  const designDir = getSpecDesignDir(spec.specDir);
  const designSpecPath = path.join(designDir, 'design-spec.md');
  const hasDesignSpec = await fileExists(designSpecPath);
  const pngFiles = (await listFiles(designDir, /\.png$/iu)).sort();
  const declaredUiFiles = Array.isArray(spec.data.ui_files)
    ? spec.data.ui_files.filter(
        (file): file is string => typeof file === 'string' && file.trim().length > 0,
      )
    : [];
  const sections: string[] = [];
  if (declaredUiFiles.length > 0) {
    sections.push(`Declared UI files:\n${declaredUiFiles.map((file) => `- ${file}`).join('\n')}`);
  }
  if (pngFiles.length > 0) {
    sections.push(
      `PNG inputs present:\n${pngFiles
        .map((file) => `- ${path.relative(projectDir, path.join(designDir, file))}`)
        .join('\n')}`,
    );
  }
  if (hasDesignSpec) {
    sections.push(
      `Design specification (${path.relative(projectDir, designSpecPath)}):\n${await readFile(designSpecPath)}`,
    );
  }
  return {
    hasDesign: declaredUiFiles.length > 0 || pngFiles.length > 0 || hasDesignSpec,
    ...(sections.length > 0 ? { context: sections.join('\n\n') } : {}),
  };
}

type AcceptanceCriterion = { id: string; statement: string };

function specTaskInput(
  aiTask: SpecDecompositionTask,
  storyId: string,
  taskIdMap: ReadonlyMap<string, string>,
  acceptanceCriteria: AcceptanceCriterion[],
): CreateSpecTaskInput {
  const acceptanceRefs = [...aiTask.acceptanceRefs];
  const knownAcceptance = new Set(acceptanceCriteria.map(({ id }) => id));
  const unknownAcceptance = acceptanceRefs.filter((id) => !knownAcceptance.has(id));
  if (unknownAcceptance.length > 0) {
    throw invalidDecomposition(
      `${aiTask.id} references unknown acceptance IDs: ${unknownAcceptance.join(', ')}.`,
    );
  }
  const mappedDependencies = aiTask.dependsOn.map((dependencyId) => {
    const mapped = taskIdMap.get(dependencyId);
    if (!mapped)
      throw invalidDecomposition(`${aiTask.id} depends on unknown task ${dependencyId}.`);
    return mapped;
  });
  const acceptanceVerification = acceptanceCriteria
    .filter(({ id }) => acceptanceRefs.includes(id))
    .map(({ id, statement }) => `- ${id}: ${statement}`)
    .join('\n');
  const shared = {
    storyId,
    title: aiTask.title,
    rationale: aiTask.rationale,
    dependsOn: mappedDependencies,
    filesCreate: aiTask.filesCreate,
    filesModify: aiTask.filesModify,
    filesPreserve: aiTask.filesPreserve,
    objective: aiTask.objective,
    technicalSpec: aiTask.technicalSpec,
    testRequirements: [aiTask.testRequirements.trim(), acceptanceVerification]
      .filter(Boolean)
      .join('\n'),
    reviewRisks: aiTask.reviewRisks,
    browserSurfaces: aiTask.browserSurfaces,
    acceptanceRefs,
    acceptanceCriteria: acceptanceCriteria.filter(({ id }) => acceptanceRefs.includes(id)),
  };
  return aiTask.type === 'UI'
    ? { ...shared, type: 'UI', agent: 'frontend-agent' }
    : { ...shared, type: 'Tech', agent: 'backend-agent' };
}

function validateRenderedPlanningArtifact(
  content: string,
  expected: { id: string; specId: string; storyId?: string },
): void {
  const parsed = parseMarkdown(content);
  for (const [key, value] of Object.entries(expected)) {
    if (parsed.data[key] !== value) {
      throw invalidDecomposition(
        `rendered ${expected.id} has ${key}=${String(parsed.data[key])}; expected ${value}.`,
      );
    }
  }
}

type PlanningProtocolIssue = { path: string; rule: string; detail: string };
type PlanningProtocolValidator = (
  kind: 'spec' | 'story' | 'task',
  value: unknown,
  options: { protocolVersion: '1.0.0' | '1.7.0' },
) => PlanningProtocolIssue[];

async function loadPlanningProtocolValidator(): Promise<PlanningProtocolValidator | null> {
  try {
    const protocol = await import('planr-pipeline/protocol');
    return protocol.validateProtocolArtifact as PlanningProtocolValidator;
  } catch (error) {
    const moduleError = error as NodeJS.ErrnoException;
    if (
      moduleError.code === 'ERR_MODULE_NOT_FOUND' &&
      moduleError.message.includes('planr-pipeline')
    ) {
      logger.warn(
        'Full Protocol frontmatter validation is unavailable because optional planr-pipeline is not installed. Install the matching planr-pipeline version before promoting this spec.',
      );
      return null;
    }
    throw error;
  }
}

function validatePlanningProtocolFrontmatter(
  validator: PlanningProtocolValidator | null,
  kind: 'spec' | 'story' | 'task',
  content: string,
  artifactId: string,
  protocolVersion: '1.0.0' | '1.7.0' = '1.0.0',
): void {
  if (!validator) return;
  const issues = validator(kind, parseMarkdown(content).data, { protocolVersion });
  if (issues.length === 0) return;
  const summary = issues
    .slice(0, 8)
    .map((issue) => `${issue.path} ${issue.rule}: ${issue.detail}`)
    .join('; ');
  const remainder = issues.length > 8 ? `; and ${issues.length - 8} more` : '';
  throw invalidDecomposition(
    `rendered ${artifactId} violates Protocol ${protocolVersion} ${kind} frontmatter: ${summary}${remainder}.`,
  );
}

async function removeDecompositionTransient(directory: string): Promise<void> {
  try {
    await fsPromises.rm(directory, { recursive: true, force: true });
  } catch (error) {
    logger.debug(`Could not remove decomposition transient ${directory}`, error);
  }
}

async function replaceSpecWithDecomposition(
  config: OpenPlanrConfig,
  spec: SpecArtifact,
  existingStories: SpecStoryListing[],
  existingTasks: SpecTaskListing[],
  decomposition: SpecDecompositionInput,
  allocation: { US: string[]; T: string[] },
): Promise<{ storiesCreated: number; tasksCreated: number }> {
  const fs = await import('node:fs/promises');
  const transactionId = randomUUID();
  const specParent = path.dirname(spec.specDir);
  const specDirName = path.basename(spec.specDir);
  const stagedSpecDir = path.join(specParent, `.${specDirName}.decompose-stage-${transactionId}`);
  const backupSpecDir = path.join(specParent, `.${specDirName}.decompose-backup-${transactionId}`);
  const protocolValidator = await loadPlanningProtocolValidator();

  try {
    await fsPromises.cp(spec.specDir, stagedSpecDir, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });

    const stagedStoriesDir = getSpecStoriesDir(stagedSpecDir);
    const stagedTasksDir = getSpecTasksDir(stagedSpecDir);
    await ensureDir(stagedStoriesDir);
    await ensureDir(stagedTasksDir);
    for (const story of existingStories) {
      await fs.rm(path.join(stagedStoriesDir, story.filename), { force: true });
    }
    for (const task of existingTasks) {
      await fs.rm(path.join(stagedTasksDir, task.filename), { force: true });
    }

    let tasksCreated = 0;
    const flatTasks = decomposition.stories.flatMap((story) => story.tasks);
    const taskIdMap = new Map(flatTasks.map((task, index) => [task.id, allocation.T[index]]));
    for (const [storyIndex, aiStory] of decomposition.stories.entries()) {
      const storyId = allocation.US[storyIndex];
      const acceptanceCriteria = aiStory.acceptanceCriteria.map((statement, index) => ({
        id: `AC-${String(index + 1).padStart(3, '0')}`,
        statement,
      }));
      const renderedTasks: Array<{
        id: string;
        filename: string;
        agent: string;
        title: string;
        content: string;
        acceptanceRefs: string[];
      }> = [];

      for (const aiTask of aiStory.tasks) {
        const taskId = taskIdMap.get(aiTask.id);
        if (!taskId) throw invalidDecomposition(`No global ID was allocated for ${aiTask.id}.`);
        const input = specTaskInput(aiTask, storyId, taskIdMap, acceptanceCriteria);
        const rendered = await renderSpecTaskContent(config, spec.id, taskId, input);
        const filename = `${taskId}-${rendered.slug}.md`;
        validateRenderedPlanningArtifact(rendered.content, {
          id: taskId,
          specId: spec.id,
          storyId,
        });
        validatePlanningProtocolFrontmatter(
          protocolValidator,
          'task',
          rendered.content,
          taskId,
          '1.7.0',
        );
        renderedTasks.push({
          id: taskId,
          filename,
          agent: input.agent,
          title: aiTask.title,
          content: rendered.content,
          acceptanceRefs: input.acceptanceRefs ?? [],
        });
      }

      const mappedAcceptance = new Set(renderedTasks.flatMap((task) => task.acceptanceRefs));
      const uncovered = acceptanceCriteria.filter(({ id }) => !mappedAcceptance.has(id));
      if (uncovered.length > 0) {
        throw invalidDecomposition(
          `${storyId} has acceptance criteria without task verification: ${uncovered.map(({ id }) => id).join(', ')}.`,
        );
      }

      const renderedStory = await renderSpecStoryContent(config, spec.id, storyId, aiStory.title, {
        roleAction: aiStory.roleAction,
        benefit: aiStory.benefit,
        scope: aiStory.scope,
        acceptanceCriteria,
        tasks: renderedTasks.map(({ id, filename, agent, title }) => ({
          id,
          filename,
          agent,
          title,
        })),
      });
      validateRenderedPlanningArtifact(renderedStory.content, { id: storyId, specId: spec.id });
      validatePlanningProtocolFrontmatter(
        protocolValidator,
        'story',
        renderedStory.content,
        storyId,
        '1.7.0',
      );
      await writeFile(
        path.join(stagedStoriesDir, `${storyId}-${renderedStory.slug}.md`),
        renderedStory.content,
      );
      for (const task of renderedTasks) {
        await writeFile(path.join(stagedTasksDir, task.filename), task.content);
        tasksCreated++;
      }
    }

    const stagedSpecFile = path.join(stagedSpecDir, path.basename(spec.specFile));
    const stagedSpecContent = updateSpecFrontmatter(await readFile(stagedSpecFile), {
      status: 'decomposed',
      updated: new Date().toISOString().split('T')[0],
    });
    const parsedSpec = parseMarkdown(stagedSpecContent);
    if (parsedSpec.data.id !== spec.id || parsedSpec.data.status !== 'decomposed') {
      throw invalidDecomposition('rendered spec status update did not preserve its identity.');
    }
    validatePlanningProtocolFrontmatter(
      protocolValidator,
      'spec',
      stagedSpecContent,
      spec.id,
      parsedSpec.data.schemaVersion === '1.7.0' ? '1.7.0' : '1.0.0',
    );
    await atomicWriteFile(stagedSpecFile, stagedSpecContent);

    await fsPromises.rename(spec.specDir, backupSpecDir);
    try {
      await fsPromises.rename(stagedSpecDir, spec.specDir);
    } catch (publishError) {
      try {
        await fsPromises.rename(backupSpecDir, spec.specDir);
      } catch (rollbackError) {
        throw new AggregateError(
          [publishError, rollbackError],
          `Could not publish the staged decomposition or restore ${spec.id}. The original plan remains at ${backupSpecDir}.`,
        );
      }
      throw publishError;
    }
    try {
      await fsPromises.rm(backupSpecDir, { recursive: true, force: true });
    } catch (error) {
      logger.debug(`Could not remove completed decomposition backup ${backupSpecDir}`, error);
    }

    return { storiesCreated: decomposition.stories.length, tasksCreated };
  } catch (error) {
    await removeDecompositionTransient(stagedSpecDir);
    throw error;
  }
}

function invalidDecomposition(message: string): Error & { code: string } {
  return Object.assign(new Error(`Invalid spec decomposition: ${message}`), {
    code: 'E_SPEC_DECOMPOSITION_INVALID',
  });
}

/**
 * Enforce the deterministic parts of the planning contract before any story or
 * task is written. Semantic dependency need is established by the prompt; this
 * boundary verifies that the declared graph is addressable and executable.
 */
function validateDecompositionContract(
  stories: SpecDecompositionStory[],
  hasDesign: boolean,
): void {
  const flattened: SpecDecompositionTask[] = [];

  for (const [storyIndex, story] of stories.entries()) {
    const location = `story ${storyIndex + 1} (${story.title})`;
    if (hasDesign) {
      if (story.tasks.length !== 2) {
        throw invalidDecomposition(
          `${location} must contain exactly two tasks because design context exists: UI then Tech.`,
        );
      }
      const [uiTask, techTask] = story.tasks;
      if (uiTask.type !== 'UI' || uiTask.agent !== 'frontend-agent') {
        throw invalidDecomposition(
          `${location} task 1 must use type UI with frontend-agent when design context exists.`,
        );
      }
      if (techTask.type !== 'Tech' || techTask.agent !== 'backend-agent') {
        throw invalidDecomposition(`${location} task 2 must use type Tech with backend-agent.`);
      }
    } else {
      if (story.tasks.length !== 1) {
        throw invalidDecomposition(
          `${location} must contain exactly one Tech task because no design context exists.`,
        );
      }
      const [techTask] = story.tasks;
      if (techTask.type !== 'Tech' || techTask.agent !== 'backend-agent') {
        throw invalidDecomposition(
          `${location} must use type Tech with backend-agent when no design context exists.`,
        );
      }
    }
    flattened.push(...story.tasks);
  }

  const taskIds = new Set<string>();
  for (const [index, task] of flattened.entries()) {
    const expectedId = `T-${String(index + 1).padStart(3, '0')}`;
    if (task.id !== expectedId) {
      throw invalidDecomposition(
        `task ${index + 1} must be ${expectedId} in flattened output order; received ${task.id}.`,
      );
    }
    taskIds.add(task.id);
  }

  for (const task of flattened) {
    for (const dependencyId of task.dependsOn) {
      if (!taskIds.has(dependencyId)) {
        throw invalidDecomposition(
          `${task.id} depends on unknown task ${dependencyId}; dependencies must reference this decomposition.`,
        );
      }
      if (dependencyId === task.id) {
        throw invalidDecomposition(`${task.id} cannot depend on itself.`);
      }
    }
  }

  const dependencies = new Map(flattened.map((task) => [task.id, task.dependsOn]));
  const state = new Map<string, 'visiting' | 'visited'>();
  const visit = (taskId: string, path: string[]): void => {
    const currentState = state.get(taskId);
    if (currentState === 'visited') return;
    if (currentState === 'visiting') {
      throw invalidDecomposition(`dependency cycle detected: ${[...path, taskId].join(' -> ')}.`);
    }
    state.set(taskId, 'visiting');
    for (const dependencyId of dependencies.get(taskId) ?? []) {
      visit(dependencyId, [...path, taskId]);
    }
    state.set(taskId, 'visited');
  };
  for (const task of flattened) visit(task.id, []);
}

/**
 * Decompose a SPEC into User Stories + Tasks via AI.
 *
 * High-level flow:
 *   1. Read the spec; refuse if stories/ or tasks/ already populated
 *      (unless replacement was requested)
 *   2. Accept the semantic decomposition authored by the active host agent.
 *   3. Validate and render a complete staged spec directory.
 *   4. Replace the prior spec directory only after the staged plan is valid.
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
  const replaceExisting = opts.replaceExisting === true || opts.force === true;
  if ((existingStories.length > 0 || existingTasks.length > 0) && !replaceExisting) {
    throw new Error(
      `Spec ${specId} already has ${existingStories.length} stor${
        existingStories.length === 1 ? 'y' : 'ies'
      } and ${existingTasks.length} task${existingTasks.length === 1 ? '' : 's'}. ` +
        `Pass --replace-existing to regenerate them atomically.`,
    );
  }
  if (!opts.decomposition) {
    const error = new Error(
      'Semantic decomposition belongs to the active host agent; provide a host-authored decomposition to the deterministic publisher.',
    ) as Error & { code: string };
    error.code = 'E_HOST_AGENT_REQUIRED';
    throw error;
  }

  // Resolve design context for deterministic one-vs-two task validation.
  const design = await resolveDesignContext(projectDir, spec);
  const result = opts.decomposition;

  validateDecompositionContract(result.stories, design.hasDesign);

  const flatTasks = result.stories.flatMap((story) => story.tasks);
  const counts = { US: result.stories.length, T: flatTasks.length } as const;
  const allocation = opts.preview
    ? await previewPlanningIds(projectDir, config, counts)
    : await reservePlanningIds(projectDir, config, counts);
  const firstReadyIndex = flatTasks.findIndex((task) => task.dependsOn.length === 0);
  const selectedIndex = firstReadyIndex >= 0 ? firstReadyIndex : 0;
  const taskSelector = allocation.T[selectedIndex];
  const shipCommand = `$planr:ship ${taskSelector}`;

  if (opts.preview) {
    return {
      storiesCreated: result.stories.length,
      tasksCreated: flatTasks.length,
      decompositionNotes: result.decompositionNotes,
      preview: true,
      storyIds: allocation.US,
      taskIds: allocation.T,
      taskSelector,
      shipCommand,
    };
  }

  // Render and validate outside the live spec directory. The final rename is
  // the first mutation of the existing plan, and it rolls back on failure.
  const { storiesCreated, tasksCreated } = await replaceSpecWithDecomposition(
    config,
    spec,
    existingStories,
    existingTasks,
    result,
    allocation,
  );

  await appendOpenPlanrProvenance({
    projectDir,
    artifactId: spec.id,
    artifactPath: spec.specFile,
    operation: 'decomposed',
    productVersion: readOpenPlanrVersion(),
    runtime: config.defaultAgent ?? 'cli',
    phase: 'planning',
  });

  logger.debug(`Decomposed ${specId}: ${storiesCreated} stories, ${tasksCreated} tasks written`);

  return {
    storiesCreated,
    tasksCreated,
    decompositionNotes: result.decompositionNotes,
    preview: false,
    storyIds: allocation.US,
    taskIds: allocation.T,
    taskSelector,
    shipCommand,
  };
}

// ---------------------------------------------------------------------------
// Shape — professional specification authoring
// ---------------------------------------------------------------------------

export const PROFESSIONAL_SPECIFICATION_CONTRACT = 'professional-specification@1.0.0' as const;
export const PROFESSIONAL_SPECIFICATION_KIND = 'professional-specification' as const;
export const PROFESSIONAL_SPECIFICATION_SCHEMA_VERSION = '1.0.0' as const;
export const PROFESSIONAL_SPECIFICATION_PROTOCOL_VERSION = '1.1.0' as const;
export const PROFESSIONAL_SPECIFICATION_MAX_INPUT_BYTES = 128 * 1024;

export const PROFESSIONAL_SPEC_SPECIALISTS = Object.freeze([
  'security',
  'performance',
  'migration',
  'api-contract',
  'data-integrity',
] as const);

export type ProfessionalSpecSpecialist = (typeof PROFESSIONAL_SPEC_SPECIALISTS)[number];

export interface ShapeSpecAnswers {
  kind: typeof PROFESSIONAL_SPECIFICATION_KIND;
  schemaVersion: typeof PROFESSIONAL_SPECIFICATION_SCHEMA_VERSION;
  protocolVersion: typeof PROFESSIONAL_SPECIFICATION_PROTOCOL_VERSION;
  context: string;
  audience: {
    primary: string;
    affected: string[];
  };
  outcome: {
    statement: string;
    measure: string;
    target: string;
    timeframe: string;
  };
  functionalRequirements: string[];
  constraints: string[];
  evidenceExpectations: string[];
  failureModes: string[];
  rollback: string;
  scope: {
    inScope: string[];
    outOfScope: string[];
  };
  acceptanceCriteria: string[];
  declaredSpecialists: ProfessionalSpecSpecialist[];
  businessRules?: string[];
  decompositionNotes?: string;
}

export class ProfessionalSpecValidationError extends Error {
  readonly code = 'E_PROFESSIONAL_SPEC_INVALID';
  readonly missing: string[];

  constructor(problem: string, missing: string[] = []) {
    super(problem);
    this.name = this.code;
    this.missing = [...missing];
  }

  toJSON(): {
    ok: false;
    code: string;
    problem: string;
    recovery: string;
    missing?: string[];
  } {
    return {
      ok: false,
      code: this.code,
      problem: this.message,
      recovery:
        'Provide one closed professional-specification@1.0.0 JSON object with every required field.',
      ...(this.missing.length > 0 ? { missing: [...this.missing] } : {}),
    };
  }
}

const PROFESSIONAL_SPEC_TOP_LEVEL_KEYS = Object.freeze([
  'kind',
  'schemaVersion',
  'protocolVersion',
  'context',
  'audience',
  'outcome',
  'functionalRequirements',
  'constraints',
  'evidenceExpectations',
  'failureModes',
  'rollback',
  'scope',
  'acceptanceCriteria',
  'declaredSpecialists',
  'businessRules',
  'decompositionNotes',
] as const);

const REQUIRED_PROFESSIONAL_SPEC_FIELDS = Object.freeze([
  'kind',
  'schemaVersion',
  'protocolVersion',
  'context',
  'audience',
  'outcome',
  'functionalRequirements',
  'constraints',
  'evidenceExpectations',
  'failureModes',
  'rollback',
  'scope',
  'acceptanceCriteria',
  'declaredSpecialists',
] as const);

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ProfessionalSpecValidationError(`${label} contains unsupported fields.`);
  }
}

function isPlaceholder(value: string): boolean {
  const normalized = value
    .replace(/[*_`#]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
  return (
    normalized.length === 0 ||
    /^(?:tbd|todo|n\/?a|unknown|later|placeholder|none|\.{3}|…)[.!]?$/u.test(normalized) ||
    /\b(?:tbd|todo|placeholder)\b/u.test(normalized) ||
    /(?:given|when|then)\s+(?:\.{3}|…)/u.test(normalized) ||
    /^\[(?:insert|describe|add|fill)[^\]]*\]$/u.test(normalized)
  );
}

function meaningfulText(
  value: unknown,
  label: string,
  options: { min?: number; max?: number } = {},
): string {
  const min = options.min ?? 8;
  const max = options.max ?? 4_096;
  if (typeof value !== 'string') {
    throw new ProfessionalSpecValidationError(`${label} must be text.`);
  }
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max || isPlaceholder(normalized)) {
    throw new ProfessionalSpecValidationError(
      `${label} must be explicit, decision-complete text between ${min} and ${max} characters.`,
    );
  }
  return normalized;
}

function meaningfulList(
  value: unknown,
  label: string,
  options: { min?: number; max?: number; itemMin?: number; allowEmpty?: boolean } = {},
): string[] {
  const min = options.min ?? 1;
  const max = options.max ?? 32;
  if (!Array.isArray(value) || value.length > max || (!options.allowEmpty && value.length < min)) {
    throw new ProfessionalSpecValidationError(
      `${label} must contain ${options.allowEmpty ? 'zero or more' : `between ${min} and ${max}`} items.`,
    );
  }
  const normalized = value.map((item) =>
    meaningfulText(item, `${label} item`, { min: options.itemMin ?? 8, max: 2_048 }),
  );
  const identities = normalized.map((item) => item.toLocaleLowerCase('en-US'));
  if (new Set(identities).size !== identities.length) {
    throw new ProfessionalSpecValidationError(`${label} contains duplicate items.`);
  }
  return normalized;
}

/** Parse, normalize, and close one professional specification authoring request. */
export function parseProfessionalSpecAnswers(value: unknown): ShapeSpecAnswers {
  let byteLength = 0;
  try {
    byteLength = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    throw new ProfessionalSpecValidationError(
      'Professional specification input must be one JSON object.',
    );
  }
  if (byteLength > PROFESSIONAL_SPECIFICATION_MAX_INPUT_BYTES) {
    throw new ProfessionalSpecValidationError(
      'Professional specification input exceeds the 128KB limit.',
    );
  }

  const input = plainRecord(value);
  if (!input) {
    throw new ProfessionalSpecValidationError(
      'Professional specification input must be one JSON object.',
    );
  }
  rejectUnknownKeys(input, PROFESSIONAL_SPEC_TOP_LEVEL_KEYS, 'Professional specification input');
  const missing = REQUIRED_PROFESSIONAL_SPEC_FIELDS.filter((field) => !(field in input));
  if (missing.length > 0) {
    throw new ProfessionalSpecValidationError(
      'Professional specification input is missing required fields.',
      [...missing],
    );
  }
  if (
    input.kind !== PROFESSIONAL_SPECIFICATION_KIND ||
    input.schemaVersion !== PROFESSIONAL_SPECIFICATION_SCHEMA_VERSION ||
    input.protocolVersion !== PROFESSIONAL_SPECIFICATION_PROTOCOL_VERSION
  ) {
    throw new ProfessionalSpecValidationError(
      'Professional specification contract identity is unsupported.',
    );
  }

  const audience = plainRecord(input.audience);
  if (!audience) throw new ProfessionalSpecValidationError('audience must be one object.');
  rejectUnknownKeys(audience, ['primary', 'affected'], 'audience');
  const audienceMissing = ['primary', 'affected'].filter((field) => !(field in audience));
  if (audienceMissing.length > 0) {
    throw new ProfessionalSpecValidationError(
      'audience is missing required fields.',
      audienceMissing,
    );
  }

  const outcome = plainRecord(input.outcome);
  if (!outcome) throw new ProfessionalSpecValidationError('outcome must be one object.');
  rejectUnknownKeys(outcome, ['statement', 'measure', 'target', 'timeframe'], 'outcome');
  const outcomeMissing = ['statement', 'measure', 'target', 'timeframe'].filter(
    (field) => !(field in outcome),
  );
  if (outcomeMissing.length > 0) {
    throw new ProfessionalSpecValidationError(
      'outcome is missing required fields.',
      outcomeMissing,
    );
  }

  const scope = plainRecord(input.scope);
  if (!scope) throw new ProfessionalSpecValidationError('scope must be one object.');
  rejectUnknownKeys(scope, ['inScope', 'outOfScope'], 'scope');
  const scopeMissing = ['inScope', 'outOfScope'].filter((field) => !(field in scope));
  if (scopeMissing.length > 0) {
    throw new ProfessionalSpecValidationError('scope is missing required fields.', scopeMissing);
  }

  if (!Array.isArray(input.declaredSpecialists)) {
    throw new ProfessionalSpecValidationError('declaredSpecialists must be one array.');
  }
  const declaredSpecialists = input.declaredSpecialists.map((candidate) => {
    if (
      typeof candidate !== 'string' ||
      !PROFESSIONAL_SPEC_SPECIALISTS.includes(candidate as ProfessionalSpecSpecialist)
    ) {
      throw new ProfessionalSpecValidationError(
        'declaredSpecialists contains an unsupported specialist identity.',
      );
    }
    return candidate as ProfessionalSpecSpecialist;
  });
  if (new Set(declaredSpecialists).size !== declaredSpecialists.length) {
    throw new ProfessionalSpecValidationError('declaredSpecialists contains duplicates.');
  }
  const orderedSpecialists = PROFESSIONAL_SPEC_SPECIALISTS.filter((specialist) =>
    declaredSpecialists.includes(specialist),
  );

  const businessRules =
    input.businessRules === undefined
      ? []
      : meaningfulList(input.businessRules, 'businessRules', { allowEmpty: true });
  const decompositionNotes =
    input.decompositionNotes === undefined
      ? ''
      : typeof input.decompositionNotes === 'string' && input.decompositionNotes.length <= 8_192
        ? input.decompositionNotes.trim()
        : (() => {
            throw new ProfessionalSpecValidationError(
              'decompositionNotes must be text no longer than 8192 characters.',
            );
          })();

  return Object.freeze({
    kind: PROFESSIONAL_SPECIFICATION_KIND,
    schemaVersion: PROFESSIONAL_SPECIFICATION_SCHEMA_VERSION,
    protocolVersion: PROFESSIONAL_SPECIFICATION_PROTOCOL_VERSION,
    context: meaningfulText(input.context, 'context'),
    audience: Object.freeze({
      primary: meaningfulText(audience.primary, 'audience.primary'),
      affected: Object.freeze(meaningfulList(audience.affected, 'audience.affected')),
    }),
    outcome: Object.freeze({
      statement: meaningfulText(outcome.statement, 'outcome.statement'),
      measure: meaningfulText(outcome.measure, 'outcome.measure'),
      target: meaningfulText(outcome.target, 'outcome.target'),
      timeframe: meaningfulText(outcome.timeframe, 'outcome.timeframe'),
    }),
    functionalRequirements: Object.freeze(
      meaningfulList(input.functionalRequirements, 'functionalRequirements'),
    ),
    constraints: Object.freeze(meaningfulList(input.constraints, 'constraints')),
    evidenceExpectations: Object.freeze(
      meaningfulList(input.evidenceExpectations, 'evidenceExpectations'),
    ),
    failureModes: Object.freeze(meaningfulList(input.failureModes, 'failureModes')),
    rollback: meaningfulText(input.rollback, 'rollback'),
    scope: Object.freeze({
      inScope: Object.freeze(meaningfulList(scope.inScope, 'scope.inScope')),
      outOfScope: Object.freeze(meaningfulList(scope.outOfScope, 'scope.outOfScope')),
    }),
    acceptanceCriteria: Object.freeze(
      meaningfulList(input.acceptanceCriteria, 'acceptanceCriteria', { itemMin: 20 }),
    ),
    declaredSpecialists: Object.freeze([...orderedSpecialists]),
    businessRules: Object.freeze(businessRules),
    decompositionNotes,
  }) as ShapeSpecAnswers;
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
  const professional = parseProfessionalSpecAnswers(answers);

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
      specificationContract: PROFESSIONAL_SPECIFICATION_CONTRACT,
      context: professional.context,
      audience: professional.audience,
      outcome: professional.outcome,
      functionalRequirements: professional.functionalRequirements,
      constraints: professional.constraints,
      evidenceExpectations: professional.evidenceExpectations,
      failureModes: professional.failureModes,
      rollback: professional.rollback,
      scope: professional.scope,
      acceptanceCriteria: professional.acceptanceCriteria,
      declaredSpecialists: professional.declaredSpecialists,
      businessRules: professional.businessRules,
      decompositionNotes: professional.decompositionNotes,
      projectName: config.projectName,
    },
    config.templateOverrides,
  );

  await atomicWriteFile(spec.specFile, content);
  logger.debug(`Shaped professional spec ${spec.id} (status: shaped)`);
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

interface SpecStoryTaskBreakdown {
  id: string;
  filename: string;
  agent: string;
  title: string;
}

interface SpecStoryBody {
  roleAction: string;
  benefit: string;
  scope?: string;
  acceptanceCriteria?: Array<string | AcceptanceCriterion>;
  tasks?: SpecStoryTaskBreakdown[];
}

async function renderSpecStoryContent(
  config: OpenPlanrConfig,
  specId: string,
  id: string,
  title: string,
  body: SpecStoryBody,
): Promise<{ slug: string; content: string }> {
  const slug = slugify(title);
  if (!slug) throw invalidDecomposition(`story ${id} title must produce a non-empty slug.`);
  const today = new Date().toISOString().split('T')[0];
  const acceptanceCriteria = (body.acceptanceCriteria ?? []).map((criterion, index) =>
    typeof criterion === 'string'
      ? { id: `AC-${String(index + 1).padStart(3, '0')}`, statement: criterion }
      : criterion,
  );
  const content = await renderTemplate(
    'spec/story.md.hbs',
    {
      id,
      slug,
      title,
      specId,
      schemaVersion: '1.7.0',
      status: 'pending',
      date: today,
      roleAction: body.roleAction,
      benefit: body.benefit,
      scope: body.scope || '',
      acceptanceCriteria,
      tasks: body.tasks || [],
      projectName: config.projectName,
    },
    config.templateOverrides,
  );
  return { slug, content };
}

/**
 * List project-global US-NNN files inside a spec's stories/ subdirectory.
 */
export async function listSpecStories(specDir: string): Promise<SpecStoryListing[]> {
  const storiesDir = getSpecStoriesDir(specDir);
  const exists = await fileExists(storiesDir);
  if (!exists) return [];

  const files = await listFiles(storiesDir, /^US-\d{3,}-.+\.md$/);
  const out: SpecStoryListing[] = [];
  for (const filename of files.sort()) {
    const m = filename.match(/^(US-\d{3,})-(.+)\.md$/);
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
  body: SpecStoryBody,
): Promise<{ id: string; slug: string; filePath: string }> {
  const resolved = await resolveSpecDir(projectDir, config, specId);
  if (!resolved) throw new Error(`Spec ${specId} not found.`);

  const storiesDir = getSpecStoriesDir(resolved.dir);
  await ensureDir(storiesDir);

  const id = (await reservePlanningIds(projectDir, config, { US: 1 })).US[0];
  const { slug, content } = await renderSpecStoryContent(config, specId, id, title, body);
  const filename = `${id}-${slug}.md`;
  const filePath = path.join(storiesDir, filename);
  await writeFile(filePath, content);
  return { id, slug, filePath };
}

// ---------------------------------------------------------------------------
// Tasks (project-global T-NNN IDs)
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

  const files = await listFiles(tasksDir, /^T-\d{3,}-.+\.md$/);
  const out: SpecTaskListing[] = [];
  for (const filename of files.sort()) {
    const m = filename.match(/^(T-\d{3,})-(.+)\.md$/);
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

interface SpecTaskFields {
  storyId: string; // US-NNN this task belongs to
  title: string;
  filesCreate?: string[];
  filesModify?: string[];
  filesPreserve?: string[];
  rationale?: string;
  dependsOn?: string[];
  objective?: string;
  technicalSpec?: string;
  testRequirements?: string;
  reviewRisks?: string[];
  browserSurfaces?: string[];
  acceptanceRefs?: string[];
  acceptanceCriteria?: AcceptanceCriterion[];
}

export type CreateSpecTaskInput = SpecTaskFields &
  ({ type: 'UI'; agent: 'frontend-agent' } | { type: 'Tech'; agent: 'backend-agent' | 'db-agent' });

async function renderSpecTaskContent(
  config: OpenPlanrConfig,
  specId: string,
  id: string,
  input: CreateSpecTaskInput,
): Promise<{ slug: string; content: string }> {
  const slug = slugify(input.title);
  if (!slug) throw invalidDecomposition(`task ${id} title must produce a non-empty slug.`);
  const today = new Date().toISOString().split('T')[0];
  const rationale =
    input.rationale?.trim() ||
    `${input.title} is required for ${input.storyId}; the listed files define the expected ${input.type === 'UI' ? 'user-interface' : 'technical'} change surface.`;
  const rationaleSentences = rationale.split(/(?<=[.!?])\s+/u).filter(Boolean);
  if (rationaleSentences.length > 3) {
    throw new Error('Task rationale must contain 1-3 sentences.');
  }
  const dependsOn = input.dependsOn ?? [];
  if (
    dependsOn.some((dependencyId) => !/^T-\d{3,}$/u.test(dependencyId)) ||
    new Set(dependsOn).size !== dependsOn.length
  ) {
    throw new Error('Task dependencies must be unique project-global T-NNN IDs.');
  }
  if (dependsOn.includes(id)) {
    throw new Error(`Task ${id} cannot depend on itself.`);
  }

  const content = await renderTemplate(
    'spec/task.md.hbs',
    {
      id,
      slug,
      title: input.title,
      storyId: input.storyId,
      specId,
      schemaVersion: '1.7.0',
      type: input.type,
      agent: input.agent,
      status: 'pending',
      date: today,
      rationale,
      dependsOn,
      filesCreate: input.filesCreate || [],
      filesModify: input.filesModify || [],
      filesPreserve: input.filesPreserve || [],
      objective: input.objective || '',
      technicalSpec: input.technicalSpec || '',
      testRequirements: input.testRequirements || '',
      reviewRisks: input.reviewRisks || [],
      browserSurfaces: input.browserSurfaces || [],
      acceptanceRefs: input.acceptanceRefs || [],
      acceptanceCriteria: input.acceptanceCriteria || [],
      projectName: config.projectName,
    },
    config.templateOverrides,
  );
  return { slug, content };
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

  // Task ID prefix: 'T' (single letter) by convention in spec mode
  // (vs agile mode's 'TASK'). Matches planr-pipeline schema.
  const id = (await reservePlanningIds(projectDir, config, { T: 1 })).T[0];
  const { slug, content } = await renderSpecTaskContent(config, specId, id, input);
  const filename = `${id}-${slug}.md`;
  const filePath = path.join(tasksDir, filename);
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

const PROFESSIONAL_SPEC_REQUIRED_SECTIONS = Object.freeze([
  'Context & Goal',
  'Audience',
  'Outcome & Measurement',
  'Functional Requirements',
  'Constraints',
  'Evidence Expectations',
  'Failure Modes',
  'Rollback',
  'Scope Boundaries',
  'Acceptance Criteria',
  'Declared Risk Specialists',
] as const);

function markdownSection(content: string, heading: string, level = 2): string | null {
  const lines = content.split(/\r?\n/u);
  const prefix = '#'.repeat(level);
  const start = lines.findIndex((line) => line.trim() === `${prefix} ${heading}`);
  if (start === -1) return null;
  const next = lines.findIndex(
    (line, index) => index > start && new RegExp(`^#{1,${level}}\\s`, 'u').test(line),
  );
  return lines
    .slice(start + 1, next === -1 ? undefined : next)
    .join('\n')
    .trim();
}

function sectionHasExplicitText(section: string): boolean {
  return section
    .split(/\r?\n/u)
    .map((line) =>
      line
        .replace(/^[-*+]\s+/u, '')
        .replace(/^\[[ xX]\]\s*/u, '')
        .replace(/^\*\*[^*]+:\*\*\s*/u, '')
        .trim(),
    )
    .some((line) => line.length >= 8 && !isPlaceholder(line));
}

/** Validate only documents that explicitly claim the professional marker. */
export function validateProfessionalSpecDocument(content: string): string[] {
  const issues: string[] = [];
  const sections = new Map<string, string>();
  for (const heading of PROFESSIONAL_SPEC_REQUIRED_SECTIONS) {
    const section = markdownSection(content, heading);
    if (section === null) {
      issues.push(`Professional specification is missing the "${heading}" section.`);
      continue;
    }
    sections.set(heading, section);
    if (!sectionHasExplicitText(section)) {
      issues.push(`Professional specification section "${heading}" is not decision complete.`);
    }
  }

  const audience = sections.get('Audience');
  if (audience) {
    if (!/^\*\*Primary:\*\*\s+\S.+$/mu.test(audience)) {
      issues.push('Professional specification Audience must name one primary audience.');
    }
    const affected = /^\*\*Affected:\*\*\s*$([\s\S]*)$/mu.exec(audience)?.[1]?.trim();
    if (!affected || !sectionHasExplicitText(affected)) {
      issues.push('Professional specification Audience must list affected audiences.');
    }
  }

  const outcome = sections.get('Outcome & Measurement');
  if (outcome) {
    for (const label of ['Statement', 'Measure', 'Target', 'Timeframe']) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      if (!new RegExp(`^\\*\\*${escaped}:\\*\\*\\s+\\S.{7,}$`, 'mu').test(outcome)) {
        issues.push(`Professional specification Outcome must include an explicit ${label}.`);
      }
    }
  }

  const scope = sections.get('Scope Boundaries');
  if (scope) {
    for (const label of ['In Scope', 'Out of Scope']) {
      const boundary = markdownSection(`## Scope Boundaries\n${scope}`, label, 3);
      if (boundary === null || !sectionHasExplicitText(boundary)) {
        issues.push(`Professional specification Scope Boundaries must include ${label}.`);
      }
    }
  }

  const acceptance = sections.get('Acceptance Criteria');
  if (acceptance) {
    const criteria = acceptance
      .split(/\r?\n/u)
      .map((line) => /^- \[[ xX]\]\s+(.+)$/u.exec(line.trim())?.[1]?.trim())
      .filter((line): line is string => Boolean(line));
    if (
      criteria.length === 0 ||
      criteria.some((criterion) => criterion.length < 20 || isPlaceholder(criterion))
    ) {
      issues.push(
        'Professional specification Acceptance Criteria must contain decision-complete checklist items.',
      );
    }
  }
  return issues;
}

/**
 * Validate that a spec is ready for host-native implementation.
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
    issues.push(`No User Stories found. Invoke planr-plan for ${specId} first.`);
  }

  const tasks = await listSpecTasks(spec.specDir);
  if (tasks.length === 0) {
    issues.push(`No Tasks found. Invoke planr-plan for ${specId} first.`);
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

  const specificationContract = spec.data.specificationContract;
  if (
    specificationContract !== undefined &&
    specificationContract !== PROFESSIONAL_SPECIFICATION_CONTRACT
  ) {
    issues.push('Spec declares an unsupported professional specification contract.');
  } else if (specificationContract === PROFESSIONAL_SPECIFICATION_CONTRACT) {
    issues.push(...validateProfessionalSpecDocument(spec.content));
  }

  return { ready: issues.length === 0, issues };
}
