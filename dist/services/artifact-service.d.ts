import type { ArtifactFrontmatter, ArtifactType, OpenPlanrConfig } from '../models/types.js';
/** Return the directory path for a given artifact type relative to the agile output root. */
export declare function getArtifactDir(config: OpenPlanrConfig, type: ArtifactType): string;
/** Create a new artifact file from a Handlebars template, assigning the next available ID. */
export declare function createArtifact(projectDir: string, config: OpenPlanrConfig, type: ArtifactType, templateFile: string, data: Record<string, unknown>): Promise<{
    id: string;
    filePath: string;
}>;
/** List all artifacts of a given type, returning their ID, title, and filename. */
export declare function listArtifacts(projectDir: string, config: OpenPlanrConfig, type: ArtifactType): Promise<Array<{
    id: string;
    title: string;
    filename: string;
}>>;
/**
 * Read and parse an artifact's frontmatter and markdown body by ID.
 *
 * Returns `null` in two cases — both treated identically by callers:
 *   1. The file doesn't exist.
 *   2. The file exists but its frontmatter can't be parsed (malformed YAML,
 *      duplicate keys, stray `---` markers, etc.). A clear warning is emitted
 *      so the operator knows which file is broken and why; batch commands
 *      (`planr linear push`, `status`, `sync`) continue past the skip
 *      instead of aborting the whole run. The warning is deduped per file
 *      so re-reading the same broken file doesn't log twice.
 */
export declare function readArtifact(projectDir: string, config: OpenPlanrConfig, type: ArtifactType, id: string): Promise<{
    data: ArtifactFrontmatter;
    content: string;
    filePath: string;
} | null>;
/**
 * Read the full raw content of an artifact file (frontmatter + body).
 * Useful for passing the complete artifact text to AI prompts.
 */
export declare function readArtifactRaw(projectDir: string, config: OpenPlanrConfig, type: ArtifactType, id: string): Promise<string | null>;
/**
 * Overwrite an existing artifact file in place.
 *
 * When `skipValidation` is false (default), validates structural invariants
 * before writing: frontmatter fences, YAML validity, identity preservation,
 * and checkbox ID preservation. Throws `ArtifactInvariantError` on violation.
 *
 * Internal callers that construct content programmatically (linear-pull body
 * reconstruction, bulk checkbox flip) may pass `skipValidation: true`.
 */
export declare function updateArtifact(projectDir: string, config: OpenPlanrConfig, type: ArtifactType, id: string, content: string, { skipValidation }?: {
    skipValidation?: boolean;
}): Promise<void>;
/**
 * Update specific frontmatter fields on an artifact.
 * Operates only within the YAML frontmatter region (between --- delimiters).
 * Inserts missing fields before the closing --- if they don't exist.
 * Automatically sets the `updated` field to today's date.
 */
export declare function updateArtifactFields(projectDir: string, config: OpenPlanrConfig, type: ArtifactType, id: string, fields: Partial<Record<string, unknown>>): Promise<void>;
/**
 * Resolve an artifact ID to its actual filename (without path).
 * Returns the filename like "EPIC-002-markdown-to-kanban-board.md"
 * or falls back to "ID.md" if the file can't be found.
 */
export declare function resolveArtifactFilename(projectDir: string, config: OpenPlanrConfig, type: ArtifactType, id: string): Promise<string>;
/**
 * Add a child reference link to a parent artifact's markdown file.
 *
 * Replaces the "No X created yet" placeholder with a link list,
 * or appends to existing links in the appropriate section.
 *
 * @param childId    e.g. "FEAT-002"
 * @param childTitle e.g. "Markdown Task Parser Engine"
 * @param childType  e.g. "feature"
 */
export declare function addChildReference(projectDir: string, config: OpenPlanrConfig, parentType: ArtifactType, parentId: string, childType: ArtifactType, childId: string, childTitle: string): Promise<void>;
/**
 * Determine artifact type from an ID prefix.
 */
export declare function findArtifactTypeById(id: string): ArtifactType | null;
/**
 * Read the parent chain for an artifact (story → feature → epic).
 */
export declare function getParentChain(projectDir: string, config: OpenPlanrConfig, type: ArtifactType, id: string): Promise<{
    epic?: {
        data: ArtifactFrontmatter;
        content: string;
    };
    feature?: {
        data: ArtifactFrontmatter;
        content: string;
    };
    story?: {
        data: ArtifactFrontmatter;
        content: string;
    };
}>;
//# sourceMappingURL=artifact-service.d.ts.map