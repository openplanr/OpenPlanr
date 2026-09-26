import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  createArtifactBridgeNonce,
  prepareArtifactDocument,
  renderArtifactParentRuntime,
} from '@openplanr/artifact/bridge.mjs';
import { createArtifactEnvelope, digestArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import { acquireStartLock, isProcessAlive } from '@openplanr/artifact/internal/server-util.mjs';
import {
  bundleLocalDocument,
  resolveLocalDocumentFile,
} from '@openplanr/artifact/local-document.mjs';
import { assertDesignDocument } from '@openplanr/protocol/design-contracts';
import { loadReviewContext, reviewDigest, reviewFingerprints } from './context.mjs';
import { lintDesign } from './lint.mjs';
import { buildManifest } from './manifest.mjs';
import { designStudioArtifactId, renderDesignStudio } from './studio.mjs';

export const DESIGN_VIEWS = Object.freeze(['canvas', 'prototype', 'walkthrough']);
// Bump when renderer/bridge implementation changes outside the hashed runtime assets.
export const DESIGN_RENDERER_VERSION = '1.2.0';
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
export function readJson(path, fallback = undefined) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}
export function atomicJson(path, value) {
  atomicBytes(path, json(value));
}
function atomicBytes(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Recover the compatibility projection after a dead publisher; current.json is authoritative. */
export function recoverDesignPublication(root, { ownsRenderLock = false } = {}) {
  const journalPath = join(root, '.design/publication.json');
  let journal = readJson(journalPath, null);
  if (!journal) return;
  const lockPath = join(root, '.design/render.lock');
  let recoveryOwner;
  if (!ownsRenderLock) {
    const lock = readJson(lockPath, null);
    if (lock && isProcessAlive(lock.pid)) return;
    if (lock) rmSync(lockPath, { force: true });
    recoveryOwner = randomUUID();
    let descriptor;
    try {
      descriptor = openSync(lockPath, 'wx', 0o600);
      writeFileSync(
        descriptor,
        json({ pid: process.pid, owner: recoveryOwner, createdAt: Date.now() }),
      );
    } catch (error) {
      if (error.code === 'EEXIST') return;
      throw error;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
  try {
    journal = readJson(journalPath, null);
    if (!journal) return;
    const pointer = readJson(join(root, '.design/current.json'), null);
    const manifestPath = join(root, 'finalized.json');
    if (pointer?.revision === journal.revision) atomicJson(manifestPath, journal.manifest);
    else if ((pointer?.revision ?? null) === journal.previousRevision) {
      if (journal.previousManifest === null) rmSync(manifestPath, { force: true });
      else atomicBytes(manifestPath, Buffer.from(journal.previousManifest, 'base64'));
    } else if (pointer?.revision && /^[a-f0-9]{64}$/u.test(pointer.revision)) {
      atomicJson(
        manifestPath,
        readJson(join(root, '.design/revisions', pointer.revision, 'render.json')).manifest,
      );
    } else
      throw new Error('Design publication recovery could not identify the committed revision.');
    rmSync(journalPath, { force: true });
  } finally {
    if (recoveryOwner && readJson(lockPath, null)?.owner === recoveryOwner)
      rmSync(lockPath, { force: true });
  }
}
export function loadDesignDocument(file, { readSource } = {}) {
  const checked = readSource?.(file, process.cwd());
  const path = checked?.file ?? realpathSync(resolve(file));
  const document = assertDesignDocument(
    checked ? JSON.parse(checked.value.toString('utf8')) : readJson(path),
  );
  return { path, root: dirname(path), document };
}
export function designSpecPath(root) {
  return /(?:^|\/)output\/feats\/feat-[^/]+\/design$/u.test(root.replaceAll('\\', '/'))
    ? join(dirname(root), 'design-spec.md')
    : join(root, 'design-spec.md');
}
export function inspectDesignDocument(file, { readSource } = {}) {
  const { path, root, document } = loadDesignDocument(file, { readSource });
  const sources = new Set(document.assets ?? []);
  if (existsSync(join(root, 'review-context.json'))) sources.add('review-context.json');
  if (document.designSystem?.tokens) sources.add(document.designSystem.tokens);
  for (const screen of document.screens)
    for (const source of [
      screen.source,
      ...document.variants
        .filter((variant) => variant.status === 'ready')
        .map((variant) => variant.sources?.[screen.id])
        .filter(Boolean),
    ]) {
      sources.add(source.html);
      for (const item of [...(source.styles ?? []), ...(source.scripts ?? [])]) sources.add(item);
    }
  const missing = [];
  for (const source of sources) {
    try {
      if (readSource) readSource(source, root);
      else resolveLocalDocumentFile(root, source);
    } catch (error) {
      missing.push({ path: source, message: error.message });
    }
  }
  return {
    ok: missing.length === 0,
    path,
    root,
    document,
    sources: [...sources],
    missing,
    specPath: designSpecPath(root),
    // Guarded source preparation is independent of local render cache state.
    current: readSource ? null : readJson(join(root, '.design/current.json'), null),
  };
}

/** Reads source and produces the same authored screen at every declared frame. */
export function prepareDesignDocument(file, { readSource, passive = false, maxBytes } = {}) {
  const inspected = inspectDesignDocument(file, { readSource });
  if (!inspected.ok)
    throw new Error(inspected.missing.map((item) => `${item.path}: ${item.message}`).join('\n'));
  const { document, root } = inspected;
  const reviewContext = loadReviewContext(root, document, { readSource });
  const contextDigest = reviewDigest(reviewContext);
  const fingerprints = [];
  const artifacts = [],
    entries = [],
    lint = [],
    sourceFiles = new Set(inspected.sources);
  const sourceContents = new Map(
    inspected.sources.map((source) => [
      source,
      readSource
        ? readSource(source, root).value
        : readFileSync(resolveLocalDocumentFile(root, source)),
    ]),
  );
  for (const variant of document.variants.filter((item) => item.status === 'ready')) {
    for (const screenId of document.screenOrder) {
      const screen = document.screens.find((item) => item.id === screenId);
      const bundled = bundleLocalDocument({
        root,
        source: variant.sources?.[screenId] ?? screen.source,
        sharedStyles: document.designSystem?.tokens ? [document.designSystem.tokens] : [],
        screenId,
        readSource,
        passive,
        ...(maxBytes === undefined ? {} : { maxBytes }),
      });
      const navigate = `<script>document.addEventListener('click',function(event){var link=event.target.closest('[data-design-target],[data-planr-navigate],[data-design-navigate]');if(!link)return;event.preventDefault();parent.postMessage({type:'openplanr:design-navigate',screenId:link.getAttribute('data-design-target')||link.getAttribute('data-planr-navigate')||link.getAttribute('data-design-navigate')},'*')});document.addEventListener('submit',function(event){event.preventDefault()});</script>`;
      if (!passive) bundled.html = bundled.html.replace('</body>', `${navigate}</body>`);
      for (const name of bundled.files) {
        sourceFiles.add(name);
        if (!sourceContents.has(name))
          sourceContents.set(
            name,
            readSource
              ? readSource(name, root).value
              : readFileSync(resolveLocalDocumentFile(root, name)),
          );
        if (hash(sourceContents.get(name)) !== bundled.sourceDigests[name])
          throw new Error(
            `Source ${name} changed during rendering. Retry with the completed source revision.`,
          );
      }
      const report = lintDesign(bundled.html, {
        designSystem: document.designSystem,
      });
      lint.push({ variantId: variant.id, screenId, ...report });
      for (const anchor of screen.anchors ?? []) {
        if (
          !bundled.html.includes(`data-planr-id="${anchor}"`) &&
          !bundled.html.includes(`id="${anchor}"`)
        )
          throw new Error(`Screen ${screenId} is missing its declared anchor ${anchor}.`);
      }
      for (const frame of document.frames) {
        fingerprints.push(
          reviewFingerprints({
            document,
            context: reviewContext,
            screen,
            variant,
            frame,
            sourceDigests: bundled.sourceDigests,
          }),
        );
        const artifactId = designStudioArtifactId(
          `${document.id}-${variant.id}`,
          screenId,
          frame.id,
        );
        artifacts.push({
          id: artifactId,
          kind: 'html',
          title: `${screen.title} · ${variant.label} · ${frame.label}`,
          html: bundled.html,
          viewport: { width: frame.width, height: frame.height },
          colorScheme: 'light',
        });
        entries.push({
          artifactId,
          screenId,
          variantId: variant.id,
          frameId: frame.id,
        });
      }
    }
  }
  // Keep the storage identity independent of the presentation and selected variant.
  const activeArtifactId = [...artifacts].sort((a, b) => a.id.localeCompare(b.id))[0].id;
  const envelope = createArtifactEnvelope({
    artifacts,
    viewer: {
      mode: artifacts.length > 1 ? 'variants' : 'single',
      activeArtifactId,
      presentation: 'canvas',
    },
  });
  const revision = hash(
    json({ document, contextDigest, digest: digestArtifactEnvelope(envelope) }),
  );
  return {
    ...inspected,
    reviewContext,
    contextDigest,
    fingerprints,
    envelope,
    entries,
    revision,
    lint,
    sourceFiles: [...sourceFiles],
    sourceContents,
  };
}

export function currentDesign(file) {
  // Review reads the committed revision even while an author is midway through
  // replacing the editable JSON, or its next draft is temporarily invalid.
  const root = realpathSync(dirname(resolve(file)));
  recoverDesignPublication(root);
  const pointer = readJson(join(root, '.design/current.json'), null);
  if (!pointer || !/^[a-f0-9]{64}$/u.test(pointer.revision))
    throw new Error('Design has no completed render. Run the render utility first.');
  const directory = join(root, '.design/revisions', pointer.revision);
  const prepared = readJson(join(directory, 'render.json'));
  return {
    ...prepared,
    root,
    directory,
    file: resolve(file),
    verification: readJson(join(root, '.design/verification', `${pointer.revision}.json`), {
      status: 'unverified',
      revision: pointer.revision,
    }),
  };
}

function stageRuntimeBytes() {
  const stagePath = new URL(
    '../../../artifact/templates/artifact-review-stage.js',
    import.meta.url,
  );
  // This path is replaced with the packaged equivalent in standalone release units.
  try {
    return readFileSync(stagePath);
  } catch {
    return readFileSync(new URL('../../templates/artifact-review-stage.js', import.meta.url));
  }
}

export function designRendererRevision() {
  return hash(
    json({
      version: DESIGN_RENDERER_VERSION,
      stage: hash(stageRuntimeBytes()),
      assets: ['studio.css', 'studio.js', 'enhancements.css', 'handoff-center.css']
        .filter((name) => existsSync(new URL(`../../templates/studio/${name}`, import.meta.url)))
        .map((name) =>
          hash(readFileSync(new URL(`../../templates/studio/${name}`, import.meta.url))),
        ),
    }),
  );
}

export function standaloneDesignHtml(prepared, view = prepared.document.defaultView) {
  const nonce = createArtifactBridgeNonce();
  const artifacts = Object.fromEntries(
    prepared.envelope.artifacts.map((artifact) => [
      artifact.id,
      prepareArtifactDocument({
        html: artifact.html,
        artifactId: artifact.id,
        nonce,
        parentOrigin: 'null',
        portable: true,
        allowLocalForms: true,
      }).html,
    ]),
  );
  const stage = stageRuntimeBytes();
  const stageRuntimeUrl = `data:text/javascript;base64,${Buffer.from(stage).toString('base64')}`;
  const runtime = renderArtifactParentRuntime({
    nonce,
    parentOrigin: 'null',
    inlineArtifacts: artifacts,
    stageRuntimeUrl,
  });
  const runtimeUrl = `data:text/javascript;base64,${Buffer.from(runtime).toString('base64')}`;
  const state = { ...prepared.state, view };
  if (state.selectedVariant) state.variantId = state.selectedVariant;
  return renderDesignStudio(
    {
      ...prepared,
      state,
      verification: prepared.verification ?? { status: 'unverified' },
    },
    { stageRuntimeUrl: runtimeUrl },
  );
}

/** The only publication point is current.json; incomplete revisions are never served. */
export async function renderDesignDocument(
  file,
  {
    beforeCommit,
    writePointer = atomicJson,
    rendererRevision = designRendererRevision(),
    now = () => new Date().toISOString(),
  } = {},
) {
  const { root } = loadDesignDocument(file);
  const work = join(root, '.design');
  mkdirSync(work, { recursive: true });
  const release = await acquireStartLock(join(work, 'render.lock'), {
    timeout: 1000,
    stale: 30_000,
  });
  let temporary;
  try {
    recoverDesignPublication(root, { ownsRenderLock: true });
    const prepared = prepareDesignDocument(file);
    const errors = prepared.lint.flatMap((item) =>
      item.errors.map((error) => `${item.screenId}: ${error.message}`),
    );
    if (errors.length) throw new Error(`Design lint failed:\n${errors.join('\n')}`);
    const specPath = designSpecPath(root);
    const spec = readFileSync(specPath, 'utf8');
    for (let section = 1; section <= 10; section++)
      if (!new RegExp(`^## ${section}\\. `, 'm').test(spec))
        throw new Error(`design-spec.md is missing section ${section}.`);
    prepared.revision = hash(json({ source: prepared.revision, spec, rendererRevision }));
    const directory = join(work, 'revisions', prepared.revision);
    const previous = readJson(join(work, 'current.json'), null);
    const generatedAt = now();
    const manifest = existsSync(directory)
      ? readJson(join(directory, 'render.json')).manifest
      : buildManifest({
          framework: 'vanilla',
          designFormat: prepared.document.defaultView,
          source: prepared.document.brief.source,
          contentProvenance: prepared.document.brief.provenance,
          generatedAt,
          screens: prepared.document.screenOrder.map(
            (id) => prepared.document.screens.find((item) => item.id === id).title,
          ),
          iterations:
            previous && previous.revision !== prepared.revision
              ? (previous.iterations ?? 0) + 1
              : (previous?.iterations ?? 0),
          htmlFile: `.design/revisions/${prepared.revision}/${prepared.document.defaultView}.html`,
        });
    const record = {
      reviewContext: prepared.reviewContext,
      contextDigest: prepared.contextDigest,
      fingerprints: prepared.fingerprints,
      document: prepared.document,
      envelope: prepared.envelope,
      entries: prepared.entries,
      revision: prepared.revision,
      rendererRevision,
      lint: prepared.lint,
      manifest,
    };
    if (!existsSync(directory)) {
      temporary = join(work, `pending-${randomUUID()}`);
      mkdirSync(join(temporary, 'sources'), { recursive: true });
      writeFileSync(join(temporary, 'render.json'), json(record));
      writeFileSync(join(temporary, 'design-document.json'), json(prepared.document));
      writeFileSync(join(temporary, 'design-spec.md'), spec);
      for (const source of prepared.sourceFiles) {
        const destination = join(temporary, 'sources', source);
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, prepared.sourceContents.get(source));
      }
      for (const view of DESIGN_VIEWS)
        writeFileSync(join(temporary, `${view}.html`), standaloneDesignHtml(record, view));
      beforeCommit?.(record);
      mkdirSync(dirname(directory), { recursive: true });
      renameSync(temporary, directory);
      temporary = null;
    }
    // Two regular files cannot be replaced as one filesystem transaction. Keep a
    // recovery journal around the compatibility projection and the live pointer.
    const manifestPath = join(root, 'finalized.json');
    atomicJson(join(work, 'publication.json'), {
      revision: prepared.revision,
      previousRevision: previous?.revision ?? null,
      manifest,
      previousManifest: existsSync(manifestPath)
        ? readFileSync(manifestPath).toString('base64')
        : null,
    });
    try {
      atomicJson(manifestPath, manifest);
      writePointer(join(work, 'current.json'), {
        revision: prepared.revision,
        previousRevision:
          previous?.revision === prepared.revision
            ? previous.previousRevision
            : (previous?.revision ?? null),
        iterations: manifest.iterations,
        generatedAt: manifest.generated_at,
      });
      rmSync(join(work, 'publication.json'), { force: true });
    } catch (error) {
      recoverDesignPublication(root, { ownsRenderLock: true });
      throw error;
    }
    return {
      ok: true,
      revision: prepared.revision,
      document: resolve(file),
      artifact: join(directory, `${prepared.document.defaultView}.html`),
      views: Object.fromEntries(
        DESIGN_VIEWS.map((view) => [view, join(directory, `${view}.html`)]),
      ),
      manifest: join(root, 'finalized.json'),
      spec: specPath,
      verification: 'unverified',
    };
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
    release();
  }
}
