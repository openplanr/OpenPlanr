# GitHub and Linear connections

OpenPlanr stores and reads no GitHub or Linear credentials. Remote steps run through a
connection the host already has; the planning files stay the source of truth.

## Use the host's connection

- **Linear:** the host's Linear connection, whose tools read, create and update issues.
- **GitHub:** the host's GitHub connection, or the GitHub CLI when `gh auth status`
  succeeds.

Never ask the user for a token, read one from the environment or a file, or put one in a
command, URL or file.

## When a connection is missing

Finish the local work first. Then report the remote step as not run and give the one
line for the current host:

| Host | Linear | GitHub |
| --- | --- | --- |
| Claude Code | Run `/plugin install linear@claude-plugins-official`, then sign in to Linear from `/mcp`. | Install the GitHub CLI (cli.github.com) and run `gh auth login`. |
| Codex | Run `codex mcp add linear --url https://mcp.linear.app/mcp` and sign in when prompted. | Install the GitHub plugin from `/plugins`, or run `gh auth login`. |
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

When reading state back:

- Linear Completed or Canceled sets `done` (backlog `closed`), Started sets `in-progress`,
  and Triage, Backlog or Unstarted sets `planning` for epics, features and stories and
  `pending` for tasks and quick tasks.
- A closed GitHub issue sets `done`. An open issue for a `done` item sets `in-progress`;
  other statuses stay as they are.

## Links

A linked item records its tracker identity in frontmatter: `linearIssueId`,
`linearIssueIdentifier` and `linearIssueUrl` for a Linear issue, `githubIssue` for a GitHub
issue number. Update a linked item through that identity instead of creating another
issue, and record the identity of every issue you create.
