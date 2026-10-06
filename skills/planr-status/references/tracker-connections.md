# GitHub and Linear connections

These skills store and read no GitHub or Linear credentials. Remote steps run through a
connection the host already has; the planning files stay the source of truth.

## Use the host's connection

- **Linear:** the host's Linear connection, whose tools read, create and update issues.
- **GitHub:** the host's GitHub connection, or the GitHub CLI when
  `gh auth status --hostname github.com` succeeds.

Never ask the user for a token, read one from the environment or a file, or put one in a
command, URL or file.

## When a connection is missing

Finish the local work first. Then report the remote step as not run and give the one
line for the current host:

| Host | Linear | GitHub |
| --- | --- | --- |
| Claude Code | Run `/plugin install linear@claude-plugins-official`, then sign in to Linear from `/mcp`. | Install the GitHub CLI (cli.github.com) and run `gh auth login`. |
| Codex | Run `codex mcp add linear --url https://mcp.linear.app/mcp`, then `codex mcp login linear`. | Install the GitHub plugin from `/plugins`, or run `gh auth login`. |
| Cursor | Add Linear from the Cursor Marketplace and sign in to Linear. | Install the GitHub CLI (cli.github.com) and run `gh auth login`. |

Ask the user to try again once connected; never retry the remote step on your own.

## Status mapping

| Local status | Linear workflow state | GitHub issue |
| --- | --- | --- |
| `planning`, `pending` | Unstarted (for example Todo) | open |
| `in-progress` | Started (for example In Progress) | open |
| `done` | Completed (for example Done) | closed |
| Backlog `open` | Backlog, else Unstarted | open |
| Backlog `closed` | Completed | closed |
| Backlog `promoted` | Leave as it is | Leave as it is |

When reading state back, write only a status the item's type allows. A backlog item takes
`open` or `closed` and keeps `promoted`.

- Linear Completed or Canceled sets `done`, or `closed` for a backlog item. Started sets
  `in-progress`, and Triage, Backlog or Unstarted sets `planning` for features and stories
  and `pending` for quick tasks; a backlog item takes `open` from any of these. Epics and
  task files keep their status.
- A closed GitHub issue sets `done`, or `closed` for a backlog item. An open issue sets
  `in-progress` for a `done` item and `open` for a `closed` backlog item; other statuses
  stay as they are.

## Links

A linked item records its tracker identity in frontmatter. Update a linked item through
that identity instead of creating another, and record the identity of everything you
create.

- **GitHub:** each item is one issue, recorded as `githubIssue`.
- **Linear:** use the shapes the OpenPlanr CLI uses, so its later pushes reuse what you
  create:
  - An epic is a Linear project (`linearProjectId`, `linearProjectIdentifier`,
    `linearProjectUrl`). When its `linearMappingStrategy` is `milestone-of` or `label-on`,
    it is a milestone in an existing project (`linearMilestoneId`) or a team label
    (`linearLabelId`) instead, and every issue under it carries that milestone
    (`linearProjectMilestoneId`) or label (`linearLabelIds`).
  - A feature, quick task or backlog item is one issue (`linearIssueId`,
    `linearIssueIdentifier`, `linearIssueUrl`). A story is a sub-issue of its feature's
    issue (`linearParentIssueId`).
  - All task files of one feature share one task-list issue: a sub-issue of the feature's
    issue whose checklist merges every task file, recorded in each task file. Its state is
    Completed when every task file is `done`, Unstarted when every one is `pending`, and
    Started otherwise.
