import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

const previewPath = new URL('../../templates/artifact-review-preview.html', import.meta.url);
const themePath = new URL('../../registry/artifact-theme.json', import.meta.url);
const html = readFileSync(previewPath, 'utf8');
const theme = JSON.parse(readFileSync(themePath, 'utf8'));

test('artifact preview uses the proposed canonical OpenPlanr tokens', () => {
  assert.equal(theme.layout.toolbarHeight, 48);
  assert.equal(theme.layout.reviewRailWidth, 344);
  assert.equal(theme.typography.display, 'Outfit');
  assert.equal(theme.typography.body, 'DM Sans');
  assert.equal(theme.typography.mono, 'Source Code Pro');
  assert.equal(theme.themes.dark.background, '#08080c');
  assert.equal(theme.themes.dark.primary, '#5eead4');
  assert.equal(theme.themes.light.background, '#f6f7f9');
  assert.equal(theme.themes.light.primary, '#087f73');
  assert.equal(theme.themes.dark.onDanger, '#08080c');
  assert.equal(theme.themes.light.onDanger, '#ffffff');
});

test('artifact preview contains the required review-shell controls and responsive modes', () => {
  for (const required of [
    'Checkout confidence pass',
    'Interact',
    'Comment',
    'Feedback',
    'Share',
    'Approve',
    'Request changes',
    'Single',
    'Variants',
    'Split',
    '01 Checkout',
    '02 Insights',
    '03 Components',
    'Invalid fragment',
    'Expired paste',
    'Wrong key',
    'Encrypted short link',
    'Nothing is uploaded',
    'the key stays in this link',
    '@media (max-width:900px)',
    '@media (max-width:390px)',
    '@media (prefers-reduced-motion:reduce)',
  ]) assert.ok(html.includes(required), `preview includes ${required}`);
});

test('artifact preview keeps dynamic HTML in an opaque, network-blocked sandbox', () => {
  assert.match(html, /sandbox="allow-scripts"/);
  assert.doesNotMatch(html, /sandbox="[^"]*allow-same-origin/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /frame-src data:/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /base-uri 'none'/);
  assert.match(html, /data:text\/html;charset=utf-8;base64/);
  assert.match(html, /id="pay"/);
  assert.match(html, /Demo payment interaction completed/);
});

test('artifact preview inline controller parses as JavaScript', () => {
  const normalizedHtml = html.replace(/\r\n?/g, '\n');
  const scripts = [...normalizedHtml.matchAll(/^  <script>\n([\s\S]*?)^  <\/script>$/gm)].map((match) => match[1]);
  assert.equal(scripts.length, 1, 'single complete-preview controller found');
  for (const [index, script] of scripts.entries()) {
    const path = join(tmpdir(), `planr-artifact-preview-${process.pid}-${index}.mjs`);
    try {
      writeFileSync(path, script);
      execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
    } finally {
      rmSync(path, { force: true });
    }
  }
});
