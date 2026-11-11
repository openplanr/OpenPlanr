import { createServer } from 'node:http';

/**
 * In-memory design workspace host speaking the legacy v1 transport.
 * `fetchImpl` serves in-process callers; `listen()` serves the same state over loopback HTTP.
 */
export function createFakeShareHost({ beforeCreate = () => {} } = {}) {
  const state = {
    revisions: new Map(),
    events: [],
    requests: [],
    failNext: false,
    failAfter: false,
  };
  const fetchImpl = async (url, init = {}) => {
    if (new URL(url).pathname === '/.well-known/openplanr-sharing')
      return new Response(null, { status: 404 });
    const path = new URL(url).pathname.split('/').filter(Boolean),
      route = path[4];
    const body = init.body ? JSON.parse(init.body) : null;
    state.requests.push({ url, init });
    if (state.failNext) {
      state.failNext = false;
      throw new Error('disconnected');
    }
    if (init.method === 'PUT') {
      beforeCreate();
      if (!state.workspace) {
        state.workspace = {
          schemaVersion: body.schemaVersion,
          id: body.id,
          version: 1,
          epoch: 1,
          currentRevision: body.revision.id,
          commentsPaused: false,
          ownerPublicKey: body.ownerPublicKey,
          keyring: body.keyring,
        };
        state.revisions.set(body.revision.id, body.revision);
      }
      if (state.failAfter) {
        state.failAfter = false;
        throw new Error('response lost');
      }
      return Response.json(state.workspace);
    }
    if (route === 'publish' && init.method === 'POST') {
      if (state.conflictNext) {
        state.conflictNext = false;
        state.workspace.version++;
        return new Response('{}', { status: 409 });
      }
      state.workspace.version++;
      state.workspace.currentRevision = body.revision.id;
      state.revisions.set(body.revision.id, body.revision);
      return Response.json(state.workspace);
    }
    if (route === 'rotate') {
      Object.assign(state.workspace, {
        epoch: body.epoch,
        keyring: body.keyring,
        version: state.workspace.version + 1,
      });
      return Response.json(state.workspace);
    }
    if (route === 'manage') {
      if (body.action === 'delete') {
        const { schemaVersion, id } = state.workspace;
        state.workspace = undefined;
        return Response.json({ schemaVersion, id, deleted: true });
      }
      if (body.action === 'pause' || body.action === 'resume')
        state.workspace.commentsPaused = body.action === 'pause';
      state.workspace.version++;
      return Response.json(state.workspace);
    }
    if (route === 'revisions') return Response.json(state.revisions.get(path[5]));
    if (route === 'events') {
      if (init.method === 'POST') {
        let event = state.events.find((event) => event.id === body.id);
        if (!event) {
          event = { ...body, sequence: state.events.length + 1 };
          state.events.push(event);
        }
        if (state.badEventReceipt)
          return Response.json({
            event: { ...event, id: 'changed-receipt-abcdefghijkl' },
            sequence: event.sequence,
          });
        return Response.json({ event, sequence: event.sequence });
      }
      const after = Number(new URL(url).searchParams.get('after'));
      return Response.json({
        events: state.events.filter((item) => item.sequence > after),
        cursor: state.events.length,
        hasMore: false,
      });
    }
    return Response.json(state.workspace);
  };

  async function listen() {
    const server = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined;
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([name, value]) => [
          name === 'authorization' ? 'Authorization' : name,
          String(value),
        ]),
      );
      try {
        const response = await fetchImpl(`http://127.0.0.1:${server.address().port}${req.url}`, {
          method: req.method,
          headers,
          body,
        });
        res.writeHead(response.status, { 'content-type': 'application/json' });
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        req.socket.destroy();
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((resolve) => server.close(resolve)),
    };
  }

  return { state, fetchImpl, listen };
}
