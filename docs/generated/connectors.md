# Connectors

OpenPlanr skills name a kind of service, such as `~~chat`, instead of a product. Connect
the product your team uses through your host: the vendor publishes the connector, and
you sign in through the host. OpenPlanr bundles no connectors; they and their credentials
live in your host. Where OpenPlanr stores a sign-in for its optional Linear sync is described
in the Connections section of the OpenPlanr README.
Every skill also works with nothing connected and reports any remote step it skipped.

| Category | Placeholder | Products |
| --- | --- | --- |
| Chat | `~~chat` | Slack, Microsoft Teams |
| Project tracker | `~~project tracker` | Linear, GitHub Issues, Jira, Asana |
| Source control | `~~source control` | GitHub, GitLab, Bitbucket |

Never paste a token into a chat, file or command for OpenPlanr. After you connect a
service, start a new request so the host loads its tools.

## Chat (`~~chat`)

Share a status report, sprint note or release notes as a message draft that you review and send yourself.

| Product | Use | Claude Code | Codex | Cursor |
| --- | --- | --- | --- | --- |
| Slack | Message drafts | Run `/plugin install slack@claude-plugins-official`, then sign in to Slack from `/mcp`. A workspace admin may need to approve the app. | Install Slack from `/plugins` and sign in when asked. A workspace admin may need to approve the app. | Run `/add-plugin slack`, or install Slack from Customize, then sign in when asked. A workspace admin may need to approve the app. |

Message format for Slack, drafting through the connector: standard Markdown, which the connector converts on send ([Slack's messaging guidance](https://github.com/slackapi/slack-mcp-plugin/blob/main/skills/slack-messaging/SKILL.md)): `**bold**`, `_italic_`, `[link text](https://example.com)`, `-` lists, `>` quotes. Do not use mrkdwn's `*bold*` or `<url|text>` here.

Message format for Slack, text to paste: Slack mrkdwn ([formatting](https://docs.slack.dev/messaging/formatting-message-text)): `*bold*`, `_italic_`, `<https://example.com|link text>`, lines starting with `•` or `-` for lists, `>` for quotes; no headings or tables; escape `&`, `<` and `>` as `&amp;`, `&lt;` and `&gt;`.

Also works with: [Microsoft Teams](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-teams-tools) (read for context). Add the vendor's connector in your host the same way.

Verified: [Slack](https://docs.slack.dev/ai/slack-mcp-server) on 2026-10-09, [Microsoft Teams](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-teams-tools) on 2026-10-09.

## Project tracker (`~~project tracker`)

Push planning status to linked issues after you approve each change, and read issue state back.

| Product | Use | Claude Code | Codex | Cursor |
| --- | --- | --- | --- | --- |
| Linear | OpenPlanr syncs with it | Run `/plugin install linear@claude-plugins-official`, then sign in to Linear from `/mcp`. | Install Linear from `/plugins` and sign in when asked. | Run `/add-plugin linear`, or install Linear from Customize, then sign in when asked. |
| GitHub Issues | OpenPlanr syncs with it | Run `/plugin install github@claude-plugins-official` and follow GitHub's setup for it. | Install GitHub from `/plugins` and sign in when asked. | Add GitHub's MCP server in Cursor's MCP settings, following [GitHub's Cursor guide](https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-cursor.md). |

Also works with: [Jira](https://support.atlassian.com/atlassian-ai-gateway/docs/get-started-with-the-atlassian-remote-mcp-server/) (read for context), [Asana](https://developers.asana.com/docs/using-asanas-mcp-server) (read for context). Add the vendor's connector in your host the same way.

Verified: [Linear](https://linear.app/docs/mcp) on 2026-10-09, [GitHub Issues](https://github.com/github/github-mcp-server) on 2026-11-10, [Jira](https://support.atlassian.com/atlassian-ai-gateway/docs/get-started-with-the-atlassian-remote-mcp-server/) on 2026-10-09, [Asana](https://developers.asana.com/docs/using-asanas-mcp-server) on 2026-10-09.

## Source control (`~~source control`)

Read pull request and branch state for status reports and sprint reviews.

| Product | Use | Claude Code | Codex | Cursor |
| --- | --- | --- | --- | --- |
| GitHub | Read for context | Run `/plugin install github@claude-plugins-official` and follow GitHub's setup for it. | Install GitHub from `/plugins` and sign in when asked. | Add GitHub's MCP server in Cursor's MCP settings, following [GitHub's Cursor guide](https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-cursor.md). |

Also works with: [GitLab](https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/) (read for context), [Bitbucket](https://support.atlassian.com/atlassian-ai-gateway/docs/get-started-with-the-atlassian-remote-mcp-server/) (read for context). Add the vendor's connector in your host the same way.

Verified: [GitHub](https://github.com/github/github-mcp-server) on 2026-11-10, [GitLab](https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/) on 2026-10-09, [Bitbucket](https://support.atlassian.com/atlassian-ai-gateway/docs/get-started-with-the-atlassian-remote-mcp-server/) on 2026-10-09.
