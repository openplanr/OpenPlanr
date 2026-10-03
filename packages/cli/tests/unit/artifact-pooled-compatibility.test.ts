import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSharedArtifactEnvelope,
  digestArtifactEnvelope,
  resolveArtifactHtml,
} from '@openplanr/artifact/envelope.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { designFixture } from '../../../design/tests/design-fixture.mjs';
import {
  prepareArtifactEnvelope,
  withoutArtifactReview,
} from '../../src/services/artifact-pipeline-service.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('shared-source artifact CLI compatibility', () => {
  it('prepares a multi-frame Design envelope with each canonical source counted once', async () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'planr-cli-pooled-'));
    directories.push(root);
    const { file } = designFixture(root, {
      frames: Array.from({ length: 5 }, (_, index) => ({
        id: `frame-${index + 1}`,
        label: `Frame ${index + 1}`,
        width: 390 + index * 240,
        height: 800,
      })),
    });
    const { envelope, bundle, api } = await prepareArtifactEnvelope({ file, root });
    expect(envelope.schemaVersion).toBe('1.1.0');
    expect(envelope.sources).toHaveLength(2);
    expect(envelope.artifacts).toHaveLength(10);
    expect(bundle.html).toBe(envelope.sources?.map(({ html }) => html).join('\n'));
    expect(bundle.bytes).toBe(Buffer.byteLength(bundle.html));
    expect(api.resolveArtifactHtml?.(envelope, envelope.artifacts[0])).toBe(
      resolveArtifactHtml(envelope, envelope.artifacts[0]),
    );
  });

  it('removes only the review while cloning and retaining shared source identity', () => {
    const base = createSharedArtifactEnvelope({
      sources: [{ id: 'page', html: '<h1>Canonical screen</h1>' }],
      artifacts: [{ id: 'desktop', title: 'Screen', sourceId: 'page' }],
    });
    const original = { ...base, review: { decision: 'pending' } };
    const copy = withoutArtifactReview(original);
    expect(copy).not.toHaveProperty('review');
    expect(copy.sources).toEqual(original.sources);
    expect(copy.artifacts).toEqual(original.artifacts);
    expect(copy.sources).not.toBe(original.sources);
    expect(digestArtifactEnvelope(copy)).toBe(digestArtifactEnvelope(base));
    if (copy.sources) copy.sources[0].html = 'changed copy';
    expect(original.sources[0].html).toBe('<h1>Canonical screen</h1>');
  });
});
