/**
 * `ensureIssueLabel` — label lookup must match Linear's own uniqueness rule.
 *
 * Regression for the real user report: pushing `EPIC-001` failed with
 * `Linear error while ensure label (InvalidInput): Label "Feature" already
 * exists in the workspace`. Root cause: we searched for `name: { eq: "feature" }`
 * (case-sensitive) scoped to the current team; Linear's uniqueness is
 * case-insensitive and workspace-wide. Our lookup missed the existing
 * label and then `createIssueLabel` hit the API-side conflict.
 */

import type { LinearClient } from '@linear/sdk';
import { describe, expect, it, vi } from 'vitest';
import { ensureIssueLabel } from '../../src/services/linear-service.js';

function makeClient(opts: {
  teamScopedHit?: { id: string; name: string };
  workspaceHit?: { id: string; name: string };
}) {
  const issueLabels = vi.fn(async (args: { filter?: Record<string, unknown> }) => {
    const filter = args.filter ?? {};
    const hasTeamFilter = 'team' in filter;
    if (hasTeamFilter && opts.teamScopedHit) {
      return { nodes: [opts.teamScopedHit] };
    }
    if (!hasTeamFilter && opts.workspaceHit) {
      return { nodes: [opts.workspaceHit] };
    }
    return { nodes: [] };
  });
  const createIssueLabel = vi.fn(async () => ({
    success: true,
    issueLabelId: 'created-uuid-1',
  }));
  const client = { issueLabels, createIssueLabel } as unknown as LinearClient;
  return { client, issueLabels, createIssueLabel };
}

describe('ensureIssueLabel — case + scope semantics', () => {
  it('reuses a team-scoped label when present (case-insensitive)', async () => {
    const { client, issueLabels, createIssueLabel } = makeClient({
      teamScopedHit: { id: 'team-label-1', name: 'Feature' },
    });

    const result = await ensureIssueLabel(client, { teamId: 'T', name: 'feature' });

    expect(result).toEqual({ id: 'team-label-1', name: 'Feature' });
    expect(createIssueLabel).not.toHaveBeenCalled();
    // First call is team-scoped using eqIgnoreCase
    const firstFilter = (issueLabels.mock.calls[0]?.[0] as { filter: Record<string, unknown> })
      ?.filter;
    expect(firstFilter).toMatchObject({
      team: { id: { eq: 'T' } },
      name: { eqIgnoreCase: 'feature' },
    });
  });

  it('falls back to a workspace-wide label when no team-scoped match exists (the real user bug)', async () => {
    // This is the exact scenario: "feature" doesn't exist on this team, but
    // "Feature" exists somewhere else in the workspace. Before the fix we
    // tried to create it and Linear rejected with "already exists in the
    // workspace". After the fix we adopt the workspace-wide label.
    const { client, issueLabels, createIssueLabel } = makeClient({
      workspaceHit: { id: 'workspace-label-42', name: 'Feature' },
    });

    const result = await ensureIssueLabel(client, { teamId: 'T', name: 'feature' });

    expect(result).toEqual({ id: 'workspace-label-42', name: 'Feature' });
    expect(createIssueLabel).not.toHaveBeenCalled();
    // Two searches: team-scoped first (empty), then workspace-wide
    expect(issueLabels).toHaveBeenCalledTimes(2);
    const secondFilter = (issueLabels.mock.calls[1]?.[0] as { filter: Record<string, unknown> })
      ?.filter;
    expect(secondFilter).toMatchObject({ name: { eqIgnoreCase: 'feature' } });
    expect(secondFilter).not.toHaveProperty('team');
  });

  it('creates a new label when no match exists in team or workspace', async () => {
    const { client, issueLabels, createIssueLabel } = makeClient({});

    const result = await ensureIssueLabel(client, {
      teamId: 'T',
      name: 'brand-new-label',
      color: '#ffffff',
    });

    expect(result).toEqual({ id: 'created-uuid-1', name: 'brand-new-label' });
    expect(issueLabels).toHaveBeenCalledTimes(2); // team-scoped + workspace-wide
    expect(createIssueLabel).toHaveBeenCalledTimes(1);
    expect(createIssueLabel.mock.calls[0]?.[0]).toMatchObject({
      teamId: 'T',
      name: 'brand-new-label',
      color: '#ffffff',
    });
  });
});
