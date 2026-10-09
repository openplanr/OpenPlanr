# Connections

OpenPlanr skills reach chat, project trackers and source control only through
connections you add to your coding agent. OpenPlanr installs no connector, asks for
no token and stores no credential: each vendor publishes its own connector, and you
sign in through Claude Code, Codex or Cursor.

## Categories

Skills name a kind of service rather than a product:

| Category | Placeholder | What it adds |
| --- | --- | --- |
| Chat | `~~chat` | `share` creates a message draft of a status, sprint or release update, which you send yourself |
| Project tracker | `~~project tracker` | `sync` and `sprint` push status to linked issues after you approve the list of changes; `status` reads issue state on request |
| Source control | `~~source control` | `status` and `sprint` read pull request and branch state |

The products in each category, whether OpenPlanr syncs with them, and the connect
step for each host are listed in [Connectors](generated/connectors.md). The same
list ships as `CONNECTORS.md` in every OpenPlanr plugin.

## Connect a service

Run `/planr:connect` in Claude Code, `$planr:connect` in Codex, or mention the
`planr-connect` rule in Cursor. It reports which categories are connected. For a
missing one it shows the host's Connect card when the host offers connector
suggestions, and otherwise prints the host's step and the vendor's documentation
link. After you sign in, start a new request so the host loads the connector.

Some workspaces require an admin to approve a vendor's app before members can
connect it.

## With nothing connected

Every skill works without connections. Local planning work completes, and the
skill reports any remote step as not run, with the category it needs and the
connect step for your host. `share` prints the update ready to paste.

## Outward actions stay yours

- `share` and `connect` run only when you invoke them. Claude Code and Cursor never
  start them on their own, and Codex does not select them implicitly.
- `share` shows the exact text and destination and creates a draft only after you
  approve. It sends a message only when you explicitly ask it to.
- `sync` and `sprint` list every issue they will create, update, close or reopen,
  and write only on your request or approval.
