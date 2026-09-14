/** Authored, share-safe review guidance. No owner or project discovery data. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { canonicalizeJson } from '@openplanr/protocol/canonical-json';
import { assertReviewExperience, DESIGN_REVIEW_CONTEXT_SCHEMA } from '@openplanr/protocol/review-experience-contracts';
import { resolveLocalDocumentFile } from '@openplanr/artifact/local-document.mjs';

export const reviewDigest = value => createHash('sha256').update(canonicalizeJson(value)).digest('hex');
export function emptyReviewContext(document) {
  return { kind: 'openplanr-design-review-context', schemaVersion: '1.0.0', designId: document.id,
    brief: { purpose: '', requests: [] }, implementation: { tokens: [], components: [], responsive: [], accessibility: [] } };
}
export function loadReviewContext(root, document, { readSource } = {}) {
  const file = join(root, 'review-context.json');
  if (!existsSync(file)) return emptyReviewContext(document);
  const context = JSON.parse(readSource ? readSource('review-context.json', root).value.toString('utf8') : readFileSync(resolveLocalDocumentFile(root, 'review-context.json'), 'utf8'));
  assertReviewExperience(context, DESIGN_REVIEW_CONTEXT_SCHEMA);
  if (context.designId !== document.id) throw new Error('Review context belongs to a different design.');
  const screens = new Set(document.screenOrder);
  const ids = new Set();
  for (const component of context.implementation.components) {
    if (ids.has(component.id)) throw new Error('Review component identities must be unique.');
    ids.add(component.id);
    if (component.screenIds?.some(id => !screens.has(id))) throw new Error(`Component ${component.id} references an unknown screen.`);
  }
  // Context is intentionally public-to-authorized-reviewers, not a raw local spec dump.
  if (/(?:file:\/\/|\/(?:Users|home|private|tmp|var|etc|opt|Volumes)\/|[A-Za-z]:\\\\|\\\\\\\\)/u.test(JSON.stringify(context))) throw new Error('Review context contains a local filesystem path. Use share-safe implementation guidance.');
  return context;
}
export function reviewFingerprints({ document, context, screen, variant, frame, sourceDigests }) {
  const components = context.implementation.components.filter(component => !component.screenIds?.length || component.screenIds.includes(screen.id));
  return { screenId: screen.id, variantId: variant.id, frameId: frame.id,
    contentDigest: reviewDigest({ files: Object.entries(sourceDigests).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)), width: frame.width, height: frame.height }),
    guidanceDigest: reviewDigest({ title: screen.title, description: screen.description ?? '', anchors: screen.anchors ?? [], variant: { label: variant.label, description: variant.description ?? '' }, frameLabel: frame.label, components, tokens: context.implementation.tokens, responsive: context.implementation.responsive, accessibility: context.implementation.accessibility }),
  };
}
export function bundleDesignRevision(current, state = {}) {
  const { document } = current;
  const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, structuredClone(value[key])]));
  const context = current.reviewContext ?? emptyReviewContext(document);
  return {
    kind: 'openplanr-design-review-bundle', schemaVersion: '1.1.0',
    design: { ...pick(document, ['id', 'title', 'defaultView', 'selectedVariant', 'screenOrder', 'frames', 'flows']),
      screens: document.screens.map(screen => pick(screen, ['id', 'title', 'description', 'anchors'])),
      selectedVariant: document.variants.some(variant => variant.id === state.selectedVariant && variant.status === 'ready') ? state.selectedVariant : document.selectedVariant,
      variants: document.variants.filter(variant => variant.status === 'ready').map(variant => pick(variant, ['id', 'label', 'status'])),
    },
    envelope: structuredClone(current.envelope), entries: structuredClone(current.entries), state: pick(state, ['positions']),
    revision: current.revision, verification: pick(current.verification ?? {}, ['status']),
    reviewContext: context, contextDigest: current.contextDigest ?? reviewDigest(context), fingerprints: current.fingerprints ?? [],
  };
}
const localRoot = file => realpathSync(dirname(resolve(file)));
export function listDesignRevisions(file) {
  const root = localRoot(file);
  const pointer = JSON.parse(readFileSync(join(root, '.design/current.json'), 'utf8'));
  const revisions = readdirSync(join(root, '.design/revisions')).filter(name => /^[a-f0-9]{64}$/u.test(name)).map(revision => {
    const value = JSON.parse(readFileSync(join(root, '.design/revisions', revision, 'render.json'), 'utf8'));
    return { revision, createdAt: value.manifest.generated_at, summary: value.reviewContext?.revisionSummary ?? '', fingerprints: value.fingerprints ?? [] };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { revisions, currentRevision: pointer.revision };
}
export function readDesignRevision(file, revision) {
  if (!/^[a-f0-9]{64}$/u.test(revision)) throw new Error('Invalid design revision identity.');
  const root = localRoot(file);
  const value = JSON.parse(readFileSync(resolveLocalDocumentFile(root, `.design/revisions/${revision}/render.json`), 'utf8'));
  return bundleDesignRevision(value);
}
