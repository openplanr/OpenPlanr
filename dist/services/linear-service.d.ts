/**
 * Linear API wrapper — auth + SDK mutations wrapped with retry, error
 * mapping, and input-safety guards. Constants/validators live in
 * `linear/constants.ts`; retry + error mapping in `linear/errors.ts`.
 */
import { LinearClient } from '@linear/sdk';
type LinearIssueCreate = Parameters<LinearClient['createIssue']>[0];
type LinearIssueUpdate = Parameters<LinearClient['updateIssue']>[1];
type LinearProjectCreate = Parameters<LinearClient['createProject']>[0];
type LinearProjectUpdate = Parameters<LinearClient['updateProject']>[1];
type LinearProjectMilestoneCreate = Parameters<LinearClient['createProjectMilestone']>[0];
export { isLikelyLinearIssueId, isLikelyLinearWorkflowStateId, LINEAR_CREDENTIAL_KEY, } from './linear/constants.js';
export { mapLinearError, withLinearRetry } from './linear/errors.js';
export interface LinearViewerSummary {
    id: string;
    name: string;
    email?: string;
}
export interface LinearTeamOption {
    id: string;
    name: string;
    key: string;
}
export interface LinearProjectSummary {
    id: string;
    identifier: string;
    name: string;
    url: string;
}
export interface LinearIssueSummary {
    id: string;
    identifier: string;
    url: string;
}
export interface LinearMilestoneSummary {
    id: string;
    name: string;
}
export interface LinearLabelSummary {
    id: string;
    name: string;
}
export declare function createLinearClient(apiKey: string): LinearClient;
export declare function createLinearProject(client: LinearClient, input: LinearProjectCreate): Promise<LinearProjectSummary>;
export declare function updateLinearProject(client: LinearClient, projectId: string, input: LinearProjectUpdate): Promise<LinearProjectSummary>;
export declare function createLinearIssue(client: LinearClient, input: LinearIssueCreate): Promise<LinearIssueSummary>;
export declare function updateLinearIssue(client: LinearClient, issueId: string, input: LinearIssueUpdate): Promise<LinearIssueSummary>;
/**
 * Create a new ProjectMilestone inside an existing Linear project. Returned
 * id is what we store on the epic's `linearMilestoneId` and propagate as
 * `projectMilestoneId` on every descendant issue.
 */
export declare function createProjectMilestone(client: LinearClient, input: LinearProjectMilestoneCreate): Promise<LinearMilestoneSummary>;
/**
 * Idempotent team-scoped label creation. Looks up an existing label by exact
 * name + team before creating, so re-running push is a no-op on the label
 * side. Matches the "Push re-applies the label idempotently" contract.
 */
export declare function ensureIssueLabel(client: LinearClient, input: {
    teamId: string;
    name: string;
    color?: string;
    description?: string;
}): Promise<LinearLabelSummary>;
/**
 * List the team's projects so the user can pick a target for
 * `milestone-of` / `label-on` mapping strategies.
 */
export declare function getTeamProjects(client: LinearClient, teamId: string, limit?: number): Promise<Array<{
    id: string;
    name: string;
    url: string;
}>>;
/**
 * One team workflow state — the minimum Linear metadata we need to auto-map
 * OpenPlanr statuses to state UUIDs when the user hasn't configured
 * `linear.pushStateIds`.
 *
 * `type` is Linear's canonical classification (`backlog` / `unstarted` /
 * `started` / `completed` / `canceled`) and is robust against teams renaming
 * states — unlike `name`, which varies per team.
 */
export interface LinearWorkflowStateSummary {
    id: string;
    name: string;
    type: string;
}
/**
 * Fetch the team's workflow states in one round-trip. Used by `planr linear
 * push` to auto-derive a status→stateId map when the user has no explicit
 * `linear.pushStateIds` config.
 */
export declare function fetchTeamWorkflowStates(client: LinearClient, teamId: string): Promise<LinearWorkflowStateSummary[]>;
/**
 * Fetch the team's `issueEstimationType` in one round-trip. Used by `planr
 * linear push` to decide whether (and how) to map OpenPlanr `storyPoints` to
 * Linear's native estimate field.
 *
 * Returns `'notUsed'` when the team has estimation disabled — push then
 * skips the field silently.
 */
export declare function fetchTeamIssueEstimationType(client: LinearClient, teamId: string): Promise<string>;
/**
 * Batched: load each issue's current workflow state **name** (one GraphQL
 * round-trip per chunk).
 */
export declare function fetchLinearIssueStateNames(client: LinearClient, issueIds: string[]): Promise<Map<string, string>>;
export declare function getLinearIssueDescription(client: LinearClient, issueId: string): Promise<string>;
/** Resolves the current user; throws if the token is invalid or lacks API access. */
export declare function validateToken(client: LinearClient): Promise<LinearViewerSummary>;
/** Teams the authenticated user can access (first page, up to 100). */
export declare function getAvailableTeams(client: LinearClient): Promise<LinearTeamOption[]>;
/**
 * Verifies the team exists and the token can read it (incl. project listing).
 * Catches inaccessible teams and read failures before write mutations fail
 * mid-flight with confusing GraphQL errors.
 */
export declare function validateTeamAccess(client: LinearClient, teamId: string): Promise<{
    name: string;
    key: string;
}>;
//# sourceMappingURL=linear-service.d.ts.map