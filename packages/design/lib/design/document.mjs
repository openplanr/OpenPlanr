import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
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
  prepareArtifactSourceTemplate,
  renderArtifactParentRuntime,
} from '@openplanr/artifact/bridge.mjs';
import {
  createSharedArtifactEnvelope,
  digestArtifactEnvelope,
  resolveArtifactHtml,
} from '@openplanr/artifact/envelope.mjs';
import { acquireStartLock } from '@openplanr/artifact/internal/server-util.mjs';
import {
  bundleLocalDocument,
  resolveLocalDocumentFile,
} from '@openplanr/artifact/local-document.mjs';
import { assertDesignDocument } from '@openplanr/protocol/design-contracts';
import { loadReviewContext, reviewDigest, reviewFingerprints } from './context.mjs';
import {
  atomicJson,
  designSpecPath,
  hash,
  json,
  readJson,
  recoverDesignPublication,
} from './document-state.mjs';
import { lintDesign } from './lint.mjs';
import { buildManifest } from './manifest.mjs';
import {
  designStudioArtifactId,
  readDesignRuntimeAsset,
  readDesignStudioRuntime,
  renderDesignStudio,
} from './studio.mjs';

export {
  atomicJson,
  currentDesign,
  designSpecPath,
  hash,
  json,
  readJson,
  recoverDesignPublication,
} from './document-state.mjs';

export const DESIGN_VIEWS = Object.freeze(['canvas', 'prototype', 'walkthrough']);
// Bump when renderer/bridge implementation changes outside the hashed runtime assets.
export const DESIGN_RENDERER_VERSION = '1.3.0';
export function loadDesignDocument(file, { readSource } = {}) {
  const checked = readSource?.(file, process.cwd());
  const path = checked?.file ?? realpathSync(resolve(file));
  const document = assertDesignDocument(
    checked ? JSON.parse(checked.value.toString('utf8')) : readJson(path),
  );
  return { path, root: dirname(path), document };
}
export function inspectDesignDocument(file, { readSource } = {}) {
  const { path, root, document } = loadDesignDocument(file, { readSource });
  const ready = document.variants.filter((variant) => variant.status === 'ready').length;
  const sourceCount = document.screenOrder.length * ready;
  const viewCount = sourceCount * document.frames.length;
  if (sourceCount > 256 || viewCount > 4096)
    throw new RangeError(
      `This board needs ${sourceCount} screen sources and ${viewCount} viewport references. Split it into linked boards: one board supports 256 sources and 4096 views.`,
    );
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
    sources = [],
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
      const sourceId = `source-${hash(`${variant.id}:${screenId}`).slice(0, 32)}`;
      sources.push({ id: sourceId, kind: 'html', html: bundled.html });
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
          sourceId,
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
  const envelope = createSharedArtifactEnvelope({
    sources,
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

function stageRuntimeBytes() {
  const stagePath = new URL(
    '../../../artifact/templates/artifact-review-stage.js',
    import.meta.url,
  );
  // This path is replaced with the packaged equivalent in standalone release units.
  try {
    return readDesignRuntimeAsset(stagePath);
  } catch {
    return readDesignRuntimeAsset(
      new URL('../../templates/artifact-review-stage.js', import.meta.url),
    );
  }
}

export function designRendererRevision() {
  return hash(
    json({
      version: DESIGN_RENDERER_VERSION,
      stage: hash(stageRuntimeBytes()),
      assets: ['studio.css', 'studio.js', 'enhancements.css', 'handoff-center.css']
        .filter(
          (name) =>
            name === 'studio.js' ||
            existsSync(new URL(`../../templates/studio/${name}`, import.meta.url)),
        )
        .map((name) =>
          hash(
            name === 'studio.js'
              ? readDesignStudioRuntime()
              : readFileSync(new URL(`../../templates/studio/${name}`, import.meta.url)),
          ),
        ),
    }),
  );
}

/** Portable file exports use an opaque file origin. HTTP hosts must supply their exact loopback origin. */
export function standaloneDesignHtml(
  prepared,
  view = prepared.document.defaultView,
  {
    parentOrigin = 'null',
    sourceTransport = parentOrigin === 'null' ? 'blob' : 'srcdoc',
    prototypeStateAliases,
  } = {},
) {
  const nonce = createArtifactBridgeNonce();
  const pool = prepared.envelope.schemaVersion === '1.1.0';
  const sources = pool
    ? Object.fromEntries(
        prepared.envelope.sources.map((source) => [
          source.id,
          prepareArtifactSourceTemplate({
            html: source.html,
            nonce,
            parentOrigin,
            allowLocalForms: true,
            prototypeState: true,
            screenId:
              prepared.entries.find(
                (entry) =>
                  prepared.envelope.artifacts.find((artifact) => artifact.id === entry.artifactId)
                    ?.sourceId === source.id,
              )?.screenId ?? source.id,
          }),
        ]),
      )
    : null;
  const artifacts = pool
    ? null
    : Object.fromEntries(
        prepared.envelope.artifacts.map((artifact) => [
          artifact.id,
          prepareArtifactDocument({
            html: resolveArtifactHtml(prepared.envelope, artifact),
            artifactId: artifact.id,
            nonce,
            parentOrigin,
            portable: true,
            allowLocalForms: true,
            prototypeState: true,
            screenId:
              prepared.entries.find((entry) => entry.artifactId === artifact.id)?.screenId ??
              artifact.id,
          }).html,
        ]),
      );
  const stage = stageRuntimeBytes();
  const stageRuntimeUrl = `data:text/javascript;base64,${Buffer.from(stage).toString('base64')}`;
  const runtime = renderArtifactParentRuntime({
    nonce,
    ...(pool
      ? {
          inlineSources: sources,
          inlineArtifactSources: Object.fromEntries(
            prepared.envelope.artifacts.map((artifact) => [artifact.id, artifact.sourceId]),
          ),
        }
      : { inlineArtifacts: artifacts }),
    sourceTransport,
    frameBudget: 3,
    stageRuntimeUrl,
  });
  const configuredRuntime = prototypeStateAliases
    ? `globalThis.__OPENPLANR_DESIGN_STUDIO_OPTIONS__=${JSON.stringify({ prototypeStateAliases }).replaceAll('<', '\\u003c')};\n${runtime}`
    : runtime;
  const runtimeUrl = `data:text/javascript;base64,${Buffer.from(configuredRuntime).toString('base64')}`;
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
