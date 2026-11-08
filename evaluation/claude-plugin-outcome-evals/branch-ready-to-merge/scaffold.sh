#!/usr/bin/env bash
# Notes app with a feature branch checked out that adds search, paging and share
# links. The branch carries six defects and three sound decoys; a local
# remote-tracking ref stands in for the hosted repository.
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
commit_at 2026-09-01T09:00:00Z "feat: notes service with per-user notes"
git remote add origin https://github.com/notes-example/notes.git
git update-ref refs/remotes/origin/main HEAD

git checkout -q -b feature/search-share
node -e '
  const fs = require("node:fs");
  const renames = [["present", "toResponse"], ["listFor", "listOwnedBy"], ["HttpError", "RequestError"]];
  for (const file of ["src/server.js", "src/store.js", "src/http.js", "src/auth.js"]) {
    let text = fs.readFileSync(file, "utf8");
    for (const [from, to] of renames) text = text.replaceAll(from, to);
    fs.writeFileSync(file, text);
  }
'
commit_at 2026-10-26T10:00:00Z "refactor: rename response, listing and error helpers

present becomes toResponse, listFor becomes listOwnedBy and HttpError becomes
RequestError. No behaviour change."

cat > src/search.js <<'EOF'
// TODO(#57): highlight the matched text in results.
export function searchNotes(notes, query) {
  const pattern = new RegExp(query, 'i');
  return notes.filter(
    (note) => pattern.test(note.title) || note.body.toLowerCase().includes(query.toLowerCase()),
  );
}

export function paginate(items, page, limit) {
  const start = (page - 1) * limit;
  return items.slice(start, start + limit - 1);
}
EOF
edit src/server.js "import { createNote } from './notes.js';" "import { createNote } from './notes.js';
import { paginate, searchNotes } from './search.js';"
edit src/server.js "      const match = url.pathname.match(" "      if (url.pathname === '/notes/search' && request.method === 'GET') {
        const query = url.searchParams.get('q') ?? '';
        const page = Number(url.searchParams.get('page') ?? 1);
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 100);
        const found = searchNotes(store.listOwnedBy(userId), query);
        return sendJson(response, 200, paginate(found, page, limit).map(toResponse));
      }
      const match = url.pathname.match("
cat >> README.md <<'EOF'

`GET /notes/search?q=<text>&page=<n>&limit=<n>` lists the caller's notes whose
title or body contains the text, title matches first. Pages start at 1;
`limit` defaults to 20 and is capped at 100.
EOF
commit_at 2026-10-27T11:00:00Z "feat: search notes by title and body, with pages

Highlighting the matched text is tracked in #57 and is not part of this change."

cat > src/shares.js <<'EOF'
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const randomToken = async () => (await promisify(randomBytes)(24)).toString('hex');

export function createShares() {
  const byNote = new Map();
  return {
    async create(noteId) {
      const existing = byNote.get(noteId);
      if (existing) return existing;
      const share = { token: await randomToken(), noteId };
      byNote.set(noteId, share);
      return share;
    },
    find(token) {
      return [...byNote.values()].find((share) => share.token === token) ?? null;
    },
  };
}
EOF
edit src/server.js "import { createStore } from './store.js';" "import { createShares } from './shares.js';
import { createStore } from './store.js';"
edit src/server.js "export function createApp(store = createStore()) {" "export function createApp(store = createStore(), shares = createShares()) {"
edit src/server.js "      const match = url.pathname.match(" "      const shareMatch = url.pathname.match(/^\/notes\/([^/]+)\/shares\$/);
      if (shareMatch && request.method === 'POST') {
        const note = requireOwner(store.get(shareMatch[1]), userId);
        const share = await shares.create(note.id);
        return sendJson(response, 201, { token: share.token });
      }
      const match = url.pathname.match("
cat >> README.md <<'EOF'

`POST /notes/:id/shares` returns a share-link token for one of the caller's
notes. A note has at most one link: creating it again returns the same token.
EOF
commit_at 2026-10-27T14:00:00Z "feat: create a share link for a note"

cat > test/search.test.js <<'EOF'
import assert from 'node:assert/strict';
import test from 'node:test';
import { withServer } from './helpers.js';

test('search finds notes by title', async () => {
  await withServer(async (call) => {
    await call('POST', '/notes', { body: { title: 'Quarterly report', body: 'Draft numbers' } });
    await call('GET', '/notes/search?q=report');
  });
});

test('search lists title matches first', async () => {
  await withServer(async (call) => {
    await call('POST', '/notes', { body: { title: 'Budget review', body: 'Numbers for Q4' } });
    await call('POST', '/notes', { body: { title: 'Offsite', body: 'Review the budget' } });
    const found = await call('GET', '/notes/search?q=budget');
    assert.equal(found.body[0].title, 'Budget review');
  });
});
EOF
cat > test/shares.test.js <<'EOF'
import assert from 'node:assert/strict';
import test from 'node:test';
import { withServer } from './helpers.js';

test('creating a link twice returns the same token', async () => {
  await withServer(async (call) => {
    const note = await call('POST', '/notes', { body: { title: 'Plan', body: 'Agenda' } });
    const first = await call('POST', `/notes/${note.body.id}/shares`);
    const second = await call('POST', `/notes/${note.body.id}/shares`);
    assert.equal(first.status, 201);
    assert.equal(second.body.token, first.body.token);
  });
});
EOF
commit_at 2026-10-27T15:30:00Z "test: cover search and share links"
git update-ref refs/remotes/origin/feature/search-share HEAD
git branch -q --set-upstream-to=origin/feature/search-share

# shellcheck source=../_shared/probe.sh
source "$here/../_shared/probe.sh"
