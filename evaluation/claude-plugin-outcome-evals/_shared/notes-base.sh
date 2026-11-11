# Sourced by case scaffolds: the shared "notes" app and deterministic git helpers.
# shellcheck shell=bash

export GIT_AUTHOR_NAME="Dana Reyes" GIT_AUTHOR_EMAIL=dana@notes.example
export GIT_COMMITTER_NAME="Dana Reyes" GIT_COMMITTER_EMAIL=dana@notes.example
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null TZ=UTC

fixture_init() {
  git init -q -b main
  git config user.name "Dana Reyes"
  git config user.email dana@notes.example
  git config commit.gpgsign false
  git config tag.gpgsign false
}

# commit_at <ISO date> <message...>: stage everything and commit at a fixed date.
commit_at() {
  local when=$1
  shift
  git add -A
  GIT_AUTHOR_DATE=$when GIT_COMMITTER_DATE=$when git commit -q -m "$*"
}

# tag_at <ISO date> <tag>: annotated tag at a fixed date.
tag_at() {
  GIT_COMMITTER_DATE=$1 git tag -a "$2" -m "$2"
}

write_notes_base() {
  mkdir -p src test

  cat > package.json <<'EOF'
{
  "name": "notes",
  "version": "1.4.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test"
  }
}
EOF

  cat > README.md <<'EOF'
# Notes

A small notes service for teams. Each note belongs to one user. Requests name
the user with the `x-user-id` header; there are no passwords in this service,
the gateway in front of it authenticates people.

## Run

    npm start        # listens on PORT or 3000
    npm test         # node --test

## API

| Method | Path          | Purpose                                  |
|--------|---------------|------------------------------------------|
| GET    | /notes        | List the caller's notes                  |
| POST   | /notes        | Create a note `{title, body, due?}`      |
| GET    | /notes/:id    | Read one of the caller's notes           |
| PATCH  | /notes/:id    | Update title, body, due or done          |
| DELETE | /notes/:id    | Delete one of the caller's notes         |

Due dates are calendar dates (`YYYY-MM-DD`) with no time of day.

## Layout

- `src/server.js` HTTP routing
- `src/http.js` JSON request and response helpers
- `src/auth.js` caller identity and ownership checks
- `src/notes.js` note construction and validation
- `src/store.js` in-memory note storage
- `src/dates.js` due-date parsing and formatting
EOF

  cat > src/http.js <<'EOF'
export async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (text === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
}

export function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
EOF

  cat > src/auth.js <<'EOF'
import { HttpError } from './http.js';

export function requireUser(request) {
  const userId = request.headers['x-user-id'];
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new HttpError(401, 'Missing x-user-id header');
  }
  return userId.trim();
}

export function requireOwner(note, userId) {
  if (!note || note.ownerId !== userId) throw new HttpError(404, 'Note not found');
  return note;
}
EOF

  cat > src/dates.js <<'EOF'
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseDueDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new TypeError(`Due date must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
  }
  return new Date(value);
}

function pad(number) {
  return String(number).padStart(2, '0');
}

export function formatDueDate(value) {
  const date = parseDueDate(value);
  if (date === null) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
EOF

  cat > src/notes.js <<'EOF'
import { parseDueDate } from './dates.js';

export function createNote(title, body, options = {}) {
  if (typeof title !== 'string' || title.trim() === '') {
    throw new TypeError('A note needs a title');
  }
  parseDueDate(options.due);
  return {
    title: title.trim(),
    body: typeof body === 'string' ? body : null,
    due: options.due ?? null,
    done: false,
  };
}
EOF

  cat > src/store.js <<'EOF'
export function createStore() {
  const notes = new Map();
  let nextId = 1;

  return {
    add(ownerId, note) {
      const stored = { id: String(nextId++), ownerId, ...note };
      notes.set(stored.id, stored);
      return stored;
    },
    get(id) {
      return notes.get(id) ?? null;
    },
    listFor(ownerId) {
      return [...notes.values()].filter((note) => note.ownerId === ownerId);
    },
    update(id, changes) {
      const current = notes.get(id);
      if (!current) return null;
      const updated = { ...current, ...changes, id: current.id, ownerId: current.ownerId };
      notes.set(id, updated);
      return updated;
    },
    remove(id) {
      return notes.delete(id);
    },
  };
}
EOF

  cat > src/server.js <<'EOF'
import { createServer } from 'node:http';
import { requireOwner, requireUser } from './auth.js';
import { formatDueDate } from './dates.js';
import { HttpError, readJson, sendJson } from './http.js';
import { createNote } from './notes.js';
import { createStore } from './store.js';

function present(note) {
  return { ...note, due: formatDueDate(note.due) || null };
}

export function createApp(store = createStore()) {
  return async function handle(request, response) {
    try {
      const url = new URL(request.url, 'http://localhost');
      const userId = requireUser(request);
      const match = url.pathname.match(/^\/notes(?:\/([^/]+))?$/);
      if (!match) throw new HttpError(404, 'Not found');
      const id = match[1];

      if (!id && request.method === 'GET') {
        return sendJson(response, 200, store.listFor(userId).map(present));
      }
      if (!id && request.method === 'POST') {
        const input = await readJson(request);
        const note = createNote(input.title, input.body, { due: input.due });
        return sendJson(response, 201, present(store.add(userId, note)));
      }
      if (id) {
        const note = requireOwner(store.get(id), userId);
        if (request.method === 'GET') return sendJson(response, 200, present(note));
        if (request.method === 'PATCH') {
          const input = await readJson(request);
          const changes = {};
          for (const key of ['title', 'body', 'due', 'done']) {
            if (key in input) changes[key] = input[key];
          }
          return sendJson(response, 200, present(store.update(note.id, changes)));
        }
        if (request.method === 'DELETE') {
          store.remove(note.id);
          response.writeHead(204);
          return response.end();
        }
      }
      throw new HttpError(405, 'Method not allowed');
    } catch (error) {
      if (error instanceof HttpError) return sendJson(response, error.status, { error: error.message });
      if (error instanceof TypeError) return sendJson(response, 400, { error: error.message });
      throw error;
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  createServer(createApp()).listen(port, () => {
    process.stdout.write(`notes listening on ${port}\n`);
  });
}
EOF

  cat > test/helpers.js <<'EOF'
import { createServer } from 'node:http';
import { createApp } from '../src/server.js';

export async function withServer(run, store) {
  const server = createServer(createApp(store));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const call = async (method, path, { user = 'ana', body } = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'x-user-id': user, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  try {
    return await run(call);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
EOF

  cat > test/notes.test.js <<'EOF'
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNote } from '../src/notes.js';

test('a note keeps a trimmed title', () => {
  assert.equal(createNote('  Groceries ', 'milk').title, 'Groceries');
});

test('a note without a title is rejected', () => {
  assert.throws(() => createNote('  ', 'milk'), TypeError);
});

test('a malformed due date is rejected', () => {
  assert.throws(() => createNote('Taxes', '', { due: '10/03/2026' }), TypeError);
});
EOF

  cat > test/dates.test.js <<'EOF'
import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDueDate, parseDueDate } from '../src/dates.js';

test('an empty due date formats as an empty string', () => {
  assert.equal(formatDueDate(null), '');
  assert.equal(parseDueDate(''), null);
});

test('a due date must be YYYY-MM-DD', () => {
  assert.throws(() => parseDueDate('2026-3-1'), TypeError);
});
EOF

  cat > test/server.test.js <<'EOF'
import assert from 'node:assert/strict';
import test from 'node:test';
import { withServer } from './helpers.js';

test('a caller can create and list notes', async () => {
  await withServer(async (call) => {
    const created = await call('POST', '/notes', { body: { title: 'Plan offsite', body: 'Book rooms' } });
    assert.equal(created.status, 201);
    const listed = await call('GET', '/notes');
    assert.deepEqual(
      listed.body.map((note) => note.title),
      ['Plan offsite'],
    );
  });
});

test("a caller cannot read someone else's note", async () => {
  await withServer(async (call) => {
    const created = await call('POST', '/notes', { body: { title: 'Private' } });
    const read = await call('GET', `/notes/${created.body.id}`, { user: 'ben' });
    assert.equal(read.status, 404);
  });
});

test('requests without a user are refused', async () => {
  await withServer(async (call) => {
    const read = await call('GET', '/notes', { user: '' });
    assert.equal(read.status, 401);
  });
});
EOF
}
