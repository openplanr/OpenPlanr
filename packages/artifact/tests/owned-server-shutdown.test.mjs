import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createArtifactEnvelope, digestArtifactEnvelope } from '../lib/artifact/envelope.mjs';
import { resolveArtifactReviewDestination } from '../lib/artifact/import.mjs';
import { acquireStartLock } from '../lib/artifact/internal/server-util.mjs';
import { createArtifactReview } from '../lib/artifact/review.mjs';
import {
  closeArtifactReviewServers,
  listArtifactReviewServers,
  startArtifactReview,
  stopArtifactReviewServer,
} from '../lib/artifact/review-server.mjs';

async function waitFor(predicate) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('owned shutdown condition did not complete');
}
test('authenticated artifact stop drains an actual in-flight review save before closing its owned server', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'artifact-save-drain-')));
  const env = { ...process.env, PLANR_HOME: join(root, 'home') };
  const cwd = join(root, 'project');
  mkdirSync(join(cwd, '.git'), { recursive: true });
  writeFileSync(join(cwd, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  let release;
  let released = false;
  t.after(async () => {
    if (!released) release?.();
    await closeArtifactReviewServers();
    rmSync(root, { recursive: true, force: true });
  });
  const envelope = createArtifactEnvelope({
    artifacts: [{ id: 'checkout', title: 'Owned save', html: '<h1>Owned save</h1>' }],
  });
  const opened = await startArtifactReview({ envelope, cwd, env, noOpen: true });
  const [instance] = await listArtifactReviewServers({ env });
  assert.ok(instance);
  assert.equal(instance.port, opened.port);
  const ownedPath = join(env.PLANR_HOME, 'artifact-daemon', `instance-${instance.instanceId}.json`);
  const destination = resolveArtifactReviewDestination({ cwd, env, artifactId: 'checkout' });
  const review = createArtifactReview({
    reviewId: 'drain-save',
    reviewOf: digestArtifactEnvelope(envelope),
    overall: 'Saved before owned shutdown',
  });
  release = await acquireStartLock(`${destination.path}.lock`);

  const url = new URL('api/review', opened.url);
  let saveFinished = false;
  const saved = fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: url.origin },
    body: JSON.stringify({ review }),
  })
    .then(async (response) => ({ status: response.status, body: await response.json() }))
    .finally(() => {
      saveFinished = true;
    });
  // A second owned writer proves the real HTTP save reached the durable queue.
  await waitFor(() => readdirSync(`${destination.path}.lock.writers`).length === 2);
  const denied = await fetch(`http://127.0.0.1:${opened.port}/internal/v1/shutdown`, {
    method: 'POST',
  });
  assert.equal(denied.status, 403);
  const result = await stopArtifactReviewServer(instance.instanceId, { env });
  assert.equal(result.status, 'stopping');
  assert.equal(saveFinished, false);
  assert.equal(existsSync(ownedPath), true);
  assert.equal((await fetch(`http://127.0.0.1:${opened.port}/health`)).status, 200);
  assert.equal(JSON.parse(readFileSync(destination.path, 'utf8')).reviews.length, 0);
  const late = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: url.origin },
    body: JSON.stringify({ review }),
  });
  assert.equal(late.status, 404, 'draining rejects a new mutation');
  release();
  released = true;
  const response = await saved;
  assert.equal(response.status, 200);
  assert.equal(response.body.reviewId, review.reviewId);
  await waitFor(() => !existsSync(ownedPath));
  const durable = JSON.parse(readFileSync(destination.path, 'utf8'));
  assert.equal(durable.reviews.length, 1);
  assert.deepEqual(durable.reviews[0].review, review);
  await assert.rejects(fetch(`http://127.0.0.1:${opened.port}/health`));
});
