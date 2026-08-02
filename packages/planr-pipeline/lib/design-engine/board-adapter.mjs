/** Browser adapter for the legacy design-board domain on the shared artifact shell. */
import { createReviewLink, createReviewLinkPreview } from '../artifact/share-client.mjs';
import { createArtifactReviewController } from '../artifact/ui/feedback-rail.mjs';

const baseOptions = globalThis.__OPENPLANR_ARTIFACT_STAGE_OPTIONS__ ?? {};

function readJson(id, fallback = null) {
  try { return JSON.parse(document.getElementById(id)?.textContent ?? 'null') ?? fallback; } catch { return fallback; }
}

const payload = readJson('planr-artifact-stage-payload', { artifacts: [], viewer: {} });
const embedded = readJson('planr-artifact-review-state', { reviewOf: '0'.repeat(64), review: null });
const reviewController = createArtifactReviewController({
  reviewOf: embedded.reviewOf,
  initialReview: embedded.review,
});
let designFeedback = null;
let persistQueue = Promise.resolve();
let eventSource = null;
let latestReloadGeneration = null;
let pinsVisible = true;
let designSources = [];
let remixDraft = null;

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.error) throw new Error(body?.error ?? `Request failed (${response.status})`);
  return body;
}

async function loadEnvelope(review = reviewController.getReview()) {
  const body = await requestJson('api/envelope');
  return { ...body.envelope, ...(review ? { review } : {}) };
}

async function hydrateReview() {
  const body = await requestJson('api/artifact-review');
  if (body.review) reviewController.replaceReview(body.review);
  if (body.feedback) {
    designFeedback = body.feedback;
    renderDomainControls();
  }
  return body.review;
}

function persistReview(review) {
  persistQueue = persistQueue.then(() => requestJson('api/artifact-review', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ review }),
  })).catch((error) => announce(`Could not save review: ${error.message}`, true));
  return persistQueue;
}

function announce(message, error = false) {
  const status = document.querySelector('[data-planr-slot="status"]');
  if (status) {
    status.textContent = message;
    status.toggleAttribute('data-error', error);
  }
}

function emptyFeedback() {
  return {
    schema_version: '1.0.0',
    boardId: location.pathname.split('/').filter(Boolean)[1] ?? 'design-board',
    publishedAt: new Date().toISOString(),
    regenerated: false,
    ratings: {},
    comments: {},
    authors: [],
    pins: [],
  };
}

function domainPayload(extra = {}) {
  const current = designFeedback ?? emptyFeedback();
  return {
    schema_version: '1.0.0',
    boardId: current.boardId ?? emptyFeedback().boardId,
    publishedAt: new Date().toISOString(),
    regenerated: false,
    ratings: { ...(current.ratings ?? {}) },
    comments: { ...(current.comments ?? {}) },
    authors: Array.isArray(current.authors) ? current.authors : [],
    pins: [],
    ...(current.overall ? { overall: current.overall } : {}),
    ...extra,
  };
}

async function postDomain(kind, extra = {}) {
  const feedback = domainPayload(extra);
  const body = await requestJson('api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, feedback }),
  });
  if (body.feedback) designFeedback = body.feedback;
  announce(kind === 'pending' ? 'Next design round requested' : 'Design review saved');
  renderDomainControls();
  return body;
}

function option(document, value, label = value) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

function button(document, label, action) {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', () => Promise.resolve(action()).catch((error) => announce(error.message, true)));
  return node;
}

function activeArtifactId() {
  return globalThis.__openPlanrArtifactStage?.getState?.().activeArtifactId
    ?? payload.viewer?.activeArtifactId
    ?? payload.artifacts[0]?.id;
}

function activeArtifact() {
  const id = activeArtifactId();
  return payload.artifacts.find((artifact) => artifact.id === id) ?? payload.artifacts[0];
}

function download(href, name) {
  const link = document.createElement('a');
  link.href = href;
  link.download = String(name).replace(/[^A-Za-z0-9._-]+/g, '_');
  link.rel = 'noopener';
  link.click();
}

async function downloadArtifactHtml() {
  const envelope = await loadEnvelope();
  const artifact = envelope.artifacts.find(({ id }) => id === activeArtifactId()) ?? envelope.artifacts[0];
  const url = URL.createObjectURL(new Blob([artifact.html], { type: 'text/html' }));
  try { download(url, `${artifact.id}.html`); } finally { setTimeout(() => URL.revokeObjectURL(url), 1_000); }
}

async function exportArtifactPng(target) {
  const artifact = activeArtifact();
  const frame = [...document.querySelectorAll('[data-planr-artifact-frame]')]
    .find((candidate) => candidate.dataset.planrArtifactFrame === artifact?.id);
  const result = await frame?.__openPlanrBridge?.exportPng?.(target);
  if (!result) throw new Error('The artifact is still loading or could not be rendered as PNG.');
  download(result.dataUrl, `${artifact.id}-${result.label}.png`);
  announce('PNG downloaded — reference image; HTML remains the implementation handoff.');
}

function labeledControl(labelText, control) {
  const label = document.createElement('label');
  label.append(labelText, control);
  return label;
}

function domainSection(title, { open = false } = {}) {
  const details = document.createElement('details');
  details.open = open;
  const summary = document.createElement('summary');
  summary.textContent = title;
  const body = document.createElement('div');
  body.className = 'planr-domain-section-body';
  details.append(summary, body);
  return { details, body };
}

function renderDomainControls() {
  const slot = document.querySelector('[data-planr-slot="domain-rail"]');
  const toolbar = document.querySelector('[data-planr-slot="domain-toolbar"]');
  if (!slot || !toolbar) return;
  const current = designFeedback ?? emptyFeedback();
  slot.hidden = false;
  slot.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = payload.artifacts.length > 1 ? 'Design round' : 'Design review';
  slot.append(heading);

  const reviewSection = domainSection('Variant feedback', { open: true });
  for (const artifact of payload.artifacts) {
    const group = document.createElement('fieldset');
    group.dataset.planrVariantFeedback = artifact.id;
    const legend = document.createElement('legend');
    legend.textContent = artifact.title;
    group.append(legend);
    const rating = document.createElement('select');
    rating.dataset.planrVariantRating = artifact.id;
    rating.append(option(document, '', 'Not rated'));
    for (let value = 1; value <= 5; value += 1) rating.append(option(document, String(value), `${value} / 5`));
    rating.value = current.ratings?.[artifact.id] ? String(current.ratings[artifact.id]) : '';
    rating.addEventListener('change', () => {
      const ratings = { ...(designFeedback?.ratings ?? {}) };
      if (rating.value) ratings[artifact.id] = Number(rating.value); else delete ratings[artifact.id];
      designFeedback = { ...(designFeedback ?? emptyFeedback()), ratings };
    });
    group.append(labeledControl('Rating', rating));
    const comment = document.createElement('textarea');
    comment.rows = 2;
    comment.maxLength = 65_536;
    comment.placeholder = `Notes for ${artifact.title}`;
    comment.value = current.comments?.[artifact.id] ?? '';
    comment.dataset.planrVariantComment = artifact.id;
    comment.addEventListener('input', () => {
      const comments = { ...(designFeedback?.comments ?? {}) };
      if (comment.value) comments[artifact.id] = comment.value; else delete comments[artifact.id];
      designFeedback = { ...(designFeedback ?? emptyFeedback()), comments };
    });
    group.append(labeledControl('Comment', comment));
    reviewSection.body.append(group);
  }
  slot.append(reviewSection.details);

  if (payload.artifacts.length > 1) {
    const roundSection = domainSection('Next round');
    const overall = document.createElement('textarea');
    overall.rows = 3;
    overall.maxLength = 65_536;
    overall.placeholder = 'What should the next round do?';
    overall.value = current.overall ?? '';
    overall.dataset.planrOverallDirection = '';
    overall.addEventListener('input', () => {
      designFeedback = { ...(designFeedback ?? emptyFeedback()), overall: overall.value };
    });
    roundSection.body.append(labeledControl('Overall direction', overall));

    const preferredLabel = document.createElement('label');
    preferredLabel.textContent = 'Preferred variant';
    const preferred = document.createElement('select');
    for (const artifact of payload.artifacts) preferred.append(option(document, artifact.id, artifact.title));
    preferred.value = current.preferred ?? payload.viewer?.activeArtifactId ?? payload.artifacts[0]?.id ?? '';
    preferred.dataset.planrPreferred = '';
    preferredLabel.append(preferred);
    roundSection.body.append(preferredLabel);

    remixDraft ??= {
      layoutFrom: payload.artifacts[0]?.id ?? '',
      colorsFrom: payload.artifacts[1]?.id ?? payload.artifacts[0]?.id ?? '',
      note: '',
    };
    const remixGrid = document.createElement('div');
    remixGrid.className = 'planr-domain-remix';
    const layout = document.createElement('select');
    const colors = document.createElement('select');
    for (const artifact of payload.artifacts) {
      layout.append(option(document, artifact.id, artifact.title));
      colors.append(option(document, artifact.id, artifact.title));
    }
    layout.value = remixDraft.layoutFrom;
    colors.value = remixDraft.colorsFrom;
    layout.dataset.planrRemixLayout = '';
    colors.dataset.planrRemixColors = '';
    layout.addEventListener('change', () => { remixDraft.layoutFrom = layout.value; });
    colors.addEventListener('change', () => { remixDraft.colorsFrom = colors.value; });
    remixGrid.append(labeledControl('Layout from', layout), labeledControl('Colors from', colors));
    const note = document.createElement('input');
    note.type = 'text';
    note.maxLength = 65_536;
    note.placeholder = 'Remix note (optional)';
    note.value = remixDraft.note;
    note.dataset.planrRemixNote = '';
    note.addEventListener('input', () => { remixDraft.note = note.value; });
    remixGrid.append(labeledControl('Remix note', note));
    roundSection.body.append(remixGrid);

    const roundActions = document.createElement('div');
    roundActions.className = 'planr-domain-actions';
    const iterate = button(document, 'Regenerate', () => postDomain('pending', {
      regenerated: true, regenerateAction: 'iterate',
    }));
    iterate.dataset.planrRegenerate = '';
    const more = button(document, 'More like selected', () => postDomain('pending', {
        regenerated: true,
        regenerateAction: 'more-like',
        preferred: slot.querySelector('[data-planr-preferred]')?.value || payload.viewer?.activeArtifactId,
    }));
    more.dataset.planrMoreLike = '';
    const remix = button(document, 'Remix', () => postDomain('pending', {
      regenerated: true,
      regenerateAction: 'remix',
      remixSpec: { ...remixDraft },
    }));
    remix.dataset.planrRemix = '';
    roundActions.append(iterate, more, remix);
    roundSection.body.append(roundActions);
    slot.append(roundSection.details);
  }

  const actions = document.createElement('div');
  actions.className = 'planr-domain-actions';
  const save = button(document, 'Save design review', () => postDomain('submit', {
    preferred: slot.querySelector('[data-planr-preferred]')?.value || current.preferred,
  }));
  save.dataset.planrSaveDesign = '';
  actions.append(save);
  slot.append(actions);

  const exportSection = domainSection('Exports');
  const exportActions = document.createElement('div');
  exportActions.className = 'planr-domain-actions';
  const pngScreen = button(document, 'PNG — current screen', () => exportArtifactPng('screen'));
  pngScreen.dataset.planrExport = 'png-screen';
  const pngFull = button(document, 'PNG — full design', () => exportArtifactPng('full'));
  pngFull.dataset.planrExport = 'png-full';
  const html = button(document, 'HTML — artifact', downloadArtifactHtml);
  html.dataset.planrExport = 'html';
  exportActions.append(pngScreen, pngFull, html);
  for (const source of designSources) {
    const sourceButton = button(document, `Download ${source.artifactId} source ${source.kind.toUpperCase()}`, () => {
      download(source.url, `openplanr-${source.artifactId}.${source.kind}`);
    });
    sourceButton.dataset.planrExport = `source-${source.kind}`;
    sourceButton.dataset.planrArtifactId = source.artifactId;
    exportActions.append(sourceButton);
  }
  exportSection.body.append(exportActions);
  const exportHint = document.createElement('p');
  exportHint.textContent = 'PNG is a reference image. HTML and design-spec.md remain the implementation handoff.';
  exportSection.body.append(exportHint);
  slot.append(exportSection.details);

  toolbar.replaceChildren();
  const presence = document.createElement('span');
  presence.className = 'planr-privacy';
  presence.dataset.planrPresence = '';
  presence.textContent = '1 reviewer';
  const pinToggle = button(document, pinsVisible ? 'Pins' : 'Pins hidden', () => {
    pinsVisible = !pinsVisible;
    for (const layer of document.querySelectorAll('[data-planr-annotation-layer]')) layer.hidden = !pinsVisible;
    pinToggle.textContent = pinsVisible ? 'Pins' : 'Pins hidden';
    pinToggle.setAttribute('aria-checked', String(pinsVisible));
  });
  pinToggle.setAttribute('role', 'switch');
  pinToggle.setAttribute('aria-checked', String(pinsVisible));
  pinToggle.setAttribute('data-planr-pins-toggle', '');
  toolbar.append(presence, pinToggle);
}

function connectPresence() {
  eventSource?.close();
  if (typeof EventSource !== 'function') return;
  const identity = reviewController.getIdentity()?.name ?? 'Anonymous';
  eventSource = new EventSource(`api/feedback/stream?name=${encodeURIComponent(identity)}`);
  const updatePresence = (event) => {
    const roster = JSON.parse(event.data || '{}').roster ?? [];
    const node = document.querySelector('[data-planr-presence]');
    if (node) node.textContent = `${Math.max(1, roster.length + 1)} reviewers`;
  };
  eventSource.addEventListener('presence:join', updatePresence);
  eventSource.addEventListener('presence:leave', updatePresence);
  eventSource.addEventListener('feedback:update', () => hydrateReview().catch(() => {}));
}

async function hydrateSources() {
  const body = await requestJson('api/sources');
  designSources = Array.isArray(body.sources) ? body.sources : [];
  renderDomainControls();
  return designSources;
}

reviewController.subscribe((state, change) => {
  if (change.type === 'review' && state.review) {
    persistReview(state.review);
    if (change.action === 'set-decision' && state.review.decision === 'approved') {
      const preferred = document.querySelector('[data-planr-preferred]')?.value
        ?? payload.viewer?.activeArtifactId;
      postDomain('submit', preferred ? { preferred } : {}).catch((error) => announce(error.message, true));
    }
  }
  if (change.type === 'identity') connectPresence();
});

const pasteClient = Object.freeze({
  async create(value) {
    return requestJson('api/pastes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
  },
});

globalThis.__OPENPLANR_ARTIFACT_STAGE_OPTIONS__ = Object.freeze({
  ...baseOptions,
  review: Object.freeze({ ...(baseOptions.review ?? {}), controller: reviewController }),
  share: Object.freeze({
    async prepareShare({ review }) {
      return createReviewLinkPreview(await loadEnvelope(review));
    },
    async createShare({ review, transport, ttl, confirmed }) {
      return createReviewLink(await loadEnvelope(review), {
        transport: transport === 'short' ? 'short' : 'auto',
        ttl,
        confirmed,
        pasteClient,
      });
    },
  }),
});

renderDomainControls();
connectPresence();
hydrateReview().catch((error) => announce(error.message, true));
hydrateSources().catch((error) => announce(`Source exports unavailable: ${error.message}`, true));
const progressTimer = setInterval(() => requestJson('api/progress').then((progress) => {
  if (latestReloadGeneration === null) latestReloadGeneration = progress.reloadGen;
  else if (progress.reloadGen !== latestReloadGeneration) location.reload();
}).catch(() => {}), 1_200);
addEventListener('pagehide', () => {
  clearInterval(progressTimer);
  eventSource?.close();
}, { once: true });
