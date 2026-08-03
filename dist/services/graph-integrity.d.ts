/**
 * Read-only artifact-graph integrity check for `planr revise` post-flight.
 *
 * Detects broken parent/child links after a revise run so the caller can
 * trigger automatic rollback if the writes left the tree inconsistent. This
 * is deliberately narrower than `planr sync`: it does not fix anything, does
 * not write to the logger, and only looks at the relationships revise might
 * have perturbed (parent-id frontmatter fields on features, stories, tasks).
 *
 * Why a separate module: keeps revise decoupled from the `sync` command's
 * repair logic, which has different invariants (fixes links, prompts the
 * user, etc.). The check here is a pure data function.
 */
import type { ArtifactType, OpenPlanrConfig } from '../models/types.js';
export interface GraphIntegrityIssue {
    childId: string;
    childType: ArtifactType;
    childPath: string;
    parentField: 'epicId' | 'featureId' | 'storyId';
    parentId: string;
    reason: 'missing-parent' | 'parent-type-mismatch';
}
export interface GraphIntegrityReport {
    ok: boolean;
    issues: GraphIntegrityIssue[];
}
/**
 * Walk every feature/story/task and verify its parent-id frontmatter
 * resolves to an existing parent artifact of the correct type. Missing
 * parent-id fields are tolerated (some tasks legitimately attach at
 * feature level, for example) — only *broken* non-empty references are
 * reported.
 */
export declare function checkGraphIntegrity(projectDir: string, config: OpenPlanrConfig): Promise<GraphIntegrityReport>;
//# sourceMappingURL=graph-integrity.d.ts.map