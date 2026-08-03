/**
 * GitHub integration service.
 *
 * Wraps the `gh` CLI to create/update issues, labels, and milestones.
 * All operations use `gh` so authentication is handled by the user's
 * existing GitHub CLI session — no extra API tokens needed.
 */
import type { ArtifactFrontmatter, ArtifactType, GitHubCommitSummary, GitHubPullRequestSummary } from '../models/types.js';
export interface GitHubIssue {
    number: number;
    title: string;
    state: string;
    url: string;
    labels: Array<{
        name: string;
    }>;
}
/**
 * Verify that the current directory is a GitHub repo with `gh` authenticated.
 */
export declare function verifyGitHubRepo(): Promise<{
    owner: string;
    repo: string;
}>;
/**
 * Ensure a planr label exists, creating it if missing.
 */
export declare function ensureLabel(label: string): Promise<void>;
/**
 * Get the label name for an artifact type.
 */
export declare function getLabelForType(type: ArtifactType): string | null;
/**
 * Clean the issue title — strip redundant prefixes like "Tasks for FEAT-001: ".
 */
export declare function cleanTitle(artifactId: string, rawTitle: string): string;
/**
 * Build issue body from artifact raw markdown.
 * Type-aware: produces clean, professional formatting for each artifact type.
 */
export declare function buildIssueBody(raw: string, artifactId: string, artifactType: string, frontmatter: ArtifactFrontmatter): string;
/**
 * Create a GitHub issue from artifact data.
 */
export declare function createIssue(title: string, body: string, labels: string[], milestone?: string): Promise<{
    number: number;
    url: string;
}>;
/**
 * Update an existing GitHub issue.
 */
export declare function updateIssue(issueNumber: number, opts: {
    title?: string;
    body?: string;
    state?: string;
}): Promise<void>;
/**
 * Get a GitHub issue by number.
 */
export declare function getIssue(issueNumber: number): Promise<GitHubIssue>;
/**
 * List all issues with planr labels.
 */
export declare function listPlanrIssues(state?: 'open' | 'closed' | 'all', limit?: number): Promise<GitHubIssue[]>;
/**
 * Create or get a GitHub milestone (used for epics).
 */
export declare function ensureMilestone(title: string): Promise<string>;
/**
 * Map GitHub issue state to artifact status.
 */
export declare function issueStateToStatus(state: string): string;
/**
 * Map artifact status to GitHub issue state.
 */
export declare function statusToIssueState(status: string): string;
/**
 * Extract the planr artifact type from issue labels.
 */
export declare function getTypeFromLabels(labels: Array<{
    name: string;
}>): ArtifactType | null;
/**
 * Get the GitHub issue type name for an artifact type, if applicable.
 */
export declare function getIssueTypeForArtifact(type: ArtifactType): string | null;
/**
 * Fetch available issue types for a repo and cache them.
 * Returns a map of issue type name → node ID.
 */
export declare function fetchIssueTypes(owner: string, repo: string): Promise<Record<string, string>>;
/**
 * Set the issue type on a GitHub issue via GraphQL.
 * Requires the issue's node ID and the issue type's node ID.
 */
export declare function setIssueType(owner: string, repo: string, issueNumber: number, issueTypeName: string): Promise<void>;
/**
 * Recent commits on the default branch (best-effort via GitHub API).
 */
export declare function fetchRecentCommits(args: {
    days: number;
    limit: number;
}): Promise<{
    commits: GitHubCommitSummary[];
    warning?: string;
}>;
/**
 * Recently updated pull requests (all states), filtered client-side by `updated_at`.
 */
export declare function fetchRecentPullRequests(args: {
    days: number;
    limit: number;
}): Promise<{
    pullRequests: GitHubPullRequestSummary[];
    warning?: string;
}>;
/**
 * Best-effort check that `gh` can read the repo (already implied by verifyGitHubRepo).
 */
export declare function validateRepoAccessible(): Promise<{
    ok: boolean;
    message: string;
}>;
//# sourceMappingURL=github-service.d.ts.map