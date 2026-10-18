import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveArtifactHtml } from '@openplanr/artifact/envelope.mjs';
import { prepareDesignDocument } from '../lib/design/document.mjs';
import { FIXTURE_FONT_PATH, localFontDesign } from './local-font-fixture.mjs';

test('a snapshotted local font is inlined as a data URI the sandbox accepts', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'planr-design-font-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { file } = localFontDesign(root);

  const { envelope } = prepareDesignDocument(file);
  const html = resolveArtifactHtml(envelope, envelope.artifacts[0]);

  assert.match(html, /url\(\\?"?data:font\/woff2;base64,d09GMg/u);
  assert.ok(!html.includes(FIXTURE_FONT_PATH), 'the relative font URL must not survive the render');
  const references = [...html.matchAll(/url\(\s*\\?["']?([^"')\\\s]+)/gu)].map(
    ([, value]) => value,
  );
  assert.deepEqual(
    references.filter((value) => !value.startsWith('data:')),
    [],
    'every CSS url() must be inlined for the font-src data: policy',
  );
});
