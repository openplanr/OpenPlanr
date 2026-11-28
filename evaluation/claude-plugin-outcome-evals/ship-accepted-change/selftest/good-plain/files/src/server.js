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
        const note = createNote(input.title, input.body, { due: input.due, tags: input.tags });
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
