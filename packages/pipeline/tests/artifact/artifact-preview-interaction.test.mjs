import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const previewPath = new URL('../../templates/artifact-review-preview.html', import.meta.url);
const themePath = new URL('../../registry/artifact-theme.json', import.meta.url);
const html = readFileSync(previewPath, 'utf8');
const theme = JSON.parse(readFileSync(themePath, 'utf8'));

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((channel) => Number.parseInt(channel, 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

test('preview exposes three ordered dynamic variants plus single and split comparison modes', () => {
  const tabs = [...html.matchAll(/role="tab" data-variant="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tabs, ['checkout', 'insights', 'components']);
  assert.equal((html.match(/html: artifactDocument\(/g) ?? []).length, 3);
  assert.match(html, /data-view="single"/);
  assert.match(html, /data-view="variants"/);
  assert.match(html, /data-view="split"/);
  assert.match(html, /id="artifactSecondary"[^>]+sandbox="allow-scripts"/);
  assert.match(html, /frameGrid\.classList\.toggle\('split', split\)/);
  assert.match(html, /frameWrap\.classList\.toggle\('is-split', split\)/);
  assert.match(html, /globalThis\.__openPlanrArtifactPreview/);
});

test('preview keeps a frozen 1440 by 900 artifact coordinate system across responsive shells', () => {
  assert.match(html, /\.frame-wrap \{[^}]*width:1440px;[^}]*height:900px/);
  assert.match(html, /\.frame \{[^}]*width:100%;[^}]*height:100%;[^}]*border:0/);
  assert.match(html, /frame\.dataset\.viewport = `\$\{width\}x\$\{height\}`/);
  assert.match(html, /width === 1440 && height === 900/);
  assert.match(html, /\.frame-wrap\.is-split \{ width:2892px;/);
  assert.match(html, /@media \(max-width:900px\)/);
  assert.match(html, /@media \(max-width:390px\)/);
  assert.match(html, /@media \(max-width:390px\)[\s\S]*\.titleblock \{ display:none \}/);
  assert.match(html, /@media \(max-width:390px\)[\s\S]*\.feedback-btn \{ width:30px/);
  assert.match(html, /height:min\(52vh,480px\)/);
  assert.match(html, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(html, /transition-duration:\.001ms!important/);
});

test('interaction contract covers mode, synchronized focus, feedback lifecycle, decisions, and dialog focus', () => {
  for (const required of [
    "setReviewMode('interact')",
    "setReviewMode('comment')",
    "focusPair(id, 'thread')",
    "focusPair(id, 'pin')",
    "thread.classList.toggle('resolved', resolved)",
    "sample.dataset.previewReply = 'true'",
    "setDecision('approved')",
    "setDecision('changes_requested')",
    "rail.toggleAttribute('inert', !open)",
    'trapDialogFocus(event)',
    'lastDialogFocus?.focus()',
    "app.toggleAttribute('inert', true)",
    "openComposerAt(.5, .5)",
    "closeComposer({ restoreFocus: true })",
    "surface.toggleAttribute('inert', Boolean(message))",
    "primary.addEventListener('load', guardArtifactNavigation)",
    "Artifact navigation was blocked; the packaged preview was restored.",
    "event.key === 'Escape'",
  ]) assert.ok(html.includes(required), `interaction controller includes ${required}`);

  assert.match(html, /id="pin-1"[^>]+aria-controls="thread-1"/);
  assert.match(html, /id="thread-1"[^>]+tabindex="0"[^>]+aria-controls="pin-1"/);
  assert.match(html, /class="reply"/);
  assert.match(html, /class="thread question resolved"/);
  assert.doesNotMatch(html, /<article[^>]+role="button"[^>]*>[^<]*[\s\S]*?<button/);
  assert.match(html, /id="decisionState" role="status" aria-live="polite"/);
  assert.match(html, /id="modeHint" role="status" aria-live="polite"/);
  assert.match(html, /id="pinLayer" role="region" tabindex="-1"/);
  assert.match(html, /normalizedX \* pinLayer\.clientWidth/);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /uses the approved canonical/i);
});

test('privacy receipts distinguish fragment and encrypted short-link guarantees', () => {
  assert.match(html, /Compressed into the URL\. Nothing is uploaded\./);
  assert.match(html, /AES-256-GCM ciphertext stored until 21 July; the key stays in this link\./);
  assert.match(html, /7 days · 14\.8 KB/);
  assert.match(html, /Private fragment copied; nothing was uploaded\./);
  assert.match(html, /ciphertext expires in 7 days and the key stays in the link/);
});

test('every artifact is opaque-origin and CSP-blocked from network, forms, embedding, and navigation', () => {
  const iframeSandboxes = [...html.matchAll(/<iframe[^>]+sandbox="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(iframeSandboxes, ['allow-scripts', 'allow-scripts']);
  assert.doesNotMatch(html, /allow-same-origin/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.equal((html.match(/referrerpolicy="no-referrer"/g) ?? []).length, 2);
  assert.match(html, /Content-Security-Policy" content="[^"]*frame-src data:/);
  assert.match(html, /data:text\/html;charset=utf-8;base64/);
  assert.match(html, /new TextEncoder\(\)\.encode\(html\)/);
  assert.match(html, /artifactFrameStates\.set\(frame, \{ url, expectedLoads: 1, recoveryCount: 0 \}\)/);
  assert.match(html, /setPreviewState\('navigation-blocked'\)/);
  assert.doesNotMatch(html, /\.srcdoc\s*=/);
  for (const directive of [
    "default-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ]) assert.ok(html.includes(directive), `artifact CSP contains ${directive}`);
});

test('canonical text, control, and semantic color pairs meet WCAG AA contrast', () => {
  for (const [name, colors] of Object.entries(theme.themes)) {
    const pairs = {
      text: [colors.text, colors.background],
      muted: [colors.textMuted, colors.background],
      primary: [colors.primary, colors.background],
      fix: [colors.onDanger, colors.danger],
      improve: [colors.onImprove, colors.primaryStrong],
      question: [colors.onQuestion, colors.question],
      resolved: [colors.onResolved, colors.resolved],
    };
    for (const [pair, [foreground, background]] of Object.entries(pairs)) {
      assert.ok(contrast(foreground, background) >= 4.5, `${name} ${pair} is WCAG AA`);
    }
  }
});
