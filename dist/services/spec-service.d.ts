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
 * This service owns dedicated planning inside the planr CLI. The pipeline
 * independently provides feature-local PO planning as part of its complete
 * PO → Design → Review → DEV → QA flow. Both producers share the artifact
 * contract and record provenance so their intentional overlap stays clear.
 */
import type { OpenPlanrConfig } from '../models/types.js';
/** Root directory holding all specs (e.g., `.planr/specs/`). */
export declare function getSpecsRootDir(projectDir: string, config: OpenPlanrConfig): string;
/** Self-contained directory for a single spec, e.g. `.planr/specs/SPEC-001-auth-flow/`. */
export declare function getSpecDir(projectDir: string, config: OpenPlanrConfig, specId: string, slug: string): string;
/** Stories subdirectory inside a spec. */
export declare function getSpecStoriesDir(specDir: string): string;
/** Tasks subdirectory inside a spec. */
export declare function getSpecTasksDir(specDir: string): string;
/** Design assets subdirectory inside a spec (PNGs + design-spec.md). */
export declare function getSpecDesignDir(specDir: string): string;
/**
 * Resolve a spec ID (e.g. `SPEC-001`) to its on-disk directory by scanning
 * `.planr/specs/` for a matching `SPEC-NNN-{slug}` directory. Returns null
 * if the spec isn't found.
 *
 * The directory name encodes both ID and slug, so we don't need to read the
 * spec file to find it.
 */
export declare function resolveSpecDir(projectDir: string, config: OpenPlanrConfig, specId: string): Promise<{
    dir: string;
    slug: string;
} | null>;
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
export declare function listSpecs(projectDir: string, config: OpenPlanrConfig): Promise<SpecListing[]>;
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
export declare function createSpec(projectDir: string, config: OpenPlanrConfig, title: string, options?: CreateSpecOptions): Promise<{
    id: string;
    slug: string;
    specDir: string;
    specFile: string;
}>;
export interface SpecArtifact {
    id: string;
    slug: string;
    specDir: string;
    specFile: string;
    data: Record<string, unknown>;
    content: string;
}
export declare function readSpec(projectDir: string, config: OpenPlanrConfig, specId: string): Promise<SpecArtifact | null>;
/** Overwrite the spec markdown file in place. Atomic. */
export declare function updateSpec(projectDir: string, config: OpenPlanrConfig, specId: string, content: string): Promise<void>;
/**
 * Surgical YAML frontmatter update for a spec.
 * Mirrors artifact-service.updateArtifactFields shape.
 */
export declare function updateSpecFields(projectDir: string, config: OpenPlanrConfig, specId: string, fields: Partial<Record<string, unknown>>): Promise<void>;
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
export declare function syncSpec(projectDir: string, config: OpenPlanrConfig, specId: string, opts?: {
    dryRun?: boolean;
}): Promise<SyncSpecReport>;
/**
 * Run syncSpec across every spec in the project.
 * Aggregates per-spec reports.
 */
export declare function syncAllSpecs(projectDir: string, config: OpenPlanrConfig, opts?: {
    dryRun?: boolean;
}): Promise<{
    specsScanned: number;
    reports: SyncSpecReport[];
}>;
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
export declare function decomposeSpec(projectDir: string, config: OpenPlanrConfig, specId: string, opts?: DecomposeSpecOptions): Promise<DecomposeSpecResult>;
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
export declare function shapeSpec(projectDir: string, config: OpenPlanrConfig, specId: string, answers: ShapeSpecAnswers): Promise<{
    specFile: string;
}>;
/**
 * Destroy a spec directory. Self-contained = single `rm -rf` of the
 * spec's own directory. Stories and tasks are removed atomically with the
 * spec. No cross-spec references to clean up.
 */
export declare function destroySpec(projectDir: string, config: OpenPlanrConfig, specId: string): Promise<void>;
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
export declare function listSpecStories(specDir: string): Promise<SpecStoryListing[]>;
/** Append a US-NNN-{slug}.md file under the spec's stories/ directory. */
export declare function createSpecStory(projectDir: string, config: OpenPlanrConfig, specId: string, title: string, body: {
    roleAction: string;
    benefit: string;
    scope?: string;
    acceptanceCriteria?: string[];
}): Promise<{
    id: string;
    slug: string;
    filePath: string;
}>;
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
export declare function listSpecTasks(specDir: string): Promise<SpecTaskListing[]>;
export interface CreateSpecTaskInput {
    storyId: string;
    title: string;
    type: 'UI' | 'Tech';
    agent: string;
    filesCreate?: string[];
    filesModify?: string[];
    filesPreserve?: string[];
    objective?: string;
    technicalSpec?: string;
    testRequirements?: string;
}
/** Create a new T-NNN task file under the spec's tasks/ directory. */
export declare function createSpecTask(projectDir: string, config: OpenPlanrConfig, specId: string, input: CreateSpecTaskInput): Promise<{
    id: string;
    slug: string;
    filePath: string;
}>;
/**
 * Copy PNG mockup files into a spec's design/ directory. Updates the
 * spec frontmatter `ui_files` to list the copied filenames.
 */
export declare function attachSpecDesigns(projectDir: string, config: OpenPlanrConfig, specId: string, pngPaths: string[]): Promise<{
    copied: string[];
    designDir: string;
}>;
/**
 * Snapshot of all specs + their decomposition state. Used by `planr spec status`.
 */
export interface SpecStatusReport {
    specCount: number;
    specs: SpecListing[];
    totalStories: number;
    totalTasks: number;
}
export declare function getSpecStatus(projectDir: string, config: OpenPlanrConfig): Promise<SpecStatusReport>;
/**
 * Validate that a spec is ready to hand off to planr-pipeline.
 * Returns the list of issues, or empty array if ready.
 */
export declare function validateSpecForPromotion(projectDir: string, config: OpenPlanrConfig, specId: string): Promise<{
    ready: boolean;
    issues: string[];
}>;
//# sourceMappingURL=spec-service.d.ts.map