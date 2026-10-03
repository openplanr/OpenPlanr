import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createArtifactEnvelope,
  createSharedArtifactEnvelope,
} from '@openplanr/artifact/envelope.mjs';
import { DESIGN_BOARD_ENVELOPE_FILE } from '../lib/design-engine/board.mjs';
import { createDaemon, daemonControlHeaders } from '../lib/design-engine/daemon.mjs';

for (const shared of [false, true]) {
  test(`legacy board daemon resolves ${shared ? 'pooled' : 'inline'} HTML with per-artifact bridge identities`, async (t) => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'planr-daemon-sources-'));
    const home = mkdtempSync(join(realpathSync(tmpdir()), 'planr-daemon-home-'));
    const env = { PLANR_HOME: home };
    t.after(() => {
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    });
    const html = '<!doctype html><h1>Canonical screen source</h1>';
    const artifacts = ['desktop', 'mobile'].map((id) => ({
      id,
      title: id,
      ...(shared ? { sourceId: 'screen' } : { html }),
    }));
    const envelope = shared
      ? createSharedArtifactEnvelope({ sources: [{ id: 'screen', html }], artifacts })
      : createArtifactEnvelope({ artifacts });
    writeFileSync(join(root, 'board.html'), '<!doctype html><title>Board</title>');
    writeFileSync(join(root, DESIGN_BOARD_ENVELOPE_FILE), JSON.stringify(envelope));
    const daemon = createDaemon({ env });
    t.after(() => daemon.close());
    const port = await daemon.listen();
    const id = `sources--${'b'.repeat(24)}`;
    const response = await fetch(`http://127.0.0.1:${port}/api/boards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...daemonControlHeaders(env) },
      body: JSON.stringify({ id, dir: root }),
    });
    assert.equal(response.status, 200);
    for (const artifact of envelope.artifacts) {
      const response = await fetch(
        `http://127.0.0.1:${port}/boards/${id}/artifacts/${artifact.id}`,
      );
      assert.equal(response.status, 200);
      const document = await response.text();
      assert.match(document, /Canonical screen source/);
      assert.ok(document.includes(`"artifactId":"${artifact.id}"`));
      assert.match(response.headers.get('content-security-policy'), /sandbox allow-scripts/);
      assert.doesNotMatch(response.headers.get('content-security-policy'), /allow-same-origin/);
    }
  });
}
