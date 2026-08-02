/**
 * `planr linear push` — map Epic → Linear Project, Feature → top-level
 * project issue, Story and TaskList → sub-issues of the feature issue.
 */
import type { LinearClient } from '@linear/sdk';
import type { LinearMappingStrategy, OpenPlanrConfig } from '../models/types.js';
import { buildBacklogItemBody, buildEpicProjectDescription, buildFeatureIssueBody, buildMergedTaskListBody, buildStoryIssueBody, formatTaskCheckboxBody } from './linear/body-formatters.js';
import { buildLinearPushPlan, type LinearPushAction, type LinearPushItemKind, type LinearPushPlan, type LinearPushPlanRow, type LinearPushScope } from './linear/plan-builders.js';
import { loadForBacklogItem, loadForFeature, loadForQuickTask, loadForStory, loadForTaskFile, loadLinearPushScope, type ScopedFeature, type ScopedStandaloneArtifact } from './linear/scope-loaders.js';
export { buildBacklogItemBody, buildEpicProjectDescription, buildFeatureIssueBody, buildLinearPushPlan, buildMergedTaskListBody, buildStoryIssueBody, formatTaskCheckboxBody, type LinearPushAction, type LinearPushItemKind, type LinearPushPlan, type LinearPushPlanRow, type LinearPushScope, loadForBacklogItem, loadForFeature, loadForQuickTask, loadForStory, loadForTaskFile, loadLinearPushScope, type ScopedFeature, type ScopedStandaloneArtifact, };
export interface LinearPushOptions {
    /** Only update existing linked entities; never create new ones. */
    updateOnly?: boolean;
    /**
     * When true and a FEAT/US/TASK push's parent chain is not yet in Linear,
     * push the **ancestor chain only** (not the ancestors' other children) so
     * the target artifact has somewhere to attach. With `--no-cascade` this
     * means parents are pushed empty (FEAT without its stories, EPIC without
     * its features). Non-interactive mode requires this to be set explicitly
     * to auto-cascade upward.
     */
    pushParents?: boolean;
    /**
     * Push only the target artifact (and the minimum ancestor chain when
     * `pushParents` is set) — skip the descendant cascade that EPIC and FEAT
     * pushes do by default. Mutually exclusive with `cascade`. No-op for
     * leaf artifacts (US / TASK / QT / BL).
     */
    noCascade?: boolean;
    /**
     * Explicitly opt into descendant cascade. Today this is the default for
     * EPIC and FEAT pushes; the flag exists so users can write the explicit
     * intent (and so `--cascade --no-cascade` errors out as a clear signal).
     */
    cascade?: boolean;
    /**
     * First-time epic mapping override — used when the user passes
     * `--as project|milestone-of:<id>|label-on:<id>` or picks a strategy at
     * the interactive first-push prompt. Ignored on subsequent pushes when
     * the epic already has `linearMappingStrategy` stored (re-strategize is
     * a separate flow, not supported in this release).
     */
    strategyOverride?: {
        strategy: LinearMappingStrategy;
        /** For milestone-of / label-on only: the Linear project UUID to attach into. */
        targetProjectId?: string;
    };
}
/**
 * Derive a default status→stateId map from a team's workflow states. Used
 * when the user hasn't configured `linear.pushStateIds` — lets `planr linear
 * push` set workflow state out of the box.
 *
 * We pick the first state of each canonical Linear type so a team with
 * multiple "unstarted" lanes (Todo + Backlog) or multiple "completed" lanes
 * (Done + Released) gets a sensible default. Users who need different
 * routing can override via `linear.pushStateIds` (which takes precedence).
 */
export declare function buildAutoPushStateIdMap(states: readonly {
    id: string;
    type: string;
    name: string;
}[]): Record<string, string>;
/**
 * OpenPlanr status → Linear `stateId` for feature/story/quick/task push.
 *
 * Precedence: user config (`linear.pushStateIds` > `linear.statusMap` with
 * uuid values) > auto-derived team map. Common aliases (`completed` →
 * `done`, `todo` → `pending`, …) are normalized before lookup so hand-edited
 * frontmatter using Linear-native vocabulary keeps working.
 */
export declare function resolveTaskStateIdForPush(config: OpenPlanrConfig, status: string | undefined, autoMap?: Record<string, string>): string | undefined;
/**
 * OpenPlanr status → Linear `stateId` for backlog push.
 *
 * BL uses `open | closed | promoted`, which don't map onto Linear's workflow
 * vocabulary. We look up the raw key in `pushStateIds` → `statusMap` →
 * auto-derived team map. No coercion into task vocabulary.
 */
export declare function resolveBacklogStateIdForPush(config: OpenPlanrConfig, status: string | undefined, autoMap?: Record<string, string>): string | undefined;
/**
 * Populate the per-client auto-map. Called once at the top of
 * `runLinearPush` — a single extra API round-trip buys zero-config status
 * sync. Failures are swallowed to keep push working: if Linear rejects the
 * team-states query, the map stays empty and status updates become opt-in
 * via `linear.pushStateIds` as before.
 */
export declare function ensureAutoStateIdMap(client: LinearClient, teamId: string): Promise<void>;
/**
 * Populate the per-client estimation-type cache. Failures degrade to
 * `'notUsed'` so estimate is simply omitted rather than blocking the push.
 */
export declare function ensureTeamEstimationType(client: LinearClient, teamId: string): Promise<void>;
export declare function getAutoStateIdMap(client: LinearClient | undefined): Record<string, string> | undefined;
/**
 * Granular push entry point: dispatches on the artifact-id prefix. Accepts any
 * supported artifact type (EPIC/FEAT/US/TASK); errors with an actionable
 * message for types that are not pushable (ADR/SPRINT/checklist) or not yet
 * supported (QT/BL go through the same router too).
 */
export declare function runLinearPush(projectDir: string, config: OpenPlanrConfig, client: LinearClient, artifactId: string, options?: LinearPushOptions): Promise<LinearPushPlan | null>;
//# sourceMappingURL=linear-push-service.d.ts.map