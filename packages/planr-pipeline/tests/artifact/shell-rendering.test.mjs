import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  ARTIFACT_SHELL_CSS,
  ARTIFACT_SHELL_ASSET_PATHS,
  renderArtifactShellDocument,
  renderArtifactShellTemplate,
} from '../../lib/artifact/ui/shell.mjs';
import {
  ARTIFACT_SHELL_STATES,
  normalizeArtifactShellModel,
  renderArtifactShellMarkup,
} from '../../lib/artifact/ui/renderers.mjs';
import {
  renderArtifactShellAssets,
  runArtifactShellGenerator,
  staleArtifactShellTargets,
} from '../../scripts/generate-artifact-shell.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const artifact = (id, title, overrides = {}) => ({
  id,
  kind: 'html',
  title,
  html: '<script>artifact bytes must never enter the parent shell</script>',
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
  ...overrides,
});

function input(overrides = {}) {
  return {
    envelope: {
      artifacts: [
        artifact('checkout', 'Checkout flow'),
        artifact('insights', 'Insights dashboard'),
        artifact('components', 'Component states'),
      ],
      viewer: { mode: 'variants', activeArtifactId: 'checkout' },
    },
    shell: { title: 'Checkout review', theme: 'auto', privacy: 'local', feedbackCount: 3 },
    ...overrides,
  };
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

test('normalization retains shell metadata but excludes artifact and review payload bytes', () => {
  const model = normalizeArtifactShellModel({
    envelope: {
      artifacts: [artifact('safe', 'Safe title', {
        html: '<script>globalThis.__artifactPayload = true</script>',
        machinePath: '/Users/private/project/artifact.html',
      })],
      review: { overall: 'private review content' },
    },
    viewer: { mode: 'single', activeArtifactId: 'safe' },
  });

  assert.equal(model.activeArtifact.id, 'safe');
  assert.equal(model.activeArtifact.viewport.width, 1440);
  assert.equal(model.activeArtifact.viewport.height, 900);
  const serialized = JSON.stringify(model);
  assert.doesNotMatch(serialized, /__artifactPayload|private review content|\/Users\/private|machinePath/);
  assert.equal(Object.hasOwn(model.activeArtifact, 'html'), false);
});

test('parent HTML and embedded JSON contain hostile metadata only in escaped data contexts', () => {
  const attack = '</title><img src=x onerror="globalThis.pwned=1"><script>alert(1)</script>\u2028';
  const document = renderArtifactShellDocument({
    envelope: { artifacts: [artifact(`id'\"><svg/onload=1>`, attack)] },
    viewer: { mode: 'single' },
    shell: { title: attack },
  });

  assert.equal((document.match(/<script\b/g) ?? []).length, 4, 'three inert data blocks and one generated controller exist');
  assert.equal((document.match(/<script type="application\/json"/g) ?? []).length, 3);
  assert.match(document, /<script src="\.\/artifact-review-stage\.js" defer><\/script>/);
  assert.match(document, /script-src 'self'/);
  assert.doesNotMatch(document, /<img src=x|<svg\/onload|<script>alert/);
  assert.match(document, /&lt;\/title&gt;&lt;img/);
  assert.match(document, /data-artifact-id="id&#39;&quot;&gt;&lt;svg\/onload=1&gt;"/);
  assert.doesNotMatch(document, /artifact bytes must never enter the parent shell/);

  const embedded = document.match(/<script type="application\/json" id="planr-artifact-shell-model">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(embedded, 'normalized model data is embedded');
  assert.doesNotMatch(embedded, /[<>]/);
  assert.equal(JSON.parse(embedded).title, attack);
  const stagePayload = document.match(/<script type="application\/json" id="planr-artifact-stage-payload">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(stagePayload, 'metadata-only stage payload is embedded');
  assert.equal(JSON.parse(stagePayload).artifacts[0].id, `id'\"><svg/onload=1>`);
  assert.doesNotMatch(stagePayload, /artifact bytes|__artifactPayload|<script|html/);
  const reviewState = document.match(/<script type="application\/json" id="planr-artifact-review-state">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(reviewState, 'digest-bound review bootstrap is embedded as inert data');
  assert.match(JSON.parse(reviewState).reviewOf, /^[a-f0-9]{64}$/);
});

test('single, variants, and split modes keep ordered accessible relationships', () => {
  const variants = normalizeArtifactShellModel(input());
  const variantHtml = renderArtifactShellMarkup(variants);
  assert.equal(variants.viewMode, 'variants');
  assert.equal((variantHtml.match(/role="tab"/g) ?? []).length, 3);
  assert.equal((variantHtml.match(/sandbox="allow-scripts"/g) ?? []).length, 3);
  assert.match(variantHtml, /id="planr-variant-tab-1" aria-controls="planr-artifact-1-panel" aria-selected="true"/);
  assert.match(variantHtml, /id="planr-artifact-1-panel" role="tabpanel" aria-labelledby="planr-variant-tab-1"[^>]+style="--planr-artifact-width:1440px;--planr-artifact-height:900px"/);
  assert.match(variantHtml, /class="planr-segment" role="group" aria-label="Viewport controls"/);
  assert.match(variantHtml, /class="planr-segment" role="group" aria-label="Review mode"/);
  assert.match(variantHtml, /class="planr-stage-controls" role="group" aria-label="Artifact display controls"/);
  assert.match(variantHtml, /class="planr-segment planr-view-modes" role="group" aria-label="Artifact view mode"/);
  assert.match(variantHtml, /data-coordinate-space="normalized"/);
  assert.doesNotMatch(variantHtml, /allow-same-origin/);

  const split = normalizeArtifactShellModel(input({
    viewer: { mode: 'split', activeArtifactId: 'insights', comparisonArtifactId: 'components' },
  }));
  assert.equal(split.viewMode, 'split');
  assert.equal(split.activeArtifact.id, 'insights');
  assert.equal(split.comparisonArtifact.id, 'components');
  const splitHtml = renderArtifactShellMarkup(split);
  assert.match(splitHtml, /data-planr-layout="split"/);
  assert.match(splitHtml, /id="planr-variant-tab-2" aria-controls="planr-artifact-2-panel" aria-selected="true"/);
  assert.match(splitHtml, /id="planr-artifact-2-panel" role="tabpanel" aria-labelledby="planr-variant-tab-2"/);
  assert.match(splitHtml, /id="planr-variant-tab-3" aria-controls="planr-artifact-3-panel"/);
  assert.match(splitHtml, /id="planr-artifact-3-panel" role="tabpanel" aria-labelledby="planr-variant-tab-3"/);
  assert.match(splitHtml, /aria-label="Primary artifact: Insights dashboard"/);
  assert.match(splitHtml, /aria-label="Comparison artifact: Component states"/);

  const single = normalizeArtifactShellModel(input({
    viewer: { mode: 'single', activeArtifactId: 'components' },
  }));
  assert.equal(single.viewMode, 'single');
  assert.match(renderArtifactShellMarkup(single), /role="tablist" aria-label="Artifact variants" hidden/);
});

test('zero and one artifact force single mode for every non-single request', () => {
  for (const requestedMode of ['variants', 'split']) {
    const empty = normalizeArtifactShellModel({
      envelope: { artifacts: [] },
      viewer: { mode: requestedMode },
    });
    assert.equal(empty.viewMode, 'single', `zero artifacts normalize ${requestedMode} to single`);
    assert.equal(empty.status, 'empty');

    const one = normalizeArtifactShellModel({
      envelope: { artifacts: [artifact('only', 'Only artifact')] },
      viewer: { mode: requestedMode, activeArtifactId: 'only' },
    });
    assert.equal(one.viewMode, 'single', `one artifact normalizes ${requestedMode} to single`);
    const html = renderArtifactShellMarkup(one);
    assert.match(html, /data-planr-view="single"/);
    assert.match(html, /data-planr-view="variants" aria-pressed="false" disabled/);
    assert.match(html, /data-planr-view="split" aria-pressed="false" disabled/);
    assert.match(html, /role="tablist" aria-label="Artifact variants" hidden/);
  }
});

test('all required ready, loading, empty, and failure states render actionable live status', () => {
  const titles = {
    empty: 'No artifact content',
    bundling: 'Bundling artifact',
    loading: 'Loading private review',
    invalid: 'This review is invalid',
    expired: 'This encrypted review expired',
    'decryption-failed': 'This key cannot decrypt the review',
    'unsupported-browser': 'Browser support is required',
  };

  for (const status of ARTIFACT_SHELL_STATES) {
    const model = normalizeArtifactShellModel(input({ viewer: { mode: 'single', status } }));
    const html = renderArtifactShellMarkup(model);
    assert.match(html, new RegExp(`data-planr-state="${status}"`));
    assert.match(html, /role="status" aria-live="polite"/);
    if (status === 'ready') {
      assert.match(html, /class="planr-stage-status"[^>]+hidden/);
      assert.doesNotMatch(html, /class="planr-stage-surface"[^>]+inert/);
    } else {
      assert.match(html, new RegExp(titles[status]));
      assert.match(html, /class="planr-stage-surface"[^>]+inert aria-hidden="true"/);
    }
  }

  const implicitEmpty = normalizeArtifactShellModel({ envelope: { artifacts: [] } });
  assert.equal(implicitEmpty.status, 'empty');
});

test('shell theme stays independent from frozen artifact color scheme and review mode', () => {
  const model = normalizeArtifactShellModel({
    envelope: { artifacts: [artifact('dark-artifact', 'Dark artifact', { colorScheme: 'dark' })] },
    viewer: { mode: 'single', reviewMode: 'comment', status: 'ready' },
    shell: { theme: 'light', zoom: 72, railOpen: false },
  });
  const document = renderArtifactShellDocument({
    envelope: { artifacts: [artifact('dark-artifact', 'Dark artifact', { colorScheme: 'dark' })] },
    viewer: { mode: 'single', reviewMode: 'comment', status: 'ready' },
    shell: { theme: 'light', zoom: 72, railOpen: false },
  });

  assert.equal(model.theme, 'light');
  assert.equal(model.activeArtifact.colorScheme, 'dark');
  assert.match(document, /<html[^>]+data-planr-theme="light"/);
  assert.match(document, /data-artifact-color-scheme="dark"/);
  assert.match(document, /data-planr-review-mode="comment"/);
  assert.match(document, /--planr-shell-zoom:0\.72/);
  assert.match(document, /data-planr-rail-open="false"/);
  assert.match(document, /id="planr-review-rail"[^>]+inert aria-hidden="true"/);
});

test('structural CSS is token-only and carries approved desktop, mobile, focus, and motion rules', () => {
  assert.doesNotMatch(ARTIFACT_SHELL_CSS, /#[0-9a-f]{3,8}\b/i, 'shell source contains no copied color values');
  for (const token of [
    '--planr-toolbar-height',
    '--planr-review-rail-width',
    '--planr-font-display',
    '--planr-font-body',
    '--planr-font-mono',
    '--planr-color-primary',
    '--planr-motion-fast',
    '--planr-motion-base',
  ]) assert.match(ARTIFACT_SHELL_CSS, new RegExp(token));
  assert.match(ARTIFACT_SHELL_CSS, /height: min\(52vh, 480px\)/);
  assert.match(ARTIFACT_SHELL_CSS, /@media \(max-width: 900px\)/);
  assert.match(ARTIFACT_SHELL_CSS, /@media \(max-width: 390px\)/);
  assert.match(ARTIFACT_SHELL_CSS, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(ARTIFACT_SHELL_CSS, /transition-duration: 0s !important/);
  assert.match(ARTIFACT_SHELL_CSS, /outline: 2px solid var\(--planr-color-primary\)/);
});

// This is intentionally a deterministic source-byte contract, not a rendered
// screenshot claim. T-005 owns browser interaction and visual snapshot coverage.
test('light and dark source contracts are byte-stable while T-005 owns rendered visual coverage', () => {
  const light = renderArtifactShellDocument({ ...input(), shell: { theme: 'light', title: 'Snapshot' } });
  const dark = renderArtifactShellDocument({ ...input(), shell: { theme: 'dark', title: 'Snapshot' } });
  assert.match(light, /data-planr-theme="light"/);
  assert.match(dark, /data-planr-theme="dark"/);
  assert.match(light, /--planr-toolbar-height: 48px/);
  assert.match(light, /--planr-review-rail-width: 344px/);
  assert.match(light, /--planr-color-background: #f6f7f9/);
  assert.match(dark, /--planr-color-background: #08080c/);
  const lightCss = light.match(/<style>\n([\s\S]*?)<\/style>/)?.[1];
  const darkCss = dark.match(/<style>\n([\s\S]*?)<\/style>/)?.[1];
  assert.equal(lightCss, darkCss, 'both theme choices use the same generated token and shell CSS');
  assert.equal(light, renderArtifactShellDocument({ ...input(), shell: { theme: 'light', title: 'Snapshot' } }));
});

test('generated portable template and hosted manifest match canonical bytes and digests', () => {
  const assets = renderArtifactShellAssets();
  assert.deepEqual(staleArtifactShellTargets(), []);
  assert.equal(
    assets[ARTIFACT_SHELL_ASSET_PATHS.template],
    renderArtifactShellTemplate(),
  );
  for (const [path, bytes] of Object.entries(assets)) {
    assert.equal(readFileSync(join(root, path), 'utf8'), bytes, `${path} is current`);
  }

  const manifest = JSON.parse(assets[ARTIFACT_SHELL_ASSET_PATHS.manifest]);
  assert.equal(manifest.sync, 'byte-for-byte');
  assert.equal(manifest.entrypoint, ARTIFACT_SHELL_ASSET_PATHS.template);
  assert.deepEqual(manifest.assets.map(({ path }) => path), [
    'lib/artifact/ui/generated/artifact-theme.css',
    'lib/artifact/ui/generated/artifact-theme.json',
    'templates/artifact-review-shell.html',
    'templates/artifact-review-stage.js',
    'templates/design/design-board-adapter.js',
  ]);
  for (const record of manifest.assets) {
    assert.equal(record.sha256, sha256(assets[record.path]));
    assert.equal(record.bytes, Buffer.byteLength(assets[record.path], 'utf8'));
  }
  assert.deepEqual(runArtifactShellGenerator({ argv: ['--check'] }), {
    ok: true,
    mode: 'check',
    staleTargets: [],
  });
});
