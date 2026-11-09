# Backlog filing

List and file backlog items with your own file tools. If `openplanr` is already on
`PATH`, you may instead send each item as one JSON object on stdin to
`openplanr --project-dir <repository-root> backlog add --data - --json`.

## Where items live

1. Read `.planr/config.json` at the repository root. If it is missing or is not
   valid JSON, stop and report that the project has no OpenPlanr configuration.
2. The backlog folder is `<outputPaths.agile>/backlog`, with `outputPaths.agile`
   defaulting to `.planr`. The ID prefix is `idPrefix.backlog`, default `BL`.
3. Issued IDs are empty marker files in `<backlog folder>/.issued-ids/`.

## List open items

List the files named `<PREFIX>-NNN-<slug>.md` in the backlog folder and read each
frontmatter's `id`, `title` and `status`. An item is open unless its `status` is
`closed` or `done`; a missing `status` counts as open.

## Take an ID

Do this immediately before writing each item, never earlier in the run:

1. List the backlog folder and `.issued-ids/` again; create `.issued-ids/` if it is
   missing.
2. Find the highest `<PREFIX>-NNN` number among the file names in both. The new
   number is that plus 1, or 1 when there is none, padded to at least 3 digits
   (`BL-007`, `BL-1000`).
3. Claim it by creating the empty file `.issued-ids/<ID>`. In a POSIX shell use a
   no-clobber create, `(set -C; : > '<backlog folder>/.issued-ids/<ID>')`, or
   elsewhere any create that fails when the file already exists, and treat a
   failure as the ID being taken.
4. If the marker already existed or any `<ID>-*.md` file exists, take the next
   number and repeat step 3.

Never overwrite or edit an existing backlog file or marker. A marker outlives its
item, so the ID of a deleted item is never issued again.

## Write the item

Name the file `<ID>-<slug>.md` in the backlog folder. The slug is the title in
lowercase with every character other than ASCII letters, digits, `_`, `-` and
whitespace removed, runs of whitespace, `_` and `-` turned into one `-`, and
leading or trailing `-` removed. When it is longer than 80 characters, cut it at 80, then back to the last
`-`.

The frontmatter needs every field below. Scalar values are double-quoted JSON strings;
arrays use the flow form shown in the example:

- `id`: the claimed ID.
- `title`: one line.
- `priority`: `critical`, `high`, `medium` or `low`.
- `tags`: a list of quoted strings, `[]` when there are none.
- `status`: `"open"`.
- `created` and `updated`: today's date as `YYYY-MM-DD`.
- `when`: `next-unit:<ref>`, `sprint:<SPRINT-NNN or next>`, `trigger:<event>`, or
  `declined:<reason>`. Use a PR number, task ID, backlog ID, or branch for `<ref>`.
  Never store `now`; it is a triage outcome. Trigger forms include
  `date:YYYY-MM-DD`, `closed:<BL-NNN>`, `merged:#<PR>`, `merged:<branch>`, and
  `release:<pkg>@<semver>`; other non-empty event text is allowed.
- `files`: a list of quoted repo-relative paths, such as `["src/routes/import.ts"]`.
  Omit line numbers, absolute paths and `..` segments. Use distinct paths from
  the evidence, or `[]` when there are none.

Older items may omit `when` and `files`. When listing them, derive files from
body evidence such as `src/routes/import.ts:41` only if `files` is absent.

The body is `# <ID>: <title>`, then `## Tags` with one `- <tag>` line per tag
(omitted when there are none), then the description. A description that starts
with its own `##` sections stands as written; otherwise it goes under
`## Description`. End with a `---` line and the close line.

```markdown
---
id: "BL-007"
title: "Import endpoint has no rate limit"
priority: "medium"
tags: ["security", "api"]
status: "open"
created: "2026-11-08"
updated: "2026-11-08"
when: "next-unit:#612"
files: ["src/routes/import.ts"]
---

# BL-007: Import endpoint has no rate limit

## Tags

- security
- api

## Problem

`/import` accepts unlimited requests (`src/routes/import.ts:41`).

---
_Close when done: `openplanr backlog update BL-007 --status closed`_
```

Report the ID and the repo-relative path of each filed item.
