#!/usr/bin/env bash
# Notes app tagged v1.3.0 and v1.4.0, then thirteen commits: user-facing changes
# (one removes an endpoint, one hides a new limit in a refactor, one states a
# breaking change only in its footer), a feature and its revert, three chores
# and one test-only change.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=../_shared/notes-base.sh
source "$here/../_shared/notes-base.sh"

# edit <file> <search> <replacement>: replace the first exact occurrence or fail.
edit() {
  node -e '
    const fs = require("node:fs");
    const [file, search, replacement] = process.argv.slice(1);
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes(search)) throw new Error(`${file} does not contain: ${search}`);
    fs.writeFileSync(file, text.replace(search, replacement));
  ' "$@"
}

fixture_init
write_notes_base
edit package.json '"version": "1.4.0"' '"version": "1.3.0"'
commit_at 2026-07-01T09:00:00Z "feat: notes service with per-user notes"
tag_at 2026-07-01T09:05:00Z v1.3.0

cat > src/export.js <<'EOF'
export function toCsv(notes) {
  const rows = notes.map((note) =>
    [note.id, note.title, note.due ?? '', note.done].map((cell) => JSON.stringify(String(cell))).join(','),
  );
  return ['id,title,due,done', ...rows].join('\n');
}
EOF
edit src/server.js "import { createNote } from './notes.js';" "import { toCsv } from './export.js';
import { createNote } from './notes.js';"
edit src/server.js "      const match = url.pathname.match(" "      if (url.pathname === '/notes/export' && request.method === 'GET') {
        response.writeHead(200, { 'content-type': 'text/csv' });
        return response.end(toCsv(store.listFor(userId)));
      }
      const match = url.pathname.match("
edit README.md "| DELETE | /notes/:id    | Delete one of the caller's notes         |" "| DELETE | /notes/:id    | Delete one of the caller's notes         |
| GET    | /notes/export | Download the caller's notes as CSV       |"
edit package.json '"version": "1.3.0"' '"version": "1.4.0"'
commit_at 2026-08-15T09:00:00Z "feat: export notes as CSV"
tag_at 2026-08-15T09:05:00Z v1.4.0

edit src/server.js "        return sendJson(response, 200, store.listFor(userId).map(present));" "        const done = url.searchParams.get('done');
        const notes = store
          .listFor(userId)
          .filter((note) => done === null || String(note.done) === done);
        return sendJson(response, 200, notes.map(present));"
edit README.md "| GET    | /notes        | List the caller's notes                  |" "| GET    | /notes        | List the caller's notes (\`?done=true\`)   |"
commit_at 2026-08-20T10:00:00Z "feat: filter the note list by done status"

cat > .editorconfig <<'EOF'
root = true

[*]
indent_style = space
indent_size = 2
insert_final_newline = true
EOF
commit_at 2026-08-22T10:00:00Z "chore: add editorconfig"

edit src/server.js "import { formatDueDate } from './dates.js';" "import { formatDueDate, parseDueDate } from './dates.js';"
edit src/server.js "          const changes = {};" "          if ('due' in input) parseDueDate(input.due);
          const changes = {};"
commit_at 2026-08-25T10:00:00Z "fix: reject updates with an invalid due date"

node -e '
  const fs = require("node:fs");
  const text = fs.readFileSync("src/server.js", "utf8");
  fs.writeFileSync("src/server.js", text.replaceAll("present", "toResponse"));
'
commit_at 2026-08-28T10:00:00Z "chore: rename the response helper"

node -e '
  const fs = require("node:fs");
  const text = fs.readFileSync("src/notes.js", "utf8");
  const before = `  if (typeof title !== "string" || title.trim() === "") {
    throw new TypeError("A note needs a title");
  }
`.replaceAll("\"", "\x27");
  const after = `  validateTitle(title);
`;
  if (!text.includes(before)) throw new Error("src/notes.js: title check not found");
  const helper = `function validateTitle(title) {
  if (typeof title !== "string" || title.trim() === "") {
    throw new TypeError("A note needs a title");
  }
  if (title.trim().length > 120) {
    throw new TypeError("A title has at most 120 characters");
  }
}

`.replaceAll("\"", "\x27");
  fs.writeFileSync("src/notes.js", text.replace(before, after).replace("export function createNote", helper + "export function createNote"));
'
commit_at 2026-08-30T10:00:00Z "refactor: extract title validation"

rm src/export.js
edit src/server.js "import { toCsv } from './export.js';
" ""
edit src/server.js "      if (url.pathname === '/notes/export' && request.method === 'GET') {
        response.writeHead(200, { 'content-type': 'text/csv' });
        return response.end(toCsv(store.listFor(userId)));
      }
" ""
edit README.md "
| GET    | /notes/export | Download the caller's notes as CSV       |" ""
commit_at 2026-09-02T10:00:00Z "feat!: remove the CSV export endpoint

BREAKING CHANGE: GET /notes/export is gone. Clients that need CSV should
call GET /notes and convert the JSON themselves."

edit src/server.js "          .filter((note) => done === null || String(note.done) === done);" "          .filter((note) => done === null || String(note.done) === done)
          .sort((a, b) => (a.due ?? '9999-99-99').localeCompare(b.due ?? '9999-99-99'));"
edit README.md "| GET    | /notes        | List the caller's notes (\`?done=true\`)   |" "| GET    | /notes        | List notes, soonest due first (\`?done\`)  |"
commit_at 2026-09-05T10:00:00Z "feat: list notes soonest due first"

edit src/notes.js "    done: false," "    done: false,
    pinned: options.pinned === true,"
edit src/server.js "{ due: input.due }" "{ due: input.due, pinned: input.pinned }"
edit README.md "| POST   | /notes        | Create a note \`{title, body, due?}\`      |" "| POST   | /notes        | Create a note \`{title, body, due?, pinned?}\` |"
commit_at 2026-09-06T10:00:00Z "feat: pin notes when creating them"
GIT_AUTHOR_DATE=2026-09-08T10:00:00Z GIT_COMMITTER_DATE=2026-09-08T10:00:00Z git revert --no-edit HEAD >/dev/null

cat > test/update.test.js <<'EOF'
import assert from 'node:assert/strict';
import test from 'node:test';
import { withServer } from './helpers.js';

test('an update with an invalid due date is rejected', async () => {
  await withServer(async (call) => {
    const created = await call('POST', '/notes', { body: { title: 'Taxes' } });
    const updated = await call('PATCH', `/notes/${created.body.id}`, { body: { due: 'soon' } });
    assert.equal(updated.status, 400);
  });
});
EOF
commit_at 2026-09-09T10:00:00Z "test: cover due date validation on update"

mkdir -p .github/workflows
cat > .github/workflows/test.yml <<'EOF'
name: test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm test
EOF
commit_at 2026-09-12T10:00:00Z "chore: run tests in CI"

edit src/server.js "            if (key in input) changes[key] = input[key];" "            if (key in input) changes[key] = key === 'title' ? String(input.title).trim() : input[key];"
commit_at 2026-09-15T10:00:00Z "fix: trim note titles on update"

edit src/server.js "          if ('due' in input) parseDueDate(input.due);" "          if ('due' in input) parseDueDate(input.due);
          if ('done' in input && typeof input.done !== 'boolean') {
            throw new TypeError('done must be true or false');
          }"
commit_at 2026-09-18T10:00:00Z "fix: validate the done flag on update

PATCH /notes/:id stored whatever value it was given for done.

BREAKING CHANGE: PATCH /notes/:id now returns 400 when done is not true or
false. Clients that send \"true\" as a string must send a boolean."

# shellcheck source=../_shared/probe.sh
source "$here/../_shared/probe.sh"
