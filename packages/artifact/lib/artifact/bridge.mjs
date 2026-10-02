import { randomBytes } from 'node:crypto';
import { ARTIFACT_ERROR_CODES, PipelineError } from '@openplanr/protocol/errors';

import { ARTIFACT_MAX_SOURCES, ARTIFACT_MAX_VIEWS } from './artifact-sources.mjs';

import { isCapabilityToken, mintCapabilityToken } from './internal/board-token.mjs';
import {
  normalizeArtifactBridgeToolResult,
  normalizeArtifactViewportPan,
  normalizeArtifactViewportZoom,
  renderArtifactBridgeToolsSource,
} from './ui/bridge-tools.mjs';
import { ARTIFACT_HOST_GUARD_TEMPLATE } from './ui/generated/sandbox-guards.mjs';

export {
  ARTIFACT_BRIDGE_CHANNEL,
  ARTIFACT_BRIDGE_EVENT,
  ARTIFACT_BRIDGE_LAYOUT_EVENT,
  ARTIFACT_BRIDGE_READY_EVENT,
  ARTIFACT_BRIDGE_VERSION,
  ARTIFACT_EXPORT_MAX_DATA_URL,
  ARTIFACT_EXPORT_MAX_EDGE,
  ARTIFACT_LAYOUT_MAX_HEIGHT,
  ARTIFACT_LAYOUT_MAX_WIDTH,
  ARTIFACT_VIEWPORT_PAN_EVENT,
  ARTIFACT_VIEWPORT_ZOOM_EVENT,
  artifactContentSecurityPolicy,
  prepareArtifactDocument,
  prepareArtifactSourceTemplate,
  validateArtifactBridgeMessage,
} from './browser-sandbox.mjs';

import {
  ARTIFACT_BRIDGE_CHANNEL,
  ARTIFACT_BRIDGE_EVENT,
  ARTIFACT_BRIDGE_LAYOUT_EVENT,
  ARTIFACT_BRIDGE_READY_EVENT,
  ARTIFACT_BRIDGE_VERSION,
  ARTIFACT_EXPORT_MAX_DATA_URL,
  ARTIFACT_EXPORT_MAX_EDGE,
  ARTIFACT_LAYOUT_MAX_HEIGHT,
  ARTIFACT_LAYOUT_MAX_WIDTH,
  ARTIFACT_VIEWPORT_PAN_EVENT,
  ARTIFACT_VIEWPORT_ZOOM_EVENT,
  SANDBOX_GUARD_LIMITS,
  sandboxGuardFiller,
} from './browser-sandbox.mjs';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/;
function pipelineError(code, message, details) {
  return new PipelineError(code, message, '', details);
}

export function createArtifactBridgeNonce({ randomBytesImpl = randomBytes } = {}) {
  return mintCapabilityToken({ bytes: 32, randomBytesImpl });
}

const fillHostGuard = sandboxGuardFiller('host guard', ARTIFACT_HOST_GUARD_TEMPLATE, [
  '__PLANR_SANDBOX_CONFIG__',
  '__PLANR_SANDBOX_BRIDGE_TOOLS__;',
  ...Object.keys(SANDBOX_GUARD_LIMITS),
]);

function validInlineSourcePool(sources, references) {
  if (
    !sources ||
    typeof sources !== 'object' ||
    Array.isArray(sources) ||
    !references ||
    typeof references !== 'object' ||
    Array.isArray(references)
  )
    return false;
  const entries = Object.entries(sources),
    views = Object.entries(references);
  if (
    !entries.length ||
    entries.length > ARTIFACT_MAX_SOURCES ||
    !views.length ||
    views.length > ARTIFACT_MAX_VIEWS
  )
    return false;
  let bytes = 0;
  for (const [id, source] of entries) {
    if (
      !ID_RE.test(id) ||
      !source ||
      Object.keys(source).length !== 2 ||
      typeof source.html !== 'string' ||
      !/^"artifactId":"template-[A-Za-z0-9_-]{43}"$/u.test(source.artifactIdToken) ||
      source.html.split(source.artifactIdToken).length !== 2
    )
      return false;
    bytes += Buffer.byteLength(source.html);
    if (bytes > 100 * 1024 * 1024) return false;
  }
  return (
    views.every(
      ([id, sourceId]) =>
        ID_RE.test(id) && typeof sourceId === 'string' && Object.hasOwn(sources, sourceId),
    ) && new Set(Object.values(references)).size === entries.length
  );
}

/**
 * Generate the trusted parent bootstrap. It fetches token-protected HTML into
 * Blob URLs and exposes only a nonce/source-bound geometry client to the stage.
 */
export function renderArtifactParentRuntime({
  artifactBaseUrl,
  stageRuntimeUrl,
  adapterRuntimeUrl,
  nonce,
  inlineArtifacts,
  inlineSources,
  inlineArtifactSources,
  sourceTransport = 'blob',
  frameBudget,
} = {}) {
  const canonicalPath = (value, { trailingSlash = false } = {}) => {
    if (
      typeof value !== 'string' ||
      !value.startsWith('/') ||
      value.startsWith('//') ||
      value.includes('\\') ||
      value.includes('?') ||
      value.includes('#') ||
      /[\u0000-\u001f]/.test(value) ||
      /%(?:00|2f|5c)/i.test(value) ||
      (trailingSlash ? !value.endsWith('/') : value.endsWith('/'))
    )
      return false;
    try {
      return value
        .split('/')
        .filter(Boolean)
        .every((segment) => {
          const decoded = decodeURIComponent(segment);
          return (
            decoded !== '.' && decoded !== '..' && !decoded.includes('/') && !decoded.includes('\\')
          );
        });
    } catch {
      return false;
    }
  };
  const legacyPortable =
    inlineArtifacts &&
    typeof inlineArtifacts === 'object' &&
    !Array.isArray(inlineArtifacts) &&
    Object.values(inlineArtifacts).every((html) => typeof html === 'string');
  const pooledPortable = validInlineSourcePool(inlineSources, inlineArtifactSources);
  const portable = legacyPortable || pooledPortable;
  if (
    ((inlineSources !== undefined || inlineArtifactSources !== undefined) &&
      (!pooledPortable || inlineArtifacts !== undefined)) ||
    (!portable && !canonicalPath(artifactBaseUrl, { trailingSlash: true })) ||
    !(
      canonicalPath(stageRuntimeUrl) ||
      (portable && /^data:text\/javascript;base64,[A-Za-z0-9+/=]+$/u.test(stageRuntimeUrl))
    ) ||
    (adapterRuntimeUrl !== undefined && !canonicalPath(adapterRuntimeUrl)) ||
    !isCapabilityToken(nonce) ||
    !['blob', 'srcdoc'].includes(sourceTransport) ||
    (frameBudget !== undefined &&
      (!Number.isInteger(frameBudget) || frameBudget < 1 || frameBudget > 8))
  ) {
    throw pipelineError(
      ARTIFACT_ERROR_CODES.BRIDGE_INVALID,
      'Artifact parent runtime configuration is invalid.',
    );
  }
  const config = JSON.stringify({
    artifactBaseUrl,
    stageRuntimeUrl,
    adapterRuntimeUrl: adapterRuntimeUrl ?? null,
    nonce,
    inlineArtifacts: legacyPortable ? inlineArtifacts : null,
    ...(pooledPortable ? { inlineSources, inlineArtifactSources } : {}),
    sourceTransport,
    ...(frameBudget === undefined ? {} : { frameBudget }),
    channel: ARTIFACT_BRIDGE_CHANNEL,
    schemaVersion: ARTIFACT_BRIDGE_VERSION,
    anchorEvent: ARTIFACT_BRIDGE_EVENT,
    readyEvent: ARTIFACT_BRIDGE_READY_EVENT,
    layoutEvent: ARTIFACT_BRIDGE_LAYOUT_EVENT,
    viewportZoomEvent: ARTIFACT_VIEWPORT_ZOOM_EVENT,
    viewportPanEvent: ARTIFACT_VIEWPORT_PAN_EVENT,
    navigationEvent: 'planr:artifact-navigation-blocked',
    frameCsp: [
      "default-src 'none'",
      "script-src 'unsafe-inline' data: blob:",
      "script-src-attr 'unsafe-inline'",
      "style-src 'unsafe-inline' data: blob:",
      'img-src data: blob:',
      'media-src data: blob:',
      'font-src data:',
      'worker-src data: blob:',
      "connect-src 'none'",
      "frame-src 'none'",
      "child-src 'none'",
      "object-src 'none'",
      "manifest-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ].join('; '),
  });
  return fillHostGuard({
    __PLANR_SANDBOX_CONFIG__: config,
    '__PLANR_SANDBOX_BRIDGE_TOOLS__;': renderArtifactBridgeToolsSource(),
    ...SANDBOX_GUARD_LIMITS,
  });
}
