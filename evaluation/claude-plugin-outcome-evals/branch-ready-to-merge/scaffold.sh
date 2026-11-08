#!/usr/bin/env bash
# Notes app with a search feature branch checked out. The branch carries three
# defects; a local remote-tracking ref stands in for the hosted repository.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=../_shared/notes-base.sh
source "$here/../_shared/notes-base.sh"

fixture_init
write_notes_base
commit_at 2026-09-01T09:00:00Z "feat: notes service with per-user notes"
git remote add origin https://github.com/notes-example/notes.git
git update-ref refs/remotes/origin/main HEAD

git checkout -q -b feature/search
cat > src/search.js <<'EOF'
export function searchNotes(notes, query) {
  const pattern = new RegExp(query, 'i');
  return notes.filter(
    (note) => pattern.test(note.title) || note.body.toLowerCase().includes(query.toLowerCase()),
  );
}
EOF
node - <<'EOF'
const { readFileSync, writeFileSync } = require('node:fs');
let server = readFileSync('src/server.js', 'utf8');
server = server.replace(
  "import { createNote } from './notes.js';",
  "import { createNote } from './notes.js';\nimport { searchNotes } from './search.js';",
);
server = server.replace(
  "      const match = url.pathname.match(",
  "      if (url.pathname === '/notes/search' && request.method === 'GET') {\n" +
    "        const query = url.searchParams.get('q') ?? '';\n" +
    "        return sendJson(response, 200, searchNotes(store.listFor(userId), query).map(present));\n" +
    "      }\n" +
    "      const match = url.pathname.match(",
);
writeFileSync('src/server.js', server);
EOF
commit_at 2026-10-27T14:00:00Z "feat: search notes by title and body"

cat > test/search.test.js <<'EOF'
import test from 'node:test';
import { withServer } from './helpers.js';

test('search finds notes by title', async () => {
  await withServer(async (call) => {
    await call('POST', '/notes', { body: { title: 'Quarterly report', body: 'Draft numbers' } });
    await call('GET', '/notes/search?q=report');
  });
});
EOF
cat >> README.md <<'EOF'

`GET /notes/search?q=<text>` lists the caller's notes whose title or body
contains the text.
EOF
commit_at 2026-10-27T15:30:00Z "test: cover note search"
git update-ref refs/remotes/origin/feature/search HEAD
git branch -q --set-upstream-to=origin/feature/search

# shellcheck source=../_shared/probe.sh
source "$here/../_shared/probe.sh"
