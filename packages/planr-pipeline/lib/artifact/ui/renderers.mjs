import { embedJson, escapeHtml } from '../../design/escape.mjs';

export const ARTIFACT_SHELL_STATES = Object.freeze([
  'ready',
  'empty',
  'bundling',
  'loading',
  'invalid',
  'expired',
  'decryption-failed',
  'unsupported-browser',
]);

export const ARTIFACT_VIEW_MODES = Object.freeze(['single', 'variants', 'split']);
export const ARTIFACT_REVIEW_MODES = Object.freeze(['interact', 'comment']);
export const ARTIFACT_SHELL_THEMES = Object.freeze(['auto', 'light', 'dark']);

const STATUS_COPY = Object.freeze({
  empty: Object.freeze({
    title: 'No artifact content',
    detail: 'Choose a bundled HTML artifact to begin this review.',
  }),
  bundling: Object.freeze({
    title: 'Bundling artifact',
    detail: 'Packaging local scripts, styles, fonts, and images without network access.',
  }),
  loading: Object.freeze({
    title: 'Loading private review',
    detail: 'Validating the envelope and frozen artifact viewport.',
  }),
  invalid: Object.freeze({
    title: 'This review is invalid',
    detail: 'The artifact envelope could not be decoded or validated.',
  }),
  expired: Object.freeze({
    title: 'This encrypted review expired',
    detail: 'Ask the sender for a new immutable review link.',
  }),
  'decryption-failed': Object.freeze({
    title: 'This key cannot decrypt the review',
    detail: 'Use the complete link, including its private fragment key.',
  }),
  'unsupported-browser': Object.freeze({
    title: 'Browser support is required',
    detail: 'Use a current browser with raw DEFLATE and Web Crypto support.',
  }),
});

const PRIVACY_LABELS = Object.freeze({
  local: 'Local review',
  fragment: 'Private fragment',
  'encrypted-short': 'Encrypted short link',
});

function plainText(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function member(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function viewportDimension(value, fallback) {
  return Number.isInteger(value) && value > 0 && value <= 16_384 ? value : fallback;
}

function normalizeArtifact(value, index) {
  const artifact = value && typeof value === 'object' ? value : {};
  const id = plainText(artifact.id, `artifact-${index + 1}`) || `artifact-${index + 1}`;
  return Object.freeze({
    id,
    domId: `planr-artifact-${index + 1}`,
    title: plainText(artifact.title, `Artifact ${index + 1}`) || `Artifact ${index + 1}`,
    kind: plainText(artifact.kind, 'html') || 'html',
    viewport: Object.freeze({
      width: viewportDimension(artifact.viewport?.width, 1440),
      height: viewportDimension(artifact.viewport?.height, 900),
    }),
    colorScheme: member(artifact.colorScheme, ['light', 'dark'], 'light'),
  });
}

/**
 * Reduce envelope/viewer input to parent-shell metadata. Artifact HTML and
 * review content are intentionally excluded so they cannot be interpolated
 * into the parent document or executable source.
 */
export function normalizeArtifactShellModel(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const envelope = source.envelope && typeof source.envelope === 'object' ? source.envelope : {};
  const viewer = source.viewer && typeof source.viewer === 'object'
    ? source.viewer
    : (envelope.viewer && typeof envelope.viewer === 'object' ? envelope.viewer : {});
  const shell = source.shell && typeof source.shell === 'object' ? source.shell : {};
  const artifacts = Object.freeze((Array.isArray(envelope.artifacts) ? envelope.artifacts : [])
    .map(normalizeArtifact));

  const requestedActiveId = plainText(viewer.activeArtifactId);
  const activeIndex = Math.max(0, artifacts.findIndex((artifact) => artifact.id === requestedActiveId));
  const activeArtifact = artifacts[activeIndex] ?? null;
  const requestedComparisonId = plainText(viewer.comparisonArtifactId);
  let comparisonIndex = artifacts.findIndex((artifact, index) => (
    index !== activeIndex && artifact.id === requestedComparisonId
  ));
  if (comparisonIndex < 0 && artifacts.length > 1) comparisonIndex = activeIndex === 0 ? 1 : 0;
  const comparisonArtifact = comparisonIndex >= 0 ? artifacts[comparisonIndex] : null;

  let viewMode = member(viewer.mode, ARTIFACT_VIEW_MODES, artifacts.length > 1 ? 'variants' : 'single');
  if (artifacts.length < 2 && viewMode !== 'single') viewMode = 'single';
  const reviewMode = member(viewer.reviewMode ?? shell.reviewMode, ARTIFACT_REVIEW_MODES, 'interact');
  let status = member(viewer.status ?? shell.status, ARTIFACT_SHELL_STATES, 'ready');
  if (artifacts.length === 0 && status === 'ready') status = 'empty';
  const privacy = member(shell.privacy, Object.keys(PRIVACY_LABELS), 'local');
  const theme = member(shell.theme, ARTIFACT_SHELL_THEMES, 'auto');
  const zoom = Math.min(200, Math.max(25, nonNegativeInteger(shell.zoom, 72)));
  const feedbackCount = nonNegativeInteger(shell.feedbackCount, 0);

  return Object.freeze({
    schemaVersion: '1.0.0',
    title: plainText(shell.title, activeArtifact?.title ?? 'Artifact review') || 'Artifact review',
    artifacts,
    activeArtifact,
    activeIndex,
    comparisonArtifact,
    comparisonIndex,
    viewMode,
    reviewMode,
    status,
    statusCopy: STATUS_COPY[status] ?? null,
    privacy,
    privacyLabel: PRIVACY_LABELS[privacy],
    theme,
    zoom,
    feedbackCount,
    railOpen: shell.railOpen !== false,
  });
}

function activeMetadata(model) {
  const artifact = model.activeArtifact;
  if (!artifact) return 'HTML · 1440×900';
  return `${artifact.kind.toUpperCase()} · ${artifact.viewport.width}×${artifact.viewport.height}`;
}

export function renderArtifactToolbar(model) {
  const interact = model.reviewMode === 'interact';
  return `<header class="planr-toolbar">
  <div class="planr-brand" aria-label="OpenPlanr"><span class="planr-mark" aria-hidden="true"></span><span class="planr-title-block"><strong>${escapeHtml(model.title)}</strong><span>${escapeHtml(activeMetadata(model))}</span></span></div>
  <span class="planr-privacy" data-privacy="${escapeHtml(model.privacy)}">${escapeHtml(model.privacyLabel)}</span>
  <span class="planr-domain-toolbar" data-planr-slot="domain-toolbar" aria-label="Artifact workflow controls"></span>
  <span class="planr-toolbar-spacer" aria-hidden="true"></span>
  <div class="planr-segment" role="group" aria-label="Viewport controls"><button type="button" data-planr-action="zoom-out" aria-label="Zoom out">−</button><button type="button" data-planr-action="zoom-reset" aria-label="Reset zoom">${model.zoom}%</button><button type="button" data-planr-action="zoom-in" aria-label="Zoom in">+</button></div>
  <div class="planr-segment" role="group" aria-label="Review mode"><button type="button" data-planr-mode="interact" data-planr-short-label="I" aria-pressed="${interact}">Interact</button><button type="button" data-planr-mode="comment" data-planr-short-label="C" aria-pressed="${!interact}">Comment</button></div>
  <button class="planr-toolbar-action" type="button" data-planr-action="theme" aria-label="Shell theme ${escapeHtml(model.theme)}">${escapeHtml(model.theme)}</button>
  <button class="planr-toolbar-action" type="button" data-planr-action="feedback" aria-controls="planr-review-rail" aria-expanded="${model.railOpen}">Feedback <span class="planr-count">${model.feedbackCount}</span></button>
  <button class="planr-toolbar-action planr-share" type="button" data-planr-action="share" aria-haspopup="dialog">Share</button>
</header>`;
}

function renderViewButton(mode, model, disabled = false) {
  const label = mode[0].toUpperCase() + mode.slice(1);
  return `<button type="button" data-planr-view="${mode}" aria-pressed="${model.viewMode === mode}"${disabled ? ' disabled' : ''}>${label}</button>`;
}

export function renderArtifactVariantControls(model) {
  const hasVariants = model.artifacts.length > 1;
  const tabs = model.artifacts.map((artifact, index) => {
    const selected = index === model.activeIndex;
    return `<button type="button" role="tab" id="planr-variant-tab-${index + 1}" aria-controls="${artifact.domId}-panel" aria-selected="${selected}" tabindex="${selected ? 0 : -1}" data-artifact-id="${escapeHtml(artifact.id)}"><span>${String(index + 1).padStart(2, '0')}</span> ${escapeHtml(artifact.title)}</button>`;
  }).join('');

  return `<div class="planr-stage-controls" role="group" aria-label="Artifact display controls">
  <div class="planr-segment planr-view-modes" role="group" aria-label="Artifact view mode">${renderViewButton('single', model)}${renderViewButton('variants', model, !hasVariants)}${renderViewButton('split', model, !hasVariants)}</div>
  <div class="planr-variants" role="tablist" aria-label="Artifact variants"${model.viewMode === 'single' || !hasVariants ? ' hidden' : ''}>${tabs}</div>
</div>`;
}

function visibleArtifactIndexes(model) {
  if (model.viewMode === 'split' && model.comparisonArtifact) {
    return new Set([model.activeIndex, model.comparisonIndex]);
  }
  return new Set(model.activeArtifact ? [model.activeIndex] : []);
}

export function renderArtifactPanels(model) {
  const visible = visibleArtifactIndexes(model);
  const unavailable = model.status !== 'ready';
  return model.artifacts.map((artifact, index) => {
    const hidden = !visible.has(index);
    const primary = index === model.activeIndex;
    const annotationTabIndex = !hidden && !unavailable && model.reviewMode === 'comment' ? 0 : -1;
    const frameTabIndex = !hidden && !unavailable && model.reviewMode === 'interact' ? 0 : -1;
    return `<section class="planr-artifact-panel" id="${artifact.domId}-panel" role="tabpanel" aria-labelledby="planr-variant-tab-${index + 1}" data-artifact-id="${escapeHtml(artifact.id)}" data-artifact-color-scheme="${artifact.colorScheme}" style="--planr-artifact-width:${artifact.viewport.width}px;--planr-artifact-height:${artifact.viewport.height}px" aria-label="${primary ? 'Primary' : 'Comparison'} artifact: ${escapeHtml(artifact.title)}"${hidden ? ' hidden' : ''}>
  <span class="planr-frame-label">${String(index + 1).padStart(2, '0')} · ${escapeHtml(artifact.title)}</span>
  <div class="planr-frame"><iframe id="${artifact.domId}" title="${escapeHtml(artifact.title)} artifact" sandbox="allow-scripts" referrerpolicy="no-referrer" tabindex="${frameTabIndex}" data-planr-artifact-frame="${escapeHtml(artifact.id)}"></iframe></div>
  <div class="planr-annotation-layer" role="region" aria-label="Annotations for ${escapeHtml(artifact.title)}" aria-disabled="${annotationTabIndex < 0}" tabindex="${annotationTabIndex}" data-coordinate-space="normalized" data-planr-annotation-layer="${escapeHtml(artifact.id)}"></div>
</section>`;
  }).join('');
}

export function renderArtifactStatus(model) {
  const ready = model.status === 'ready';
  const copy = model.statusCopy ?? { title: '', detail: '' };
  return `<div class="planr-stage-status" role="status" aria-live="polite" aria-atomic="true"${ready ? ' hidden' : ''}>
  <div><strong>${escapeHtml(copy.title)}</strong><p>${escapeHtml(copy.detail)}</p></div>
</div>`;
}

export function renderArtifactStage(model) {
  const unavailable = model.status !== 'ready';
  const breadcrumb = model.activeArtifact?.title ?? 'Artifact';
  return `<main class="planr-stage" aria-label="Artifact review stage">
  <div class="planr-stage-heading"><span>ARTIFACT / ${escapeHtml(breadcrumb.toUpperCase())}</span><span role="status" aria-live="polite" data-planr-slot="status">${model.reviewMode === 'comment' ? 'Comment mode' : 'Interactions enabled'}</span></div>
  ${renderArtifactVariantControls(model)}
  <div class="planr-stage-scroll"><div class="planr-stage-surface" style="--planr-shell-zoom:${model.zoom / 100}"${unavailable ? ' inert aria-hidden="true"' : ''}><div class="planr-frame-grid" data-planr-layout="${model.viewMode}">${renderArtifactPanels(model)}</div></div></div>
  ${renderArtifactStatus(model)}
</main>`;
}

export function renderArtifactRail(model) {
  const closed = !model.railOpen;
  return `<aside class="planr-review-rail" id="planr-review-rail" aria-label="Review feedback"${closed ? ' inert aria-hidden="true"' : ''}>
  <header><h2>Review feedback</h2><div class="planr-review-metrics" aria-label="Review metrics"><span data-planr-metric="open">0 open</span><span class="planr-count" data-planr-metric="total" aria-label="${model.feedbackCount} feedback items">${model.feedbackCount}</span></div></header>
  <section class="planr-identity" aria-label="Reviewer identity"><label for="planr-reviewer-name">Your name<input id="planr-reviewer-name" type="text" maxlength="256" autocomplete="name" aria-describedby="planr-review-error" data-planr-reviewer-name></label><p class="planr-field-error" id="planr-review-error" role="alert" hidden></p></section>
  <div class="planr-feedback-slot" data-planr-slot="feedback-rail" role="region" aria-label="Feedback threads"><p data-planr-empty-feedback>No feedback yet. Choose Comment, then click or drag on the artifact.</p><div class="planr-thread-list" data-planr-thread-list></div></div>
  <section class="planr-domain-rail" data-planr-slot="domain-rail" aria-label="Artifact workflow details" hidden></section>
  <section class="planr-decision-slot" data-planr-slot="decision" aria-label="Review decision">
    <label for="planr-overall-note">Overall note</label><textarea id="planr-overall-note" maxlength="65536" placeholder="Overall note for the coding agent…" data-planr-overall></textarea>
    <div><button type="button" data-planr-decision="approved" aria-pressed="false">Approve</button><button type="button" data-planr-decision="changes_requested" aria-pressed="false">Request changes</button></div>
    <p data-planr-slot="decision-status">Decision pending</p>
  </section>
</aside>`;
}

export function renderArtifactShareDialog() {
  return `<div class="planr-dialog-backdrop" data-planr-share-dialog hidden>
  <section class="planr-share-dialog" role="dialog" aria-modal="true" aria-labelledby="planr-share-title" aria-describedby="planr-share-description" data-planr-share-phase="idle" data-planr-share-selected="fragment">
    <header><div><h2 id="planr-share-title">Share this review</h2><p id="planr-share-description">Choose where the review bytes live before creating a link.</p></div><button type="button" class="planr-dialog-close" data-planr-share-close aria-label="Close share dialog">×</button></header>
    <div class="planr-share-receipt" role="group" aria-label="Privacy receipt">
      <button type="button" class="planr-share-receipt-row is-selected" data-planr-share-transport="fragment" aria-pressed="true">
        <span class="planr-share-receipt-icon" aria-hidden="true">#</span><span><strong>Private fragment</strong><small>Compressed into the URL. Nothing is uploaded.</small></span><span class="planr-share-receipt-size" data-planr-share-fragment-size>Calculating…</span>
      </button>
      <button type="button" class="planr-share-receipt-row" data-planr-share-transport="short" aria-pressed="false">
        <span class="planr-share-receipt-icon" aria-hidden="true">◇</span><span><strong>Encrypted short link</strong><small>AES-256-GCM ciphertext is stored until expiry; the key stays in this link fragment.</small></span><span class="planr-share-receipt-size" data-planr-share-short-size>Calculating…</span>
      </button>
    </div>
    <p class="planr-share-threshold" data-planr-share-threshold>Private fragments are used through 8,000 characters.</p>
    <div class="planr-share-ttl" data-planr-share-ttl-row hidden><label for="planr-share-ttl">Encrypted storage expiry<select id="planr-share-ttl" data-planr-share-ttl><option value="1d">1 day</option><option value="7d" selected>7 days</option><option value="30d">30 days</option></select></label><p>Ciphertext and request metadata are visible to the service until <time data-planr-share-expiry></time>. The decryption key is not uploaded.</p></div>
    <section class="planr-share-result" data-planr-share-result hidden aria-label="Share receipt">
      <label for="planr-share-url">Review URL</label><div><input id="planr-share-url" data-planr-share-url readonly><button type="button" data-planr-share-copy-url>Copy URL</button></div>
      <aside class="planr-deletion-receipt" data-planr-share-deletion hidden><strong>One-time deletion token</strong><p>Store this token now; it cannot be recovered. It is separate from the review URL.</p><code data-planr-share-deletion-token></code><button type="button" data-planr-share-copy-deletion>Copy deletion token</button></aside>
    </section>
    <p class="planr-share-error" role="alert" data-planr-share-error hidden></p>
    <p class="planr-visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-planr-share-status></p>
    <footer><button type="button" data-planr-share-cancel>Cancel</button><button type="button" class="planr-share-confirm" data-planr-share-confirm disabled>Copy private link</button></footer>
  </section>
</div>`;
}

export function renderHostedArtifactViewerSlot() {
  return `<section class="planr-hosted-viewer" data-planr-hosted-viewer data-planr-hosted-state="idle" role="status" aria-live="polite" aria-atomic="true" hidden>
  <div><span class="planr-mark" aria-hidden="true"></span><strong data-planr-hosted-title></strong><p data-planr-hosted-detail></p><button type="button" data-planr-hosted-retry hidden></button></div>
</section>`;
}

export function renderArtifactShellMarkup(model) {
  return `<div class="planr-shell" data-planr-view="${model.viewMode}" data-planr-review-mode="${model.reviewMode}" data-planr-state="${model.status}" data-planr-rail-open="${model.railOpen}">
  ${renderArtifactToolbar(model)}
  <div class="planr-workspace">${renderArtifactStage(model)}${renderArtifactRail(model)}</div>
</div>
<div data-planr-slot="dialogs">${renderArtifactShareDialog()}</div>
${renderHostedArtifactViewerSlot()}
<div class="planr-visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-planr-slot="review-announcer"></div>`;
}

export function renderArtifactShellModelData(model) {
  return embedJson(model);
}
