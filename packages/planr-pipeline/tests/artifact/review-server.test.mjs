import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { createArtifactEnvelope } from '../../lib/artifact/envelope.mjs';
import {
  ARTIFACT_REVIEW_MAX_CONTROL_BYTES,
  artifactReviewServerStateExists,
  artifactReviewStatePath,
  closeArtifactReviewServers,
  startArtifactReview,
} from '../../lib/artifact/review-server.mjs';
import { ARTIFACT_ERROR_CODES } from '../../lib/pipeline/errors.mjs';

const homes = new Set();

afterEach(async () => {
  await closeArtifactReviewServers();
  for (const home of homes) rmSync(home, { recursive: true, force: true });
  homes.clear();
});

function isolatedEnv(overrides = {}) {
  const home = mkdtempSync(join(tmpdir(), 'planr-artifact-review-'));
  homes.add(home);
  return { ...process.env, PLANR_HOME: home, ...overrides };
}

function envelope({ html, artifacts } = {}) {
  return createArtifactEnvelope({
    artifacts: artifacts ?? [{
      id: 'checkout',
      title: 'Checkout flow',
      html: html ?? '<!doctype html><html><body><button data-planr-id="pay" onclick="this.dataset.clicked=\'yes\'">Pay</button><script>document.body.dataset.dynamic="ready"</script></body></html>',
      viewport: { width: 800, height: 600 },
      colorScheme: 'light',
    }],
  });
}

function request(port, path, {
  method = 'GET',
  headers = {},
  body,
} = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.setTimeout(5_000, () => req.destroy(new Error('request timed out')));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function urlParts(url) {
  const parsed = new URL(url);
  const segments = parsed.pathname.split('/').filter(Boolean);
  return {
    port: Number(parsed.port),
    path: parsed.pathname,
    sessionId: segments[1],
    token: segments[2],
    base: `/r/${segments[1]}/${segments[2]}/`,
  };
}

async function waitFor(predicate, timeout = 2_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('condition did not become true before timeout');
}

test('startArtifactReview returns a private tokenized session and serves only metadata in the parent', async () => {
  const env = isolatedEnv();
  const opened = [];
  const review = await startArtifactReview({
    envelope: envelope(),
    env,
    title: 'Checkout security review',
    theme: 'dark',
    openUrl: async (url) => opened.push(url),
  });
  const parts = urlParts(review.url);

  assert.equal(review.ok, true);
  assert.equal(review.host, '127.0.0.1');
  assert.equal(review.port, parts.port);
  assert.equal(review.opened, true);
  assert.equal(review.shouldOpen, true);
  assert.deepEqual(opened, [review.url]);
  assert.match(parts.sessionId, /^[A-Za-z0-9_-]{22}$/);
  assert.match(parts.token, /^[A-Za-z0-9_-]{43}$/);

  const serialized = JSON.parse(JSON.stringify(review));
  assert.equal(serialized.url, review.url);
  assert.equal(Object.hasOwn(serialized, 'close'), false);
  assert.equal(Object.hasOwn(serialized, 'toJSON'), false);
  assert.doesNotMatch(JSON.stringify(serialized), /controlToken|bridgeNonce|<script|onclick/);

  const shell = await request(parts.port, parts.path);
  assert.equal(shell.status, 200);
  assert.match(shell.headers['content-type'], /^text\/html/);
  assert.match(shell.headers['cache-control'], /no-store/);
  assert.equal(shell.headers['referrer-policy'], 'no-referrer');
  assert.equal(shell.headers['x-content-type-options'], 'nosniff');
  assert.equal(shell.headers['x-dns-prefetch-control'], 'off');
  assert.equal(shell.headers['x-frame-options'], 'DENY');
  assert.match(shell.headers['content-security-policy'], /script-src 'self' 'unsafe-inline'/);
  assert.match(shell.headers['content-security-policy'], /connect-src 'self'/);
  assert.match(shell.headers['content-security-policy'], /frame-src blob:/);
  assert.match(shell.headers['content-security-policy'], /worker-src data: blob:/);
  assert.match(shell.body, /sandbox="allow-scripts"/);
  assert.doesNotMatch(shell.body, /allow-same-origin|data-planr-id="pay"|onclick|dynamic="ready"/);
  assert.match(shell.body, new RegExp(`${parts.base.replaceAll('/', '\\/')}runtime\\.js`));

  const runtime = await request(parts.port, `${parts.base}runtime.js`);
  assert.equal(runtime.status, 200);
  assert.match(runtime.body, /resolveArtifactSource/);
  assert.match(runtime.body, /response\.arrayBuffer\(\)/);
  assert.match(runtime.body, /new Blob/);
  assert.doesNotMatch(runtime.body, /data-planr-id="pay"|onclick="/);
  const stage = await request(parts.port, `${parts.base}stage.js`);
  assert.equal(stage.status, 200);
  assert.match(stage.body, /mountArtifactStage/);

  const artifact = await request(parts.port, `${parts.base}artifacts/checkout`);
  assert.equal(artifact.status, 200);
  assert.match(artifact.headers['content-security-policy'], /connect-src 'none'/);
  assert.match(artifact.headers['content-security-policy'], /script-src-attr 'unsafe-inline'/);
  assert.match(artifact.headers['content-security-policy'], /worker-src data: blob:/);
  assert.match(artifact.body, /data-planr-id="pay"/);
  assert.match(artifact.body, /onclick="this\.dataset\.clicked='yes'"/);
  const cspIndex = artifact.body.indexOf('Content-Security-Policy');
  const firstScriptIndex = artifact.body.indexOf('<script');
  assert.ok(cspIndex >= 0 && cspIndex < firstScriptIndex, 'artifact CSP precedes every active script');
  assert.match(artifact.body.slice(firstScriptIndex, firstScriptIndex + 400), /injectedScript\?\.remove\(\)/);

  const statePath = artifactReviewStatePath(0, env);
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(state.kind, 'artifact-review');
  assert.equal(state.port, parts.port);
  assert.match(state.controlToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(state.instanceId, /^[A-Za-z0-9_-]{22}$/);
  if (process.platform !== 'win32') {
    assert.equal(statSync(statePath).mode & 0o777, 0o600);
  }
  assert.doesNotMatch(readFileSync(statePath, 'utf8'), /Checkout flow|<html|bridgeNonce/);

  const firstClose = review.close();
  const sharedClose = review.close();
  assert.equal(firstClose, sharedClose, 'concurrent close callers share one promise');
  assert.deepEqual(await firstClose, { ok: true, remaining: 0 });
  assert.deepEqual(await review.close(), { ok: true, alreadyClosed: true });
  await waitFor(() => !artifactReviewServerStateExists(0, env));
});

test('no-open and SSH sessions suppress browser launch and provide serializable forwarding guidance', async () => {
  const localEnv = isolatedEnv();
  let calls = 0;
  const noOpen = await startArtifactReview({
    envelope: envelope(), env: localEnv, noOpen: true, openUrl: async () => { calls++; },
  });
  assert.equal(noOpen.shouldOpen, false);
  assert.equal(noOpen.opened, false);
  assert.equal(calls, 0);
  await noOpen.close();

  const sshEnv = isolatedEnv({ SSH_CONNECTION: '192.0.2.1 50000 192.0.2.2 22' });
  const ssh = await startArtifactReview({
    envelope: envelope(), env: sshEnv, openUrl: async () => { calls++; },
  });
  assert.equal(ssh.remote.detected, true);
  assert.equal(ssh.shouldOpen, false);
  assert.equal(ssh.opened, false);
  assert.equal(calls, 0);
  assert.match(ssh.remote.forwardingCommand, new RegExp(`-L ${ssh.port}:127\\.0\\.0\\.1:${ssh.port}`));
  assert.match(ssh.remote.instruction, /Forward the port/);
  assert.doesNotThrow(() => JSON.stringify(ssh));
  await ssh.close();
});

test('browser launch failures are nonfatal, redacted, and leave a closable session', async () => {
  const env = isolatedEnv();
  const secret = '/Users/private/project TOKEN=do-not-leak';
  const review = await startArtifactReview({
    envelope: envelope(),
    env,
    openUrl: async () => { throw new Error(secret); },
  });
  assert.equal(review.ok, true);
  assert.equal(review.opened, false);
  assert.equal(review.launch.ok, false);
  assert.equal(review.launch.error.code, 'E_ARTIFACT_BROWSER_OPEN_FAILED');
  assert.match(review.launch.error.message, /Open the returned loopback URL manually/);
  assert.doesNotMatch(JSON.stringify(review), /Users|TOKEN|do-not-leak|private\/project/);
  assert.equal((await request(review.port, new URL(review.url).pathname)).status, 200);
  assert.deepEqual(await review.close(), { ok: true, remaining: 0 });
});

test('explicit free ports bind exactly and invalid ports fail with a named error', async () => {
  const env = isolatedEnv();
  const reservation = createNetServer();
  await new Promise((resolveListen, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolveListen);
  });
  const explicitPort = reservation.address().port;
  await new Promise((resolveClose, reject) => reservation.close((error) => (
    error ? reject(error) : resolveClose()
  )));

  const review = await startArtifactReview({ envelope: envelope(), env, noOpen: true, port: explicitPort });
  assert.equal(review.port, explicitPort);
  assert.equal(JSON.parse(readFileSync(artifactReviewStatePath(explicitPort, env), 'utf8')).port, explicitPort);
  await review.close();
  await waitFor(() => !artifactReviewServerStateExists(explicitPort, env));

  await assert.rejects(
    startArtifactReview({ envelope: envelope(), env, noOpen: true, port: 65_536 }),
    (error) => error.code === ARTIFACT_ERROR_CODES.LOOPBACK_BIND,
  );
});

test('every session route is capability gated and Host/origin/path confusion fails closed', async () => {
  const env = isolatedEnv();
  const review = await startArtifactReview({ envelope: envelope(), env, noOpen: true });
  const parts = urlParts(review.url);
  const wrongToken = 'A'.repeat(43);

  for (const suffix of ['', 'runtime.js', 'stage.js', 'artifacts/checkout']) {
    const denied = await request(parts.port, `/r/${parts.sessionId}/${wrongToken}/${suffix}`);
    assert.equal(denied.status, 404, `wrong token denies ${suffix || 'shell'}`);
  }
  assert.equal((await request(parts.port, parts.path, { headers: { host: `evil.test:${parts.port}` } })).status, 403);
  assert.equal((await request(parts.port, parts.path, { headers: { origin: 'https://evil.test' } })).status, 403);
  assert.equal((await request(parts.port, parts.path, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await request(parts.port, parts.path, { method: 'POST' })).status, 403, 'origin-less public mutation is rejected');
  assert.equal((await request(parts.port, '/')).status, 404, 'root never enumerates sessions');
  assert.equal((await request(parts.port, '//health')).status, 400);
  assert.equal((await request(parts.port, '/%2e%2e/health')).status, 400);
  assert.equal((await request(parts.port, '/r%2fescape')).status, 400);
  assert.equal((await request(parts.port, '/r%5cescape')).status, 400);
  assert.equal((await request(parts.port, '/r/../health')).status, 400);
  assert.equal((await request(parts.port, `${parts.base}artifacts/missing`)).status, 404);

  const head = await request(parts.port, parts.path, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.ok(Number(head.headers['content-length']) > 0);
  await review.close();
});

test('control endpoints require the private token and enforce byte-counted body limits', async () => {
  const env = isolatedEnv();
  const review = await startArtifactReview({ envelope: envelope(), env, noOpen: true });
  const { port } = urlParts(review.url);
  const state = JSON.parse(readFileSync(artifactReviewStatePath(0, env), 'utf8'));

  const wrong = await request(port, '/internal/v1/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${'A'.repeat(43)}`, 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(wrong.status, 403);

  const invalid = await request(port, '/internal/v1/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${state.controlToken}`, 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(invalid.status, 400);

  const oversized = await request(port, '/internal/v1/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${state.controlToken}`,
      'content-type': 'application/json',
      'content-length': String(ARTIFACT_REVIEW_MAX_CONTROL_BYTES + 1),
    },
  });
  assert.equal(oversized.status, 413);
  assert.equal(JSON.parse(oversized.body).code, ARTIFACT_ERROR_CODES.REQUEST_LIMIT);
  await review.close();
});

test('control transport accepts the worst-case JSON expansion of a valid 10 MiB artifact', async () => {
  const env = isolatedEnv();
  const maximum = 10 * 1024 * 1024;
  const prefix = '<!doctype html><html><head></head><body><pre>';
  const suffix = '</pre></body></html>';
  const html = `${prefix}${'\u0001'.repeat(maximum - Buffer.byteLength(prefix) - Buffer.byteLength(suffix))}${suffix}`;
  const maximumEnvelope = envelope({ html });
  const serializedBytes = Buffer.byteLength(JSON.stringify({
    envelope: maximumEnvelope,
    title: 'Maximum valid artifact',
    theme: 'auto',
  }));
  assert.ok(serializedBytes > 60 * 1024 * 1024, 'fixture exercises six-byte JSON escapes');
  assert.ok(serializedBytes <= ARTIFACT_REVIEW_MAX_CONTROL_BYTES);
  const review = await startArtifactReview({ envelope: maximumEnvelope, env, noOpen: true });
  assert.equal(review.ok, true);
  await review.close();
});

test('concurrent starts share one daemon and the last close cannot race a new registration', async () => {
  const env = isolatedEnv();
  const [first, second] = await Promise.all([
    startArtifactReview({ envelope: envelope(), env, noOpen: true }),
    startArtifactReview({ envelope: envelope(), env, noOpen: true }),
  ]);
  assert.equal(first.port, second.port);
  assert.notEqual(first.sessionId, second.sessionId);
  assert.equal((await request(first.port, '/health')).status, 200);

  const firstClose = await first.close();
  assert.equal(firstClose.remaining, 1);
  const closingLast = second.close();
  const replacement = await startArtifactReview({ envelope: envelope(), env, noOpen: true });
  await closingLast;
  assert.equal((await request(replacement.port, new URL(replacement.url).pathname)).status, 200);
  await replacement.close();
});

test('dead state and lock recover atomically while a foreign occupied port is never killed', async (t) => {
  const env = isolatedEnv();
  const statePath = artifactReviewStatePath(0, env);
  const stateDir = join(env.PLANR_HOME, 'artifact-daemon');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(statePath, JSON.stringify({
    schemaVersion: '1.0.0', kind: 'artifact-review', serverVersion: 1,
    pid: 999_999_999, port: 65534, controlToken: 'A'.repeat(43), instanceId: 'A'.repeat(22),
  }));
  const lockPath = join(stateDir, 'start-default.lock');
  writeFileSync(lockPath, JSON.stringify({ pid: 999_999_999, owner: 'dead', createdAt: 0 }));
  chmodSync(lockPath, 0o600);
  const recovered = await startArtifactReview({ envelope: envelope(), env, noOpen: true });
  assert.notEqual(recovered.port, 65534);
  assert.equal((await request(recovered.port, '/health')).status, 200);
  await recovered.close();

  const foreign = createNetServer();
  await new Promise((resolveListen, reject) => {
    foreign.once('error', reject);
    foreign.listen(0, '127.0.0.1', resolveListen);
  });
  t.after(() => new Promise((resolveClose) => foreign.close(resolveClose)));
  const foreignPort = foreign.address().port;
  await assert.rejects(
    startArtifactReview({ envelope: envelope(), env, noOpen: true, port: foreignPort }),
    (error) => error.code === ARTIFACT_ERROR_CODES.PORT_IN_USE,
  );
  assert.equal(foreign.listening, true, 'foreign listener remains alive');
});
