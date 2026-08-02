import type { ArtifactType } from '../models/types.js';
export declare const CONFIG_FILENAME = ".planr/config.json";
export declare const DEFAULT_AGILE_DIR = ".planr";
export declare const DEFAULT_CURSOR_RULES_DIR = ".cursor/rules";
/**
 * OpenPlanr Protocol version that the `--scope pipeline` rule generators
 * conform to. The protocol is the runtime-agnostic contract for spec-driven
 * mode artifacts (SPEC, US, Task schemas; PLAN/SHIP command contracts; agent
 * roles). Bumps RARELY — only on artifact-schema breaks or workflow
 * contract changes, NOT on pipeline plugin patches.
 *
 * NOT to be confused with the planr-pipeline plugin version (which moves
 * fast and is tracked in the marketplace pin file, not here). Generated rule
 * files reference the protocol contract; the runtime adapter (Claude Code
 * plugin / Cursor MDC / Codex AGENTS.md) writes its own actual version into
 * the `.pipeline-shipped` marker at execution time.
 *
 * Read by:
 *   - CursorGenerator (renders into Cursor MDC headers)
 *   - ClaudeGenerator (renders into the sibling `planr-pipeline.md` reference card)
 *   - CodexGenerator  (renders into the AGENTS.md pipeline section)
 *
 * See `planr-pipeline/docs/protocol/` for the full protocol spec.
 */
export declare const OPENPLANR_PROTOCOL_VERSION = "1.0.0";
export declare const ARTIFACT_DIRS: {
    readonly epics: "epics";
    readonly features: "features";
    readonly stories: "stories";
    readonly tasks: "tasks";
    readonly quick: "quick";
    readonly backlog: "backlog";
    readonly sprints: "sprints";
    readonly adrs: "adrs";
    readonly checklists: "checklists";
};
export declare const ID_PREFIXES: {
    readonly epic: "EPIC";
    readonly feature: "FEAT";
    readonly story: "US";
    readonly task: "TASK";
    readonly quick: "QT";
    readonly backlog: "BL";
    readonly sprint: "SPRINT";
    readonly adr: "ADR";
};
export declare const VALID_STATUSES: Partial<Record<ArtifactType, readonly string[]>>;
/**
 * Spec-driven mode (third planning posture) uses a richer status lifecycle
 * because each phase corresponds to a different role transition:
 * PO authoring → AI decomposition → human review → handoff to planr-pipeline.
 *
 * - pending             — SPEC created, body not yet written
 * - shaping             — SPEC body authored (manually or via `planr spec shape`)
 * - decomposing         — `planr spec decompose` is running (AI generating US + tasks)
 * - decomposed          — US + Task files written, awaiting human review
 * - ready-for-pipeline  — `planr spec promote` validated; ready for planr-pipeline
 * - in-pipeline         — planr-pipeline `/plan` or `/ship` is running
 * - done                — DEV phase complete, code shipped
 */
export declare const VALID_SPEC_STATUSES: readonly ["pending", "shaping", "decomposing", "decomposed", "ready-for-pipeline", "in-pipeline", "done"];
export type SpecStatus = (typeof VALID_SPEC_STATUSES)[number];
/** US/Task statuses inside a spec — simpler than the SPEC lifecycle. */
export declare const VALID_SPEC_STORY_STATUSES: readonly ["pending", "implementing", "done", "blocked"];
export declare const VALID_SPEC_TASK_STATUSES: readonly ["pending", "in-progress", "done", "blocked"];
export declare function getTemplatesDir(): string;
//# sourceMappingURL=constants.d.ts.map