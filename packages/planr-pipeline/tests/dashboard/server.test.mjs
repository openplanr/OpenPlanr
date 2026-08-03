import assert from 'node:assert/strict';
import { get } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createDashboardServer } from '../../lib/dashboard/server.mjs';
import { validate } from '../../conformance/json-schema-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

const planrDir = join(root, 'conformance/fixtures/dashboard-graph/.planr');
const graphSchema = JSON.parse(
  readFileSync(join(root, 'schemas/v1.0.0/graph.schema.json'), 'utf-8'),
);

/** GET a path on 127.0.0.1:port; resolves { status, headers, body }. */
function request(port, path) {
  return new Promise((resolvePromise, reject) => {
    const req = get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf-8');
      // SSE streams never "end"; resolve as soon as we have the headers + first frame.
      const isStream = (res.headers['content-type'] || '').includes('text/event-stream');
      res.on('data', (chunk) => {
        body += chunk;
        if (isStream) {
          req.destroy();
          resolvePromise({ status: res.statusCode, headers: res.headers, body });
        }
      });
      res.on('end', () => resolvePromise({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', (err) => {
      // A deliberate destroy() on the SSE stream surfaces as ECONNRESET — ignore it.
      if (err && err.code === 'ECONNRESET') return;
      reject(err);
    });
    req.setTimeout(4000, () => req.destroy(new Error('request timed out')));
  });
}

/** Probe /health like the dashboard preflight does; null when nothing answers. */
function probeHealth(port) {
  return new Promise((resolvePromise) => {
    const req = get({ host: '127.0.0.1', port, path: '/health' }, (res) => {
      let body = '';
      res.setEncoding('utf-8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolvePromise(parsed && parsed.ok === true ? parsed : null);
        } catch {
          resolvePromise(null);
        }
      });
    });
    req.on('error', () => resolvePromise(null));
    req.setTimeout(1500, () => { req.destroy(); resolvePromise(null); });
  });
}

test('dashboard server: /api/graph, /api/events SSE, and reuse-if-running', async () => {
  const home = mkdtempSync(join(tmpdir(), 'planr-dash-server-'));
  const env = { ...process.env, PLANR_HOME: home };
  // watch:false keeps the test deterministic (no background fs.watch noise).
  const dash = createDashboardServer({ planrDir, watch: false });
  let port;
  try {
    port = await dash.listen(0, { env });

    // ── /api/graph → 200, application/json, schema-valid body ──────────────
    const graphRes = await request(port, '/api/graph');
    assert.equal(graphRes.status, 200, '/api/graph should answer 200');
    assert.match(
      graphRes.headers['content-type'] || '',
      /application\/json/,
      '/api/graph Content-Type should be application/json',
    );
    const graph = JSON.parse(graphRes.body);
    const errs = validate(graph, graphSchema);
    assert.equal(errs.length, 0, `/api/graph body must validate; errors: ${JSON.stringify(errs)}`);
    assert.ok(Array.isArray(graph.nodes) && graph.nodes.length > 0, 'graph should carry nodes');

    // ── /api/events → 200, text/event-stream ──────────────────────────────
    const eventsRes = await request(port, '/api/events');
    assert.equal(eventsRes.status, 200, '/api/events should answer 200');
    assert.match(
      eventsRes.headers['content-type'] || '',
      /text\/event-stream/,
      '/api/events Content-Type should be text/event-stream',
    );
    assert.match(eventsRes.body, /event: ready/, '/api/events should emit a ready event');

    // ── reuse-if-running: a /health probe answers, so the preflight contract
    //    reuses the running server instead of binding a second one (no EADDRINUSE).
    const health = await probeHealth(port);
    assert.ok(health && health.ok === true, '/health should answer { ok: true } for reuse detection');
    // The discovery port file the daemon wrote points at the running server.
    const portFile = join(home, 'dashboard-daemon', 'port');
    assert.equal(
      Number(readFileSync(portFile, 'utf-8').trim()),
      port,
      'the daemon should record its bound port for reuse discovery',
    );
  } finally {
    await dash.close();
    rmSync(home, { recursive: true, force: true });
  }
});
