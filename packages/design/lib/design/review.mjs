/**
 * Local design review: runs the artifact review server for a design with the `design-*` API routes
 * (studio state, handoffs, revisions, sharing, export) and reads, exports and resolves review pins.
 * Entry points: `startDesignReview`, `readDesignFeedback`, `exportDesignReview`, `saveDesignState`.
 * Sessions and `api/review` persistence belong to `@openplanr/artifact/review-server.mjs`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  createArtifactBridgeNonce,
  prepareArtifactDocument,
  renderArtifactParentRuntime,
} from '@openplanr/artifact/bridge.mjs';
import { digestArtifactEnvelope, resolveArtifactHtml } from '@openplanr/artifact/envelope.mjs';
import { acquireStartLock, readRequestBody } from '@openplanr/artifact/internal/server-util.mjs';
import { createReviewLedger } from '@openplanr/artifact/merge.mjs';
import {
  readArtifactReviewState,
  withArtifactReviewLock,
  writeArtifactReviewState,
} from '@openplanr/artifact/review.mjs';
import {
  createArtifactReviewServer,
  listArtifactReviewServers,
} from '@openplanr/artifact/review-server.mjs';
import { ARTIFACT_ERROR_CODES, PipelineError } from '@openplanr/protocol/errors';
import { PLANNING_FOLDER, planningFolderConflict } from '@openplanr/protocol/planning-folder';
import { listDesignRevisions, readDesignRevision, reviewDigest } from './context.mjs';
import { prepareDesignPlanHandoff } from './design-plan-handoff.mjs';
import {
  atomicJson,
  currentDesign,
  designRendererRevision,
  designSpecPath,
  hash,
  readJson,
  standaloneDesignHtml,
} from './document.mjs';
import { designReviewKey, designReviewPath, readDesignFeedback } from './feedback-reader.mjs';
import {
  readDesignExperience,
  readDesignHandoff,
  readDesignHandoffReadiness,
  updateDesignHandoff,
} from './handoff.mjs';
import {
  createRepositorySourceResolver,
  exportImplementationHandoffPackage,
  importImplementationHandoffPackage,
  readImplementationHandoffDraft,
  writeImplementationHandoffDraft,
} from './implementation-handoff.mjs';
import {
  approveImplementationHandoff,
  compareImplementationHandoffVersions,
  IMPLEMENTATION_HANDOFF_APPROVE_CAPABILITY,
  IMPLEMENTATION_HANDOFF_REVOKE_CAPABILITY,
  previewImplementationHandoffApproval,
  readImplementationHandoffLifecycle,
  readImplementationHandoffVersion,
  regenerateImplementationHandoffDraft,
  revokeImplementationHandoff,
} from './implementation-handoff-approval.mjs';
import { createDesignReviewExport } from './review-export.mjs';
import {
  exportDesignShareRecovery,
  getDesignShareStatus,
  manageDesignShare,
  publishDesignShare,
  shareDesign,
  syncDesignShare,
} from './share.mjs';
import { renderDesignStudio } from './studio.mjs';

export { designReviewKey, designReviewPath, readDesignFeedback } from './feedback-reader.mjs';

const VERSION = '1.4.0';
// Capture the code and asset identity at module load; a live daemon must not
// present newly installed files as though its cached implementation was updated.
const PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).version;
const MODULE_IDENTITY = hash(
  JSON.stringify({
    version: VERSION,
    renderer: designRendererRevision(),
    implementation: [
      startDesignReviewUnlocked,
      studioRuntimeIdentity,
      renderDesignStudio,
      renderArtifactParentRuntime,
      prepareArtifactDocument,
      digestArtifactEnvelope,
      resolveArtifactHtml,
    ].map((implementation) => hash(Function.prototype.toString.call(implementation))),
  }),
);
function studioRuntimeIdentity(current) {
  return {
    packageVersion: PACKAGE_VERSION,
    moduleIdentity: MODULE_IDENTITY,
    rendererIdentity: current.rendererRevision,
    revision: current.revision,
    artifactDigest: digestArtifactEnvelope(current.envelope),
    sourceHash: hash(
      JSON.stringify(
        (current.envelope.sources ?? current.envelope.artifacts)
          .map(({ id, sha256 }) => [id, sha256])
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    ),
  };
}
/** Deterministic projection of the local ledger, using original immutable sources. */
export function exportDesignReview(file, { scope = 'all', env = process.env } = {}) {
  if (!['all', 'current'].includes(scope))
    throw new Error('Review export scope must be current or all.');
  const current = currentDesign(file),
    feedback = readDesignFeedback(file, env);
  const currentDigest = digestArtifactEnvelope(current.envelope);
  const local = new Map([
    [current.revision, { revisionId: current.revision, reviewOf: currentDigest, bundle: current }],
  ]);
  let historyComplete = true;
  try {
    for (const { revision } of listDesignRevisions(file).revisions) {
      if (local.has(revision)) continue;
      try {
        const bundle = readDesignRevision(file, revision);
        local.set(revision, {
          revisionId: revision,
          reviewOf: digestArtifactEnvelope(bundle.envelope),
          bundle,
        });
      } catch {
        historyComplete = false;
      }
    }
  } catch {
    historyComplete = false;
  }
  const byDigest = new Map();
  for (const value of local.values())
    byDigest.set(value.reviewOf, [...(byDigest.get(value.reviewOf) ?? []), value]);
  // Attachment status projects only public identities. Credentials never enter
  // the export input, and an absent attachment does not block local reviews.
  let shared = null;
  try {
    shared = getDesignShareStatus(file, { env });
  } catch {
    /* Local-only or unavailable attachment. */
  }
  const currentRevisionId =
    shared?.publishedRevision === current.revision && shared?.revision
      ? shared.revision
      : current.revision;
  const revisions = [...local.values()];
  const entries = (feedback.ledger?.reviews ?? []).filter(
    (entry) => scope === 'all' || entry.review.reviewOf === currentDigest,
  );
  const pins = entries.flatMap((entry) => {
    const { review } = entry;
    const matching = byDigest.get(review.reviewOf) ?? [];
    const original = matching.length === 1 ? matching[0] : null;
    const sharedRevisionId = review.reviewId.startsWith('shared-')
      ? review.reviewId.slice(7)
      : null;
    if (sharedRevisionId && original) revisions.push({ ...original, revisionId: sharedRevisionId });
    return review.pins.map((pin) => ({
      ...pin,
      reviewId: review.reviewId,
      reviewOf: review.reviewOf,
      ...(sharedRevisionId || original
        ? {
            revisionId:
              sharedRevisionId ??
              (original.revisionId === current.revision ? currentRevisionId : original.revisionId),
          }
        : {}),
      stale: entry.stale,
    }));
  });
  const localChanges = entries.some(({ review }) =>
    !review.reviewId.startsWith('shared-')
      ? Boolean(review.pins.length || review.overall)
      : JSON.stringify(feedback.shared?.importedReviews?.[review.reviewId]) !==
        JSON.stringify(review),
  );
  return createDesignReviewExport({
    bundle: { bundle: current, revisionId: currentRevisionId, reviewOf: currentDigest },
    revisions,
    feedback: { pins, ledger: { reviews: entries } },
    metadata: readDesignExperience(file, { env }).metadata,
    historyComplete: historyComplete && !feedback.shared?.issues?.length,
    includesUnsentLocalChanges: localChanges,
  });
}

function validateState(value, current) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Buffer.byteLength(JSON.stringify(value)) > 64 * 1024
  )
    throw new Error('Studio state must be an object under 64 KB.');
  const variants = new Set(
    current.document.variants.filter((item) => item.status === 'ready').map((item) => item.id),
  );
  const fields = new Set([
    'schemaVersion',
    'view',
    'screenId',
    'frameId',
    'variantId',
    'selectedVariant',
    'compare',
    'navOpen',
    'reviewOpen',
    'inspectionScale',
    'zoom',
    'camera',
    'viewports',
    'positions',
    'ratings',
    'remix',
    'preferences',
  ]);
  if (Object.keys(value).some((key) => !fields.has(key)))
    throw new Error('Studio state has unknown fields.');
  if (value.view && !['canvas', 'prototype', 'walkthrough'].includes(value.view))
    throw new Error('Unknown studio view.');
  for (const key of ['variantId', 'selectedVariant'])
    if (value[key] && !variants.has(value[key]))
      throw new Error('Select an available design variant.');
  if (value.screenId && !current.document.screenOrder.includes(value.screenId))
    throw new Error('Unknown studio screen.');
  if (value.frameId && !current.document.frames.some((item) => item.id === value.frameId))
    throw new Error('Unknown studio frame.');
  if (value.inspectionScale !== undefined && !['fit', 'actual'].includes(value.inspectionScale))
    throw new Error('Unknown inspection scale.');
  for (const key of ['navOpen', 'reviewOpen'])
    if (value[key] !== undefined && typeof value[key] !== 'boolean')
      throw new Error('Studio panels must use boolean visibility state.');
  if (
    value.zoom !== undefined &&
    (!Number.isFinite(value.zoom) || value.zoom < 0.01 || value.zoom > 1000)
  )
    throw new Error('Invalid studio zoom.');
  const validateViewport = (viewport) => {
    if (
      !viewport ||
      typeof viewport !== 'object' ||
      Array.isArray(viewport) ||
      !Number.isFinite(viewport.x) ||
      !Number.isFinite(viewport.y) ||
      Math.abs(viewport.x) > 1e7 ||
      Math.abs(viewport.y) > 1e7 ||
      (viewport.zoom !== undefined &&
        (!Number.isFinite(viewport.zoom) || viewport.zoom < 0.01 || viewport.zoom > 1000))
    )
      throw new Error('Invalid studio viewport.');
  };
  if (value.camera !== undefined) validateViewport({ ...value.camera, zoom: value.zoom ?? 1 });
  if (value.viewports !== undefined) {
    if (
      !value.viewports ||
      typeof value.viewports !== 'object' ||
      Array.isArray(value.viewports) ||
      Object.keys(value.viewports).some(
        (key) => !['canvas', 'prototype', 'walkthrough'].includes(key),
      )
    )
      throw new Error('Studio viewports have unknown views.');
    for (const viewport of Object.values(value.viewports)) validateViewport(viewport);
  }
  for (const [id, rating] of Object.entries(value.ratings ?? {}))
    if (!variants.has(id) || !Number.isInteger(rating) || rating < 1 || rating > 5)
      throw new Error('Ratings must target available variants and be 1–5.');
  for (const [id, point] of Object.entries(value.positions ?? {}))
    if (
      !current.entries.some((entry) => entry.artifactId === id) ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      Math.abs(point.x) > 1e7 ||
      Math.abs(point.y) > 1e7
    )
      throw new Error('Invalid artboard arrangement.');
  return structuredClone(value);
}

function projectRoot(root) {
  let candidate = root;
  while (true) {
    if (existsSync(join(candidate, PLANNING_FOLDER)) || existsSync(join(candidate, '.git')))
      return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return root;
    candidate = parent;
  }
}

function currentImplementationBasis(file, env) {
  const handoff = readDesignHandoff(file, { env });
  const readiness = readDesignHandoffReadiness(file, { env });
  if (!handoff.draft || handoff.draft.status !== 'approved' || !handoff.current)
    throw Object.assign(
      new Error('Approve the current review handoff before composing the implementation package.'),
      { statusCode: 409 },
    );
  if (readiness.readiness.status !== 'ready')
    throw Object.assign(
      new Error(
        'Resolve the remaining design readiness checks before composing the implementation package.',
      ),
      { statusCode: 409 },
    );
  return {
    designId: handoff.basis.designId,
    sourceRevision: `sha256:${handoff.basis.sourceRevision}`,
    selectedVariant: handoff.basis.selectedVariant,
    readiness: {
      status: readiness.readiness.status,
      digest: readiness.digest,
    },
    reviewHandoff: {
      version: handoff.draft.version,
      contentDigest: `sha256:${handoff.draft.contentHash}`,
    },
  };
}

/** Editable owner projection. Exact source identities are derived on the server. */
function proposeImplementationPackage(file, env) {
  const current = currentDesign(file);
  const basis = currentImplementationBasis(file, env);
  const repository = projectRoot(current.root);
  const paths = [
    ...new Set([
      designSpecPath(current.root),
      ...(current.sourceFiles ?? []).map((path) => resolve(current.root, path)),
    ]),
  ].filter((path) => existsSync(path));
  const sources = paths.map((path, index) => {
    const logicalPath = relative(repository, path).replaceAll('\\', '/');
    const extension = logicalPath.split('.').pop()?.toLowerCase();
    return {
      id: `SRC-${String(index + 1).padStart(3, '0')}`,
      kind:
        path === designSpecPath(current.root)
          ? 'design-specification'
          : extension === 'html'
            ? 'screen'
            : ['css', 'json'].includes(extension)
              ? 'token'
              : 'component',
      path: logicalPath,
      revision: basis.sourceRevision,
      digest: `sha256:${hash(readFileSync(path))}`,
    };
  });
  const sourceByPath = new Map(sources.map((source) => [source.path, source.id]));
  const sourceId = (path) =>
    sourceByPath.get(relative(repository, resolve(current.root, path)).replaceAll('\\', '/'));
  const selected = current.document.variants.find(
    (variant) => variant.id === current.document.selectedVariant,
  );
  const requirements = current.document.screens.map((screen) => {
    const authored = selected?.sources?.[screen.id] ?? screen.source;
    const refs = [authored?.html, ...(authored?.styles ?? []), ...(authored?.scripts ?? [])]
      .map(sourceId)
      .filter(Boolean);
    return {
      kind: 'behavior',
      statement: `${screen.title}: ${screen.description || 'Implement the approved screen behavior and states.'}`,
      sourceRefs: refs.length ? refs : [sources[0].id],
      verification: current.document.frames.map(
        (frame) =>
          `${screen.title} matches the approved ${frame.label} frame at ${frame.width} × ${frame.height}.`,
      ),
    };
  });
  const allRefs = sources.map((source) => source.id);
  requirements.push({
    kind: 'accessibility',
    statement:
      'Preserve the approved interaction semantics, keyboard path, focus behavior and readable status communication.',
    sourceRefs: allRefs,
    verification: [
      'Keyboard-only use, visible focus, screen-reader labels and status announcements pass on every implemented screen.',
    ],
  });
  return {
    id: `${current.document.id}-implementation`,
    title: `${current.document.title} implementation package`,
    sources,
    requirements,
  };
}

async function persistDesignTaste(current, state) {
  const root = projectRoot(current.root);
  const conflict = planningFolderConflict(root);
  if (conflict) throw new PipelineError(conflict.code, conflict.problem, conflict.fix);
  const path = join(root, `${PLANNING_FOLDER}/design-system/taste.json`);
  const release = await acquireStartLock(`${path}.lock`);
  try {
    const taste = readJson(path, { designs: {} });
    const previous = taste.designs?.[current.document.id] ?? {};
    const validIds = new Set(
      current.document.variants
        .filter((variant) => variant.status === 'ready')
        .map((variant) => variant.id),
    );
    const ids = (values) => [
      ...new Set((Array.isArray(values) ? values : []).filter((id) => validIds.has(id))),
    ];
    const explicitSelected = ids(state.preferences?.selected ?? previous.selected);
    const selected = explicitSelected.includes(state.selectedVariant)
      ? [state.selectedVariant]
      : explicitSelected;
    const rejected = ids(state.preferences?.rejected ?? previous.rejected).filter(
      (id) => !selected.includes(id),
    );
    atomicJson(path, {
      ...taste,
      designs: {
        ...taste.designs,
        [current.document.id]: {
          ...previous,
          selected,
          rejected,
          ratings: state.ratings ?? previous.ratings ?? {},
          remix: state.remix ?? previous.remix ?? {},
          revision: current.revision,
        },
      },
    });
    return path;
  } finally {
    release();
  }
}

export async function saveDesignState(file, { state, revision, stateVersion }) {
  let current = currentDesign(file);
  if (revision !== current.revision)
    throw Object.assign(new Error('The design changed. Reload before saving feedback.'), {
      statusCode: 409,
    });
  const path = join(current.root, '.design/studio-state.json');
  const release = await acquireStartLock(`${path}.lock`);
  try {
    current = currentDesign(file);
    if (revision !== current.revision)
      throw Object.assign(new Error('The design changed. Reload before saving feedback.'), {
        statusCode: 409,
      });
    const previous = readJson(path, { state: {}, stateVersion: 0 });
    if (stateVersion !== previous.stateVersion)
      throw Object.assign(
        new Error('Feedback changed in another window. Reload to merge the saved state.'),
        { statusCode: 409 },
      );
    const next = {
      state: validateState(state, current),
      stateVersion: previous.stateVersion + 1,
      revision,
    };
    atomicJson(path, next);
    const tastePath = await persistDesignTaste(current, next.state);
    return { ...next, tastePath };
  } finally {
    release();
  }
}

function respond(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}
const readBody = async (req) =>
  JSON.parse(await readRequestBody(req, { maxBytes: 128 * 1024, encoding: 'utf8' }));
const readImplementationBody = async (req) =>
  JSON.parse(await readRequestBody(req, { maxBytes: 5 * 1024 * 1024, encoding: 'utf8' }));

/** Same artifact server and ledger in both CLI and installed-skill entrypoints. */
export async function startDesignReview(file, options = {}) {
  const { root } = currentDesign(file);
  const release = await acquireStartLock(join(root, '.design/start.lock'));
  try {
    return await startDesignReviewUnlocked(file, options);
  } finally {
    release();
  }
}

async function startDesignReviewUnlocked(
  file,
  {
    port = 0,
    env = process.env,
    noOpen = true,
    view,
    sourceTransport = 'srcdoc',
    frameBudget = 3,
    openUrl,
    fetchImpl = fetch,
    clock = () => new Date(),
  } = {},
) {
  let current = currentDesign(file);
  const applyInitialView = async () => {
    if (view === undefined) return;
    const saved = readJson(join(current.root, '.design/studio-state.json'), {
      state: {},
      stateVersion: 0,
    });
    await saveDesignState(file, {
      ...saved,
      revision: current.revision,
      state: { ...saved.state, view },
    });
  };
  const stateFile = join(current.root, '.design/server.json');
  const old = readJson(stateFile, null);
  const services = (await listArtifactReviewServers({ env, fetchImpl })).filter(
    (service) => service.kind === 'design' && service.projectRoot === current.root,
  );
  if (old?.url && /^http:\/\/127\.0\.0\.1:\d+\/r\//u.test(old.url)) {
    let observed;
    try {
      const status = await fetchImpl(`${old.url}api/design-status`, {
        signal: AbortSignal.timeout(700),
      });
      const data = await status.json();
      if (status.ok && data.documentId === current.document.id) observed = data;
    } catch {
      /* A stopped or stale launcher may be replaced. */
    }
    if (observed) {
      const owned = services.find(
        (service) =>
          service.kind === 'design' &&
          service.projectRoot === current.root &&
          service.instanceId === old.instanceId &&
          service.pid === old.pid &&
          service.port === Number(new URL(old.url).port),
      );
      if (!owned)
        throw new PipelineError(
          ARTIFACT_ERROR_CODES.LOOPBACK_STATE,
          'Studio is running outside the current state directory. Stop it from its original session or PLANR_HOME before opening it here.',
        );
      if (
        old.version !== VERSION ||
        (port && owned.port !== port) ||
        old.sourceTransport !== sourceTransport ||
        old.frameBudget !== frameBudget ||
        Object.entries(studioRuntimeIdentity(current)).some(
          ([key, value]) => observed.runtimeIdentity?.[key] !== value,
        )
      )
        throw new PipelineError(
          ARTIFACT_ERROR_CODES.LOOPBACK_STATE,
          'Studio is already running with different settings or runtime. Stop this design’s Studio, then open it again with the new settings.',
        );
      await applyInitialView();
      if (!noOpen) await openUrl?.(old.studioUrl ?? old.url);
      return {
        ok: true,
        url: old.studioUrl ?? old.url,
        sessionId: old.sessionId,
        instanceId: old.instanceId,
        reused: true,
        status: observed.status,
        revision: current.revision,
        reviewPath: designReviewPath(file, env),
      };
    }
  }
  if (services.length)
    throw new PipelineError(
      ARTIFACT_ERROR_CODES.LOOPBACK_STATE,
      'Studio is still running, but its saved session link is unavailable. Stop this design’s owned Studio service, then open it again.',
    );
  await applyInitialView();
  let server;
  server = createArtifactReviewServer({
    env,
    serverMetadata: { kind: 'design', projectRoot: current.root },
    prepareSource: (options) =>
      prepareArtifactDocument({
        ...options,
        allowLocalForms: true,
        prototypeState: true,
        screenId:
          current.entries.find((entry) => entry.artifactId === options.artifactId)?.screenId ??
          options.artifactId,
      }),
    async refreshSession(session) {
      current = currentDesign(file);
      if (session.designRevision === current.revision) return;
      await session.writeQueue;
      const digest = digestArtifactEnvelope(current.envelope);
      await withArtifactReviewLock(session.reviewPath, () => {
        const ledger =
          readArtifactReviewState(session.reviewPath, { allowMissing: true }) ??
          session.reviewState;
        session.reviewState = createReviewLedger({
          artifactId: ledger.artifactId,
          currentReviewOf: digest,
          reviews: ledger.reviews.map((entry) => ({
            review: entry.review,
            stale: entry.stale || entry.review.reviewOf !== digest,
          })),
        });
        writeArtifactReviewState(session.reviewPath, session.reviewState);
      });
      session.envelope = current.envelope;
      session.designRevision = current.revision;
    },
    renderDocument({ model, base }) {
      const state = readJson(join(current.root, '.design/studio-state.json'), {
        state: {},
      }).state;
      const stalePins = readDesignFeedback(file, env).pins.filter((pin) => pin.stale);
      return renderDesignStudio(
        { ...current, envelope: model.envelope, state, stalePins },
        { stageRuntimeUrl: `${base}runtime.js` },
      ).replace(
        '</head>',
        `<style>${readFileSync(new URL('../../templates/studio/share.css', import.meta.url), 'utf8')}</style></head>`,
      );
    },
    renderRuntime({ options, base }) {
      const settings = {
        runtimeIdentity: {
          ...studioRuntimeIdentity(current),
          launchContext: base.startsWith('/studio/') ? 'local Studio' : 'private review',
        },
        stateUrl: `${base}api/design-state`,
        statusUrl: `${base}api/design-status`,
        readyUrl: `${base}api/design-ready`,
        shareUrl: `${base}api/design-share`,
        experienceUrl: `${base}api/design-experience`,
        readinessUrl: `${base}api/design-handoff-readiness`,
        handoffUrl: `${base}api/design-handoff`,
        implementationHandoffUrl: `${base}api/design-implementation-handoff`,
        revisionsUrl: `${base}api/design-revisions`,
        reviewExportUrl: `${base}api/design-feedback-export`,
      };
      return `globalThis.__OPENPLANR_DESIGN_STUDIO_OPTIONS__={...${JSON.stringify(settings)},loadReviewExport:async({scope="all"}={})=>{const r=await fetch(${JSON.stringify(`${base}api/design-feedback-export`)},{method:"POST",headers:{"content-type":"application/json","x-openplanr-design":"1"},body:JSON.stringify({scope})});const value=await r.json();if(!r.ok)throw new Error(value.error||"Review export unavailable");return value},loadExperience:async()=>{const r=await fetch(${JSON.stringify(`${base}api/design-experience`)});if(!r.ok)throw new Error("Review context unavailable");return r.json()},loadReadiness:async()=>{const r=await fetch(${JSON.stringify(`${base}api/design-handoff-readiness`)});const value=await r.json();if(!r.ok)throw new Error(value.error||"Handoff readiness unavailable");return value},loadHandoff:async()=>{const r=await fetch(${JSON.stringify(`${base}api/design-handoff`)});if(!r.ok)throw new Error("Handoff unavailable");return r.json()},updateHandoff:async(input)=>{const r=await fetch(${JSON.stringify(`${base}api/design-handoff`)},{method:"POST",headers:{"content-type":"application/json","x-openplanr-design":"1"},body:JSON.stringify(input)});const value=await r.json();if(!r.ok)throw new Error(value.error||"Could not update handoff");return value},loadImplementationHandoff:async()=>{const r=await fetch(${JSON.stringify(`${base}api/design-implementation-handoff`)});const value=await r.json();if(!r.ok)throw new Error(value.error||"Implementation package unavailable");return value},updateImplementationHandoff:async(input)=>{const r=await fetch(${JSON.stringify(`${base}api/design-implementation-handoff`)},{method:"POST",headers:{"content-type":"application/json","x-openplanr-design":"1"},body:JSON.stringify(input)});const value=await r.json();if(!r.ok)throw new Error(value.error||"Could not update implementation package");return value},listRevisions:async()=>{const r=await fetch(${JSON.stringify(`${base}api/design-revisions`)});if(!r.ok)throw new Error("Revision history unavailable");return r.json()},loadRevision:async(revision,{artifactIds}={})=>{const r=await fetch(${JSON.stringify(`${base}api/design-revisions`)},{method:"POST",headers:{"content-type":"application/json","x-openplanr-design":"1"},body:JSON.stringify({revision,...(artifactIds?{artifactIds}:{})})});if(!r.ok)throw new Error("Revision unavailable");return r.json()},exportHtml:async()=>{const r=await fetch(${JSON.stringify(`${base}api/design-export`)});if(!r.ok)throw new Error('Export failed');return r.text()}};\n${renderArtifactParentRuntime({ ...options, adapterRuntimeUrl: `${base}api/design-share-runtime` })}`;
    },
    async handleSessionRequest({ req, res, segments }) {
      if (segments.length !== 5 || segments[3] !== 'api' || !segments[4].startsWith('design-'))
        return false;
      try {
        const route = segments[4];
        const localImplementationActor = {
          id: 'local-owner',
          role: 'owner',
          capabilities: [
            IMPLEMENTATION_HANDOFF_APPROVE_CAPABILITY,
            IMPLEMENTATION_HANDOFF_REVOKE_CAPABILITY,
          ],
        };
        if (route === 'design-experience' && req.method === 'GET') {
          respond(res, 200, readDesignExperience(file, { env }));
        } else if (route === 'design-handoff-readiness' && req.method === 'GET') {
          respond(res, 200, readDesignHandoffReadiness(file, { env }));
        } else if (route === 'design-handoff' && req.method === 'GET') {
          respond(res, 200, readDesignHandoff(file, { env }));
        } else if (route === 'design-implementation-handoff' && req.method === 'GET') {
          const design = currentDesign(file);
          const unlock = await acquireStartLock(join(design.root, '.design/render.lock'));
          try {
            const root = dirname(designSpecPath(design.root));
            let proposal = null;
            try {
              proposal = proposeImplementationPackage(file, env);
            } catch {
              /* Readiness explains why a proposal is unavailable. */
            }
            respond(res, 200, {
              ok: true,
              draft: readImplementationHandoffDraft(root),
              ...readImplementationHandoffLifecycle(root),
              approvalPreview: previewImplementationHandoffApproval(root),
              proposal,
            });
          } finally {
            unlock();
          }
        } else if (route === 'design-revisions' && req.method === 'GET') {
          respond(res, 200, listDesignRevisions(file));
        } else if (
          [
            'design-handoff',
            'design-implementation-handoff',
            'design-revisions',
            'design-feedback-export',
          ].includes(route) &&
          req.method === 'POST'
        ) {
          if (
            req.headers['x-openplanr-design'] !== '1' ||
            !String(req.headers['content-type'] ?? '').startsWith('application/json') ||
            (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${server.port}`)
          )
            throw Object.assign(new Error('Owner actions require a same-origin studio request.'), {
              statusCode: 403,
            });
          const input =
            route === 'design-implementation-handoff'
              ? await readImplementationBody(req)
              : await readBody(req);
          if (route === 'design-handoff')
            respond(res, 200, await updateDesignHandoff(file, input, { env, fetchImpl }));
          else if (route === 'design-implementation-handoff') {
            if (
              !input ||
              typeof input !== 'object' ||
              Array.isArray(input) ||
              ![
                'draft',
                'regenerate',
                'export',
                'import',
                'approve',
                'revoke',
                'compare',
                'continue-to-plan',
              ].includes(input.action)
            )
              throw new Error('Unknown implementation package action.');
            const initial = currentDesign(file);
            const unlock = await acquireStartLock(join(initial.root, '.design/render.lock'));
            try {
              const design = currentDesign(file);
              const root = dirname(designSpecPath(design.root));
              const resolver = createRepositorySourceResolver(projectRoot(design.root));
              const approvalOptions = {
                actor: localImplementationActor,
                clock,
                resolveSource: resolver,
                ...(['draft', 'regenerate', 'import', 'approve'].includes(input.action)
                  ? { currentBasis: currentImplementationBasis(file, env) }
                  : {}),
              };
              if (input.action === 'draft') {
                if (!input.package || input.package.kind)
                  throw new Error(
                    'Draft composition requires editable package fields, not a lifecycle record.',
                  );
                if (readImplementationHandoffLifecycle(root).history.length)
                  throw Object.assign(
                    new Error('Use regenerate to create a new version after approval.'),
                    { statusCode: 409 },
                  );
                const draft = writeImplementationHandoffDraft(
                  root,
                  {
                    ...input.package,
                    version: 1,
                    basis: approvalOptions.currentBasis,
                  },
                  { resolveSource: resolver },
                );
                respond(res, 200, { ok: true, draft });
              } else if (input.action === 'regenerate') {
                if (!input.package || input.package.kind)
                  throw new Error(
                    'Regeneration requires editable package fields, not a lifecycle record.',
                  );
                const value = regenerateImplementationHandoffDraft(
                  root,
                  {
                    ...input.package,
                    basis: approvalOptions.currentBasis,
                  },
                  { requestId: input.requestId },
                  approvalOptions,
                );
                respond(res, 200, { ok: true, ...value });
              } else if (input.action === 'import') {
                const draft = importImplementationHandoffPackage(input.package, {
                  resolveSource: resolver,
                });
                if (reviewDigest(draft.basis) !== reviewDigest(approvalOptions.currentBasis))
                  throw Object.assign(
                    new Error(
                      'The imported implementation package belongs to a different or earlier design basis.',
                    ),
                    { statusCode: 409 },
                  );
                const maximumVersion = Math.max(
                  0,
                  ...readImplementationHandoffLifecycle(root).history.map((item) => item.version),
                );
                if (draft.version <= maximumVersion)
                  throw Object.assign(
                    new Error(
                      'Imported implementation packages cannot replace immutable version history.',
                    ),
                    { statusCode: 409 },
                  );
                writeImplementationHandoffDraft(root, draft, { resolveSource: resolver });
                respond(res, 200, { ok: true, draft });
              } else if (input.action === 'approve') {
                const value = approveImplementationHandoff(root, input, approvalOptions);
                respond(res, 200, { ok: true, ...value });
              } else if (input.action === 'revoke') {
                const value = revokeImplementationHandoff(root, input, approvalOptions);
                respond(res, 200, { ok: true, ...value });
              } else if (input.action === 'compare') {
                respond(res, 200, {
                  ok: true,
                  comparison: compareImplementationHandoffVersions(root, input.left, input.right),
                });
              } else if (input.action === 'continue-to-plan') {
                const lifecycle = readImplementationHandoffLifecycle(root);
                if (!lifecycle.current || lifecycle.current.status !== 'approved')
                  throw Object.assign(
                    new Error(
                      'Continue to Plan requires a current approved implementation package.',
                    ),
                    { statusCode: 409 },
                  );
                const approved = readImplementationHandoffVersion(root, lifecycle.current);
                respond(res, 200, {
                  ok: true,
                  handoff: prepareDesignPlanHandoff(approved, { subject: input.subject }),
                });
              } else {
                const draft = readImplementationHandoffDraft(root, { allowMissing: false });
                respond(res, 200, { ok: true, package: exportImplementationHandoffPackage(draft) });
              }
            } finally {
              unlock();
            }
          } else if (route === 'design-feedback-export') {
            if (
              !input ||
              typeof input !== 'object' ||
              Array.isArray(input) ||
              Object.keys(input).some((key) => key !== 'scope') ||
              (input.scope !== undefined && !['all', 'current'].includes(input.scope))
            )
              throw new Error('Review export requires scope current or all.');
            await syncDesignShare(file, { env, fetchImpl });
            respond(res, 200, exportDesignReview(file, { scope: input.scope ?? 'all', env }));
          } else {
            if (
              !input ||
              typeof input !== 'object' ||
              Array.isArray(input) ||
              Object.keys(input).some((key) => !['revision', 'artifactIds'].includes(key)) ||
              (input.artifactIds !== undefined &&
                (!Array.isArray(input.artifactIds) ||
                  input.artifactIds.length < 1 ||
                  input.artifactIds.length > 2 ||
                  input.artifactIds.some((id) => typeof id !== 'string') ||
                  new Set(input.artifactIds).size !== input.artifactIds.length))
            )
              throw new Error('Revision comparison requires one or two distinct view IDs.');
            const bundle = readDesignRevision(file, input.revision);
            // History stays pooled. Prepare isolated bytes only for the selected
            // comparison views, rather than expanding every viewport reference.
            const artifacts = (input.artifactIds ?? []).map((id) => {
              const artifact = bundle.envelope.artifacts.find((item) => item.id === id);
              if (!artifact) throw new Error('Comparison view does not belong to this revision.');
              return artifact;
            });
            const comparisonSources = Object.fromEntries(
              artifacts.map((artifact) => [
                artifact.id,
                prepareArtifactDocument({
                  html: resolveArtifactHtml(bundle.envelope, artifact),
                  artifactId: artifact.id,
                  nonce: createArtifactBridgeNonce(),
                  parentOrigin: `http://127.0.0.1:${server.port}`,
                  portable: true,
                  allowLocalForms: true,
                }).html,
              ]),
            );
            respond(
              res,
              200,
              input.artifactIds
                ? { revision: bundle.revision, comparisonSources }
                : { ...bundle, comparisonSources },
            );
          }
        } else if (route === 'design-share-runtime' && req.method === 'GET') {
          res.writeHead(200, {
            'content-type': 'application/javascript; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          res.end(
            readFileSync(new URL('../../templates/studio/share.js', import.meta.url), 'utf8'),
          );
        } else if (route === 'design-share' && req.method === 'GET') {
          respond(res, 200, getDesignShareStatus(file, { env }));
        } else if (route === 'design-share' && req.method === 'POST') {
          if (
            req.headers['x-openplanr-design'] !== '1' ||
            !String(req.headers['content-type'] ?? '').startsWith('application/json')
          )
            throw Object.assign(new Error('Sharing requires a same-origin studio request.'), {
              statusCode: 403,
            });
          const origin = req.headers.origin;
          if (origin && origin !== `http://127.0.0.1:${server.port}`)
            throw Object.assign(new Error('Sharing requires a same-origin studio request.'), {
              statusCode: 403,
            });
          const { action } = await readBody(req);
          const options = { env, fetchImpl };
          let result;
          if (action === 'create') result = await shareDesign(file, options);
          else if (action === 'publish') result = await publishDesignShare(file, options);
          else if (action === 'sync') result = await syncDesignShare(file, options);
          else if (action === 'recovery')
            result = await exportDesignShareRecovery(file, {
              ...options,
              output: join(
                env.HOME ?? process.env.HOME,
                'Downloads',
                `openplanr-design-recovery-${Date.now()}.json`,
              ),
            });
          else result = await manageDesignShare(file, action, options);
          respond(res, 200, result);
        } else if (route === 'design-status' && req.method === 'GET') {
          const ready = readJson(join(current.root, '.design/browser-ready.json'), null);
          respond(res, 200, {
            ok: true,
            documentId: current.document.id,
            revision: current.revision,
            status: ready?.revision === current.revision ? ready.status : 'loading',
            verification: current.verification.status,
            runtimeIdentity: studioRuntimeIdentity(current),
          });
        } else if (route === 'design-state' && req.method === 'GET') {
          respond(res, 200, {
            ...readJson(join(current.root, '.design/studio-state.json'), {
              state: {},
              stateVersion: 0,
            }),
            revision: current.revision,
          });
        } else if (route === 'design-state' && req.method === 'PUT') {
          respond(res, 200, await saveDesignState(file, await readBody(req)));
        } else if (route === 'design-ready' && req.method === 'POST') {
          const value = await readBody(req);
          const loadedArtifacts = new Set(Array.isArray(value?.artifacts) ? value.artifacts : []);
          if (
            value.revision !== current.revision ||
            value.status !== 'ready' ||
            !Array.isArray(value.artifacts) ||
            value.artifacts.length === 0 ||
            loadedArtifacts.size !== value.artifacts.length ||
            value.artifacts.some((id) => !current.entries.some((entry) => entry.artifactId === id))
          )
            throw new Error('Browser readiness must identify loaded design artboards.');
          atomicJson(join(current.root, '.design/browser-ready.json'), {
            status: 'ready',
            revision: current.revision,
            artifacts: value.artifacts,
            coverage: current.entries.every((entry) => loadedArtifacts.has(entry.artifactId))
              ? 'complete'
              : 'selected',
            checkedAt: new Date().toISOString(),
          });
          respond(res, 200, { ok: true });
        } else if (route === 'design-export' && req.method === 'GET') {
          const state = readJson(join(current.root, '.design/studio-state.json'), {
            state: {},
          }).state;
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
          });
          res.end(
            standaloneDesignHtml({ ...current, state }, state.view ?? current.document.defaultView),
          );
        } else respond(res, 404, { ok: false, error: 'Unknown design operation.' });
      } catch (error) {
        respond(res, error.statusCode ?? 400, {
          ok: false,
          error: error.message,
        });
      }
      return true;
    },
  });
  try {
    try {
      await server.listen(port);
    } catch (error) {
      if (!port || error.code !== 'EADDRINUSE') throw error;
      await server.listen(0);
    }
    const origin = `http://127.0.0.1:${server.port}`;
    const health = await fetchImpl(`${origin}/health`).then((response) => response.json());
    if (!health.ok || health.instanceId !== server.instanceId)
      throw new Error('Design review server health check failed.');
    const registered = await fetchImpl(`${origin}/internal/v1/sessions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${server.controlToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        envelope: current.envelope,
        title: current.document.title,
        cwd: current.root,
        reviewKey: designReviewKey(current.document),
        studioId: current.document.id,
        sourceTransport,
        frameBudget,
      }),
    });
    const registration = await registered.json();
    if (!registered.ok)
      throw new Error(`Design review registration failed: ${JSON.stringify(registration)}`);
    const url = `${origin}${registration.path}`;
    const studioUrl = `${origin}${registration.studioPath}`;
    if (!(await fetchImpl(url)).ok) throw new Error('Design studio document failed to load.');
    atomicJson(stateFile, {
      version: VERSION,
      url,
      studioUrl,
      sourceTransport,
      frameBudget,
      sessionId: registration.sessionId,
      pid: process.pid,
      instanceId: server.instanceId,
      runtimeIdentity: studioRuntimeIdentity(current),
    });
    if (!noOpen) await openUrl?.(studioUrl);
    return {
      ok: true,
      url: studioUrl,
      sessionId: registration.sessionId,
      instanceId: server.instanceId,
      status: 'loading',
      revision: current.revision,
      reviewPath: designReviewPath(file, env),
      close: () => server.close(),
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}

export async function resolveDesignPins(file, { pinIds, summary, env = process.env }) {
  const current = currentDesign(file);
  if (current.verification.status !== 'verified')
    throw new Error('Inspect and verify the rendered revision before resolving pins.');
  if (!summary?.trim() || !pinIds?.length)
    throw new Error('Pin resolution requires pin IDs and a change summary.');
  const path = designReviewPath(file, env);
  return withArtifactReviewLock(path, () => {
    const ledger = readArtifactReviewState(path);
    const wanted = new Set(pinIds),
      found = new Set();
    const revisions = ledger.reviews.map((entry) => ({
      ...entry,
      review: {
        ...entry.review,
        pins: entry.review.pins.map((pin) => {
          if (!wanted.has(pin.id)) return pin;
          const artifact = current.envelope.artifacts.find((item) => item.id === pin.artifactId);
          if (!artifact)
            throw new PipelineError(
              ARTIFACT_ERROR_CODES.STALE_REVIEW,
              `Pin ${pin.id} has no current screen. Keep it stale until explicitly mapped.`,
            );
          if (
            pin.anchor?.planrId &&
            !resolveArtifactHtml(current.envelope, artifact).includes(
              `data-planr-id="${pin.anchor.planrId}"`,
            ) &&
            !resolveArtifactHtml(current.envelope, artifact).includes(`id="${pin.anchor.planrId}"`)
          )
            throw new PipelineError(
              ARTIFACT_ERROR_CODES.STALE_REVIEW,
              `Pin ${pin.id} has no current anchor. Keep it stale until explicitly mapped.`,
            );
          found.add(pin.id);
          return {
            ...pin,
            status: 'resolved',
            updatedAt: new Date().toISOString(),
          };
        }),
      },
    }));
    if (found.size !== wanted.size)
      throw new PipelineError(
        ARTIFACT_ERROR_CODES.REVIEW_INVALID,
        'One or more requested pins do not exist.',
      );
    writeArtifactReviewState(path, createReviewLedger({ ...ledger, reviews: revisions }));
    const history = readJson(join(current.root, '.design/review-history.json'), []);
    atomicJson(join(current.root, '.design/review-history.json'), [
      ...history,
      {
        revision: current.revision,
        pinIds,
        summary,
        at: new Date().toISOString(),
      },
    ]);
    return { ok: true, resolved: [...found], revision: current.revision };
  });
}
