// @ts-check
/** Company publication constraints over the existing, compatible review bundle. */

import { canonicalizeJson, sha256Hex } from './canonical-json.mjs';
import { assertDesignReviewBundle } from './review-experience-contracts.mjs';

/** @type {typeof import('./design-publication-contracts.d.mts').COMPANY_DESIGN_MAX_BYTES} */
export const COMPANY_DESIGN_MAX_BYTES = 1024 * 1024;
/** @type {typeof import('./design-publication-contracts.d.mts').COMPANY_DESIGN_MAX_ENTRIES} */
export const COMPANY_DESIGN_MAX_ENTRIES = 256;
const fail = (message) => {
  throw new TypeError(`Invalid company design bundle: ${message}`);
};
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const closed = (value, keys, label) => {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key)))
    fail(`${label} contains unsupported fields.`);
};
const boundedList = (value, max, label) => {
  if (!Array.isArray(value) || !value.length || value.length > max)
    fail(`${label} must contain 1–${max} items.`);
};
const identities = (items, label) => {
  const map = new Map();
  for (const item of items) {
    if (map.has(item.id)) fail(`${label} contains a duplicate identity.`);
    map.set(item.id, item);
  }
  return map;
};

/**
 * Pure browser/Worker-compatible validation; no artifact or design dependency.
 * @returns {ReturnType<typeof import('./design-publication-contracts.d.mts').assertCompanyDesignBundle>}
 */
export function assertCompanyDesignBundle(value) {
  // Bound complexity before recursive schema validation/canonical serialization.
  /** @type {Array<[unknown, number]>} */
  const pending = [[value, 0]];
  let nodes = 0;
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [item, depth] = next;
    if (++nodes > 50000 || depth > 40) fail('document complexity exceeds the publication limit.');
    if (item && typeof item === 'object')
      for (const child of Object.values(item)) pending.push([child, depth + 1]);
  }
  let serialized;
  try {
    serialized = canonicalizeJson(value);
  } catch {
    fail('expected bounded JSON data.');
  }
  if (new TextEncoder().encode(serialized).byteLength > COMPANY_DESIGN_MAX_BYTES)
    fail('publication exceeds 1 MiB.');
  if (value?.schemaVersion !== '1.1.0')
    fail('company publication requires review bundle version 1.1.0.');
  assertDesignReviewBundle(value);
  const { design, envelope, entries } = value;
  boundedList(design.screens, 64, 'screens');
  boundedList(design.frames, 16, 'frames');
  boundedList(design.variants, 16, 'variants');
  boundedList(entries, COMPANY_DESIGN_MAX_ENTRIES, 'entries');
  const screens = identities(design.screens, 'screens');
  const frames = identities(design.frames, 'frames');
  const variants = identities(design.variants, 'variants');
  if (
    design.variants.some((variant) => variant.status !== 'ready') ||
    !variants.has(design.selectedVariant)
  )
    fail('selected and published variants must be ready.');
  if (
    design.screenOrder.length !== screens.size ||
    design.screenOrder.some((id) => !screens.has(id))
  )
    fail('screen order must identify every published screen.');
  identities(design.flows ?? [], 'flows');
  for (const flow of design.flows ?? [])
    if (flow.screens.some((id) => !screens.has(id))) fail('flow references an unknown screen.');
  if (screens.size * frames.size * variants.size !== entries.length)
    fail('entries must cover every screen, frame and ready variant.');
  closed(envelope, ['schemaVersion', 'artifacts', 'viewer'], 'envelope');
  if (envelope.schemaVersion !== '1.0.0') fail('unsupported envelope version.');
  boundedList(envelope.artifacts, COMPANY_DESIGN_MAX_ENTRIES, 'artifacts');
  const artifacts = identities(envelope.artifacts, 'artifacts');
  if (artifacts.size !== entries.length) fail('entries and artifacts must correspond exactly.');
  for (const artifact of artifacts.values()) {
    closed(
      artifact,
      ['id', 'kind', 'title', 'html', 'sha256', 'viewport', 'colorScheme'],
      'artifact',
    );
    if (typeof artifact.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(artifact.id))
      fail('artifact identity is invalid.');
    if (
      artifact.kind !== 'html' ||
      typeof artifact.title !== 'string' ||
      !artifact.title.trim() ||
      artifact.title.length > 512 ||
      typeof artifact.html !== 'string' ||
      !artifact.html.trim()
    )
      fail('artifacts must be titled HTML screens.');
    closed(artifact.viewport, ['width', 'height'], 'viewport');
    if (!['light', 'dark'].includes(artifact.colorScheme))
      fail('artifact color scheme is invalid.');
    if (
      artifact.sha256 !== sha256Hex(artifact.html.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n'))
    )
      fail('artifact digest does not match its HTML.');
  }
  const usedArtifacts = new Set(),
    combinations = new Set();
  for (const entry of entries) {
    const artifact = artifacts.get(entry.artifactId),
      frame = frames.get(entry.frameId);
    if (!artifact || !frame || !screens.has(entry.screenId) || !variants.has(entry.variantId))
      fail('entry references an unknown screen, variant, frame or artifact.');
    const key = `${entry.screenId}:${entry.variantId}:${entry.frameId}`;
    if (usedArtifacts.has(entry.artifactId) || combinations.has(key))
      fail('entries must uniquely map artboards to artifacts.');
    usedArtifacts.add(entry.artifactId);
    combinations.add(key);
    if (artifact.viewport.width !== frame.width || artifact.viewport.height !== frame.height)
      fail('artifact viewport must match its declared frame.');
  }
  closed(envelope.viewer, ['mode', 'activeArtifactId', 'presentation'], 'viewer');
  if (
    !['single', 'variants'].includes(envelope.viewer.mode) ||
    !artifacts.has(envelope.viewer.activeArtifactId) ||
    envelope.viewer.presentation !== 'canvas'
  )
    fail('viewer must select a published canvas artifact.');
  if (value.fingerprints.length !== entries.length)
    fail('fingerprints must cover every published artboard.');
  for (const key of Object.keys(value.state?.positions ?? {}))
    if (!artifacts.has(key)) fail('layout references an unknown artifact.');
  const components = identities(value.reviewContext.implementation.components, 'review components');
  for (const component of components.values()) {
    if (component.screenIds?.some((id) => !screens.has(id)))
      fail('review guidance references an unknown screen.');
    const anchors = new Set(
      (component.screenIds?.length ? component.screenIds : design.screenOrder).flatMap(
        (id) => screens.get(id).anchors ?? [],
      ),
    );
    if (component.anchorIds?.some((id) => !anchors.has(id)))
      fail('review guidance references an undeclared anchor.');
  }
  return value;
}
