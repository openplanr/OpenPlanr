/**
 * Linear API wrapper — auth + SDK mutations wrapped with retry, error
 * mapping, and input-safety guards. Constants/validators live in
 * `linear/constants.ts`; retry + error mapping in `linear/errors.ts`.
 */

import { LinearClient } from '@linear/sdk';
import { LINEAR_FIELD_LIMITS, requireNonEmpty, truncateForLinear } from './linear/constants.js';
import { mapLinearError, withLinearRetry } from './linear/errors.js';

type LinearIssueCreate = Parameters<LinearClient['createIssue']>[0];
type LinearIssueUpdate = Parameters<LinearClient['updateIssue']>[1];
type LinearProjectCreate = Parameters<LinearClient['createProject']>[0];
type LinearProjectUpdate = Parameters<LinearClient['updateProject']>[1];
type LinearProjectMilestoneCreate = Parameters<LinearClient['createProjectMilestone']>[0];
type LinearIssueLabelCreate = Parameters<LinearClient['createIssueLabel']>[0];

export {
  isLikelyLinearIssueId,
  isLikelyLinearWorkflowStateId,
  LINEAR_CREDENTIAL_KEY,
} from './linear/constants.js';
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

export function createLinearClient(apiKey: string): LinearClient {
  return new LinearClient({ apiKey });
}

// ---------------------------------------------------------------------------
// Project / Issue / Milestone / Label mutations
// ---------------------------------------------------------------------------

export async function createLinearProject(
  client: LinearClient,
  input: LinearProjectCreate,
): Promise<LinearProjectSummary> {
  const safeInput: LinearProjectCreate = {
    ...input,
    name: truncateForLinear(
      requireNonEmpty(input.name, 'Linear project name'),
      LINEAR_FIELD_LIMITS.projectName,
      'Linear project name',
    ),
    ...(typeof input.description === 'string'
      ? {
          description: truncateForLinear(
            input.description,
            LINEAR_FIELD_LIMITS.projectDescription,
            'Linear project description',
          ),
        }
      : {}),
  };
  return withLinearRetry('create project', async () => {
    const payload = await client.createProject(safeInput);
    if (!payload?.success) {
      throw new Error('Linear did not return success when creating a project.');
    }
    const id = payload.projectId;
    if (!id) {
      throw new Error('Linear did not return a project id when creating a project.');
    }
    const project = await client.project(id);
    if (!project) {
      throw new Error('Failed to load the created project from Linear.');
    }
    return {
      id: project.id,
      identifier: project.slugId,
      name: project.name,
      url: project.url,
    };
  });
}

export async function updateLinearProject(
  client: LinearClient,
  projectId: string,
  input: LinearProjectUpdate,
): Promise<LinearProjectSummary> {
  const safeInput: LinearProjectUpdate = {
    ...input,
    ...(typeof input.name === 'string'
      ? {
          name: truncateForLinear(
            requireNonEmpty(input.name, 'Linear project name'),
            LINEAR_FIELD_LIMITS.projectName,
            'Linear project name',
          ),
        }
      : {}),
    ...(typeof input.description === 'string'
      ? {
          description: truncateForLinear(
            input.description,
            LINEAR_FIELD_LIMITS.projectDescription,
            'Linear project description',
          ),
        }
      : {}),
  };
  return withLinearRetry('update project', async () => {
    const payload = await client.updateProject(projectId, safeInput);
    if (!payload?.success) {
      throw new Error('Linear did not return success when updating a project.');
    }
    const project = await client.project(projectId);
    if (!project) {
      throw new Error('Failed to load the updated project from Linear.');
    }
    return {
      id: project.id,
      identifier: project.slugId,
      name: project.name,
      url: project.url,
    };
  });
}

export async function createLinearIssue(
  client: LinearClient,
  input: LinearIssueCreate,
): Promise<LinearIssueSummary> {
  const safeInput: LinearIssueCreate = {
    ...input,
    title: truncateForLinear(
      requireNonEmpty(input.title, 'Linear issue title'),
      LINEAR_FIELD_LIMITS.issueTitle,
      'Linear issue title',
    ),
    ...(typeof input.description === 'string'
      ? {
          description: truncateForLinear(
            input.description,
            LINEAR_FIELD_LIMITS.issueDescription,
            'Linear issue description',
          ),
        }
      : {}),
  };
  return withLinearRetry('create issue', async () => {
    const payload = await client.createIssue(safeInput);
    if (!payload?.success) {
      throw new Error('Linear did not return success when creating an issue.');
    }
    const id = payload.issueId;
    if (!id) {
      throw new Error('Linear did not return an issue id when creating an issue.');
    }
    const issue = await client.issue(id);
    if (!issue) {
      throw new Error('Failed to load the created issue from Linear.');
    }
    return {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url,
    };
  });
}

export async function updateLinearIssue(
  client: LinearClient,
  issueId: string,
  input: LinearIssueUpdate,
): Promise<LinearIssueSummary> {
  const safeInput: LinearIssueUpdate = {
    ...input,
    ...(typeof input.title === 'string'
      ? {
          title: truncateForLinear(
            requireNonEmpty(input.title, 'Linear issue title'),
            LINEAR_FIELD_LIMITS.issueTitle,
            'Linear issue title',
          ),
        }
      : {}),
    ...(typeof input.description === 'string'
      ? {
          description: truncateForLinear(
            input.description,
            LINEAR_FIELD_LIMITS.issueDescription,
            'Linear issue description',
          ),
        }
      : {}),
  };
  return withLinearRetry('update issue', async () => {
    const payload = await client.updateIssue(issueId, safeInput);
    if (!payload?.success) {
      throw new Error('Linear did not return success when updating an issue.');
    }
    const issue = await client.issue(issueId);
    if (!issue) {
      throw new Error('Failed to load the updated issue from Linear.');
    }
    return {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url,
    };
  });
}

/**
 * Create a new ProjectMilestone inside an existing Linear project. Returned
 * id is what we store on the epic's `linearMilestoneId` and propagate as
 * `projectMilestoneId` on every descendant issue.
 */
export async function createProjectMilestone(
  client: LinearClient,
  input: LinearProjectMilestoneCreate,
): Promise<LinearMilestoneSummary> {
  const safeName = truncateForLinear(
    requireNonEmpty(input.name, 'Linear milestone name'),
    LINEAR_FIELD_LIMITS.milestoneName,
    'Linear milestone name',
  );
  const safeInput: LinearProjectMilestoneCreate = {
    ...input,
    name: safeName,
    ...(typeof input.description === 'string'
      ? {
          description: truncateForLinear(
            input.description,
            LINEAR_FIELD_LIMITS.milestoneDescription,
            'Linear milestone description',
          ),
        }
      : {}),
  };
  return withLinearRetry('create milestone', async () => {
    const payload = await client.createProjectMilestone(safeInput);
    if (!payload?.success) {
      throw new Error('Linear did not return success when creating a project milestone.');
    }
    const id = payload.projectMilestoneId;
    if (!id) {
      throw new Error('Linear did not return a milestone id when creating a project milestone.');
    }
    return { id, name: safeName };
  });
}

/**
 * Idempotent team-scoped label creation. Looks up an existing label by exact
 * name + team before creating, so re-running push is a no-op on the label
 * side. Matches the "Push re-applies the label idempotently" contract.
 */
export async function ensureIssueLabel(
  client: LinearClient,
  input: { teamId: string; name: string; color?: string; description?: string },
): Promise<LinearLabelSummary> {
  const safeName = truncateForLinear(
    requireNonEmpty(input.name, 'Linear label name'),
    LINEAR_FIELD_LIMITS.labelName,
    'Linear label name',
  );
  const safeDescription =
    typeof input.description === 'string'
      ? truncateForLinear(
          input.description,
          LINEAR_FIELD_LIMITS.labelDescription,
          'Linear label description',
        )
      : undefined;
  return withLinearRetry('ensure label', async () => {
    // Linear enforces label uniqueness **case-insensitively** and at the
    // **workspace** level (not per-team): creating `feature` fails with
    // "Label 'Feature' already exists in the workspace" when a capitalized
    // version exists, even if it's owned by a different team. Our lookup
    // must match Linear's own uniqueness rule or we'll try to create
    // duplicates that the API rejects.
    //
    // Strategy:
    //   1. Prefer a team-scoped match (usable for issue labels on this team).
    //   2. Fall back to any workspace-wide match with the same name — adopt
    //      it as the label we'll apply. The issue can reference workspace
    //      labels across teams.
    const teamScoped = await client.issueLabels({
      filter: {
        team: { id: { eq: input.teamId } },
        name: { eqIgnoreCase: safeName },
      },
      first: 1,
    });
    const teamHit = teamScoped.nodes?.[0];
    if (teamHit?.id) {
      return { id: teamHit.id, name: teamHit.name };
    }
    const workspaceWide = await client.issueLabels({
      filter: {
        name: { eqIgnoreCase: safeName },
      },
      first: 1,
    });
    const workspaceHit = workspaceWide.nodes?.[0];
    if (workspaceHit?.id) {
      return { id: workspaceHit.id, name: workspaceHit.name };
    }
    const created: LinearIssueLabelCreate = {
      teamId: input.teamId,
      name: safeName,
      color: input.color,
      ...(safeDescription !== undefined ? { description: safeDescription } : {}),
    };
    const payload = await client.createIssueLabel(created);
    if (!payload?.success) {
      throw new Error('Linear did not return success when creating an issue label.');
    }
    const id = payload.issueLabelId;
    if (!id) {
      throw new Error('Linear did not return a label id when creating an issue label.');
    }
    return { id, name: safeName };
  });
}

/**
 * List the team's projects so the user can pick a target for
 * `milestone-of` / `label-on` mapping strategies.
 */
export async function getTeamProjects(
  client: LinearClient,
  teamId: string,
  limit = 50,
): Promise<Array<{ id: string; name: string; url: string }>> {
  return withLinearRetry('list team projects', async () => {
    const team = await client.team(teamId);
    if (!team?.id) {
      throw new Error(`Team ${teamId} was not found.`);
    }
    const projects = await team.projects({ first: limit });
    return (projects.nodes ?? []).map((p) => ({ id: p.id, name: p.name, url: p.url }));
  });
}

// ---------------------------------------------------------------------------
// Batched reads
// ---------------------------------------------------------------------------

const ISSUE_STATE_FETCH_CHUNK = 50;

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
export async function fetchTeamWorkflowStates(
  client: LinearClient,
  teamId: string,
): Promise<LinearWorkflowStateSummary[]> {
  return withLinearRetry('fetch team workflow states', async () => {
    const team = await client.team(teamId);
    const states = await team.states();
    return states.nodes.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
    }));
  });
}

/**
 * Fetch the team's `issueEstimationType` in one round-trip. Used by `planr
 * linear push` to decide whether (and how) to map OpenPlanr `storyPoints` to
 * Linear's native estimate field.
 *
 * Returns `'notUsed'` when the team has estimation disabled — push then
 * skips the field silently.
 */
export async function fetchTeamIssueEstimationType(
  client: LinearClient,
  teamId: string,
): Promise<string> {
  return withLinearRetry('fetch team estimation type', async () => {
    const team = await client.team(teamId);
    // Linear's SDK exposes this as `issueEstimationType` on Team; defensive
    // fallback to `'notUsed'` keeps push safe when the team shape is
    // unfamiliar (older SDK, mocked client, etc.).
    const value = (team as unknown as { issueEstimationType?: string }).issueEstimationType;
    return value ?? 'notUsed';
  });
}

/**
 * Batched: load each issue's current workflow state **name** (one GraphQL
 * round-trip per chunk).
 */
export async function fetchLinearIssueStateNames(
  client: LinearClient,
  issueIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(issueIds.map((i) => i.trim()).filter(Boolean))];
  for (let i = 0; i < unique.length; i += ISSUE_STATE_FETCH_CHUNK) {
    const chunk = unique.slice(i, i + ISSUE_STATE_FETCH_CHUNK);
    const result = await withLinearRetry('fetch issue states', async () => {
      const connection = await client.issues({
        filter: { id: { in: chunk } },
        first: chunk.length,
      });
      return connection;
    });
    for (const issue of result.nodes) {
      const st = await issue.state;
      const name = st?.name?.trim() ?? '';
      if (name) {
        out.set(issue.id, name);
      }
    }
  }
  return out;
}

export async function getLinearIssueDescription(
  client: LinearClient,
  issueId: string,
): Promise<string> {
  return withLinearRetry('load issue', async () => {
    const issue = await client.issue(issueId);
    return (issue?.description as string | undefined) ?? '';
  });
}

// ---------------------------------------------------------------------------
// Auth / team validation
// ---------------------------------------------------------------------------

/** Resolves the current user; throws if the token is invalid or lacks API access. */
export async function validateToken(client: LinearClient): Promise<LinearViewerSummary> {
  try {
    const user = await client.viewer;
    if (!user?.id) {
      throw new Error('Linear API returned an empty viewer — check your personal access token.');
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
    };
  } catch (err) {
    throw mapLinearError(err, 'validating token');
  }
}

/** Teams the authenticated user can access (first page, up to 100). */
export async function getAvailableTeams(client: LinearClient): Promise<LinearTeamOption[]> {
  try {
    const connection = await client.teams({ first: 100 });
    const nodes = connection.nodes ?? [];
    return nodes.map((t) => ({ id: t.id, name: t.name, key: t.key }));
  } catch (err) {
    throw mapLinearError(err, 'loading teams');
  }
}

/**
 * Verifies the team exists and the token can read it (incl. project listing).
 * Catches inaccessible teams and read failures before write mutations fail
 * mid-flight with confusing GraphQL errors.
 */
export async function validateTeamAccess(
  client: LinearClient,
  teamId: string,
): Promise<{ name: string; key: string }> {
  try {
    const team = await client.team(teamId);
    if (!team?.id) {
      throw new Error(
        `Team ${teamId} was not found or your token cannot access it. Ensure the PAT has read scope for teams and projects.`,
      );
    }
    await team.projects({ first: 1 });
    return { name: team.name, key: team.key };
  } catch (err) {
    throw mapLinearError(err, 'checking team access');
  }
}
