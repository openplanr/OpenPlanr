/** Canonical sandbox preparation shared by Node owners and trusted browser hosts.
 * Parse only the selected source in the viewer; authored scripts never run while parsing.
 */

import { ARTIFACT_ERROR_CODES, PipelineError } from '@openplanr/protocol/errors';
import { parse, parseFragment, serialize } from 'parse5';
import {
  normalizeArtifactBridgeToolResult,
  normalizeArtifactViewportPan,
  normalizeArtifactViewportZoom,
  renderArtifactBridgeToolsSource,
} from './ui/bridge-tools.mjs';
import {
  ARTIFACT_FRAME_GUARD_TEMPLATE,
  ARTIFACT_WORKER_GUARD_SOURCE,
} from './ui/generated/sandbox-guards.mjs';
import { renderPrototypeStateInstaller } from './ui/prototype-state.mjs';

function pipelineError(code, message, details) {
  return new PipelineError(code, message, '', details);
}
function browserCapabilityToken({ bytes = 32 } = {}) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}
function isCapabilityToken(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) return false;
  try {
    const decoded = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '=');
    return (
      decoded.length === 32 &&
      btoa(decoded).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '') === value
    );
  } catch {
    return false;
  }
}
function validHostedOrigin(origin) {
  if (typeof origin !== 'string') return false;
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === 'https:' &&
      parsed.origin === origin &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}
export const ARTIFACT_BRIDGE_CHANNEL = 'openplanr.artifact-anchor';
export const ARTIFACT_BRIDGE_VERSION = '1.0.0';
export const ARTIFACT_BRIDGE_EVENT = 'planr:artifact-anchor';
export const ARTIFACT_BRIDGE_READY_EVENT = 'planr:artifact-bridge-ready';
export const ARTIFACT_BRIDGE_LAYOUT_EVENT = 'planr:artifact-layout';
export const ARTIFACT_VIEWPORT_ZOOM_EVENT = 'planr:artifact-viewport-zoom';
export const ARTIFACT_VIEWPORT_PAN_EVENT = 'planr:artifact-viewport-pan';
export const ARTIFACT_EXPORT_MAX_EDGE = 11_000;
export const ARTIFACT_EXPORT_MAX_DATA_URL = 24 * 1024 * 1024;
export const ARTIFACT_LAYOUT_MAX_WIDTH = 16_384;
export const ARTIFACT_LAYOUT_MAX_HEIGHT = 262_144;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SCRIPT_NONCE_RE = /^[A-Za-z0-9_-]{24}$/;
const FORBIDDEN_TAGS = new Set([
  'applet',
  'base',
  'embed',
  'fencedframe',
  'form',
  'frame',
  'frameset',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'object',
  'portal',
]);
const URL_ATTRIBUTES = new Set([
  'action',
  'archive',
  'background',
  'classid',
  'codebase',
  'formaction',
  'href',
  'longdesc',
  'manifest',
  'ping',
  'profile',
  'src',
  'srcdoc',
  'target',
  'xlink:href',
]);
const REMOTE_URL_RE = /^(?:https?:|file:|ftp:|wss?:|\/\/)/i;

function getAttr(node, name) {
  return node.attrs?.find((attribute) => attribute.name.toLowerCase() === name)?.value;
}

function setAttr(node, name, value) {
  const existing = node.attrs?.find((attribute) => attribute.name.toLowerCase() === name);
  if (existing) existing.value = value;
  else {
    node.attrs ??= [];
    node.attrs.push({ name, value });
  }
}

function createElement(tagName) {
  return parseFragment(`<${tagName}></${tagName}>`).childNodes[0];
}

function createText(value, parentNode) {
  return { nodeName: '#text', value, parentNode };
}

function descendants(node) {
  return [...(node?.childNodes ?? []), ...(node?.content?.childNodes ?? [])];
}

function removeNode(node) {
  const parent = node.parentNode;
  const index = parent?.childNodes?.indexOf(node) ?? -1;
  if (index >= 0) parent.childNodes.splice(index, 1);
}

function findElement(document, tagName) {
  const queue = descendants(document);
  while (queue.length > 0) {
    const node = queue.shift();
    if (node?.tagName?.toLowerCase() === tagName) return node;
    queue.push(...descendants(node));
  }
  return null;
}

export function artifactContentSecurityPolicy(scriptNonce) {
  if (typeof scriptNonce !== 'string' || !SCRIPT_NONCE_RE.test(scriptNonce)) {
    throw pipelineError(ARTIFACT_ERROR_CODES.SANDBOX_POLICY, 'Artifact script nonce is invalid.');
  }
  return [
    "default-src 'none'",
    `script-src 'nonce-${scriptNonce}' data: blob:`,
    `script-src-elem 'nonce-${scriptNonce}' data: blob:`,
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
  ].join('; ');
}

function assertSandboxableTree(document, { allowLocalForms = false } = {}) {
  const queue = descendants(document);
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node?.tagName) {
      queue.push(...descendants(node));
      continue;
    }
    const tag = node.tagName.toLowerCase();
    if (FORBIDDEN_TAGS.has(tag) && !(tag === 'form' && allowLocalForms)) {
      throw pipelineError(
        ARTIFACT_ERROR_CODES.SANDBOX_POLICY,
        `Unsafe <${tag}> cannot enter an artifact review sandbox.`,
      );
    }
    if (tag === 'meta' && getAttr(node, 'http-equiv')?.trim().toLowerCase() === 'refresh') {
      throw pipelineError(
        ARTIFACT_ERROR_CODES.SANDBOX_POLICY,
        'Meta refresh navigation is forbidden.',
      );
    }
    for (const attribute of node.attrs ?? []) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (['srcdoc', 'target', 'action', 'formaction'].includes(name)) {
        throw pipelineError(
          ARTIFACT_ERROR_CODES.SANDBOX_POLICY,
          `Artifact navigation attribute ${name} is forbidden.`,
        );
      }
      if (URL_ATTRIBUTES.has(name) && REMOTE_URL_RE.test(value)) {
        throw pipelineError(
          ARTIFACT_ERROR_CODES.SANDBOX_POLICY,
          `Remote artifact resource is forbidden: ${value.slice(0, 80)}`,
        );
      }
      if (name === 'style' && /(?:@import|url\s*\(\s*['"]?(?:https?:|file:|\/\/))/i.test(value)) {
        throw pipelineError(ARTIFACT_ERROR_CODES.SANDBOX_POLICY, 'Remote inline CSS is forbidden.');
      }
    }
    if (tag === 'style') {
      const css = (node.childNodes ?? []).map((child) => child.value ?? '').join('');
      if (/(?:@import|url\s*\(\s*['"]?(?:https?:|file:|\/\/))/i.test(css)) {
        throw pipelineError(
          ARTIFACT_ERROR_CODES.SANDBOX_POLICY,
          'Remote stylesheet resources are forbidden.',
        );
      }
    }
    queue.push(...descendants(node));
  }
}

export const SANDBOX_GUARD_LIMITS = Object.freeze({
  __PLANR_SANDBOX_EXPORT_MAX_EDGE__: String(ARTIFACT_EXPORT_MAX_EDGE),
  __PLANR_SANDBOX_EXPORT_MAX_DATA_URL__: String(ARTIFACT_EXPORT_MAX_DATA_URL),
  __PLANR_SANDBOX_LAYOUT_MAX_WIDTH__: String(ARTIFACT_LAYOUT_MAX_WIDTH),
  __PLANR_SANDBOX_LAYOUT_MAX_HEIGHT__: String(ARTIFACT_LAYOUT_MAX_HEIGHT),
});

/**
 * Returns a filler for one generated guard template, or throws when the template and `keys`
 * disagree. One pass over the template, so text a value brings in is never read as a placeholder.
 */
export function sandboxGuardFiller(name, template, keys) {
  const pattern = new RegExp(keys.join('|'), 'gu');
  const unfilled = [...new Set(template.replace(pattern, '').match(/__PLANR_SANDBOX_[A-Z_]+__/gu))];
  const missing = keys.filter((key) => !template.includes(key));
  if (unfilled.length > 0 || missing.length > 0) {
    throw pipelineError(
      ARTIFACT_ERROR_CODES.BRIDGE_INVALID,
      `The generated ${name} does not match bridge.mjs (unfilled: ${unfilled.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}). Run npm run generate.`,
    );
  }
  return (values) =>
    template.replace(pattern, (key) => {
      if (typeof values[key] !== 'string') {
        throw pipelineError(
          ARTIFACT_ERROR_CODES.BRIDGE_INVALID,
          `The ${name} needs a string for ${key}; received ${typeof values[key]}.`,
        );
      }
      return values[key];
    });
}

const fillFrameGuard = sandboxGuardFiller('frame guard', ARTIFACT_FRAME_GUARD_TEMPLATE, [
  '__PLANR_SANDBOX_CONTRACT__',
  '__PLANR_SANDBOX_BRIDGE_TOOLS__;',
  '__PLANR_SANDBOX_WORKER_GUARD__',
  ...Object.keys(SANDBOX_GUARD_LIMITS),
]);
function artifactGuardAndBridgeSource({
  artifactId,
  nonce,
  parentOrigin,
  prototypeState = false,
  reviewSelection = false,
  screenId = artifactId,
}) {
  const contract = JSON.stringify({
    channel: ARTIFACT_BRIDGE_CHANNEL,
    schemaVersion: ARTIFACT_BRIDGE_VERSION,
    artifactId,
    nonce,
    parentOrigin,
    ...(prototypeState ? { screenId } : {}),
    ...(reviewSelection ? { reviewSelection: true } : {}),
  }).replace(/</gu, '\\u003c');

  const guard = fillFrameGuard({
    __PLANR_SANDBOX_CONTRACT__:
      prototypeState || reviewSelection ? '__openplanrPrototypeContract' : contract,
    '__PLANR_SANDBOX_BRIDGE_TOOLS__;': renderArtifactBridgeToolsSource(),
    __PLANR_SANDBOX_WORKER_GUARD__: JSON.stringify(ARTIFACT_WORKER_GUARD_SOURCE),
    ...SANDBOX_GUARD_LIMITS,
  });
  if (!prototypeState && !reviewSelection) return guard;
  // Serialize the contract once: pooled sources replace exactly this artifactId.
  const prototypeInstaller = prototypeState
    ? `(${renderPrototypeStateInstaller()})(__openplanrPrototypeContract.screenId,__openplanrPrototypeContract.artifactId,__openplanrPrototypeContract.parentOrigin === 'null' ? '*' : __openplanrPrototypeContract.parentOrigin,__openplanrPrototypeContract.nonce);`
    : '';
  return `(function(__openplanrPrototypeContract){${guard};${prototypeInstaller}(${installPreviewNavigation.toString()})(__openplanrPrototypeContract);})(${contract});`;
}
function installPreviewNavigation(contract) {
  const trustedParent = parent,
    post = trustedParent.postMessage.bind(trustedParent),
    NativeElement = Element,
    svgRoots = [],
    svgClick = () => {},
    addListener = EventTarget.prototype.addEventListener,
    removeListener = EventTarget.prototype.removeEventListener,
    queryAll = Document.prototype.querySelectorAll,
    query = NativeElement.prototype.querySelector,
    closest = NativeElement.prototype.closest,
    attribute = NativeElement.prototype.getAttribute,
    preventDefault = Event.prototype.preventDefault,
    stopImmediatePropagation = Event.prototype.stopImmediatePropagation,
    descriptors = Object.getOwnPropertyDescriptors,
    prototype = Object.getPrototypeOf,
    objectPrototype = Object.prototype,
    keys = Reflect.ownKeys;
  let selectionEnabled = false;
  if (contract.reviewSelection === true)
    addEventListener('message', (event) => {
      if (event.source !== trustedParent || event.origin !== contract.parentOrigin) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      const dataPrototype = prototype(data);
      if (dataPrototype !== objectPrototype && dataPrototype !== null) return;
      const fields = descriptors(data),
        allowed = ['schemaVersion', 'type', 'channel', 'viewId', 'enabled'];
      if (
        keys(fields).length !== allowed.length ||
        allowed.some((key) => !fields[key]?.enumerable || !('value' in fields[key]))
      )
        return;
      if (
        fields.schemaVersion.value !== '1.0.0' ||
        fields.type.value !== 'openplanr:review-selection' ||
        fields.channel.value !== contract.nonce ||
        fields.viewId.value !== contract.artifactId ||
        typeof fields.enabled.value !== 'boolean'
      )
        return;
      selectionEnabled = fields.enabled.value;
      for (const svg of svgRoots) removeListener.call(svg, 'click', svgClick);
      svgRoots.length = 0;
      if (selectionEnabled)
        for (const svg of queryAll.call(document, 'svg')) {
          if (
            !attribute.call(svg, 'data-planr-id') &&
            !attribute.call(svg, 'data-element-id') &&
            !query.call(svg, '[data-planr-id],[data-element-id]')
          )
            continue;
          // WebKit synthesizes native SVG taps only with a direct click listener.
          // The document capture handler still validates and sends the selection.
          addListener.call(svg, 'click', svgClick);
          svgRoots.push(svg);
        }
    });
  document.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof NativeElement)) return;
      if (selectionEnabled) {
        const target = closest.call(event.target, '[data-planr-id],[data-element-id]'),
          elementId = target
            ? (attribute.call(target, 'data-planr-id') ?? attribute.call(target, 'data-element-id'))
            : null;
        if (!elementId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(elementId)) return;
        preventDefault.call(event);
        stopImmediatePropagation.call(event);
        post(
          {
            schemaVersion: '1.0.0',
            channel: contract.nonce,
            type: 'select',
            viewId: contract.artifactId,
            elementId,
          },
          contract.parentOrigin === 'null' ? '*' : contract.parentOrigin,
        );
        return;
      }
      if (!contract.screenId) return;
      const target = closest.call(
        event.target,
        '[data-design-target],[data-planr-navigate],[data-design-navigate]',
      );
      if (!target) return;
      const screenId =
        target.getAttribute('data-design-target') ||
        target.getAttribute('data-planr-navigate') ||
        target.getAttribute('data-design-navigate');
      if (!screenId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(screenId)) return;
      event.preventDefault();
      post(
        {
          schemaVersion: '1.0.0',
          channel: contract.nonce,
          type: 'navigate',
          viewId: contract.artifactId,
          screenId,
        },
        contract.parentOrigin === 'null' ? '*' : contract.parentOrigin,
      );
    },
    true,
  );
}

/**
 * Add the early artifact CSP and bridge without changing the canonical envelope
 * bytes. The returned HTML is an execution copy used only by the local viewer.
 */
export function prepareArtifactDocument({
  html,
  artifactId,
  nonce,
  parentOrigin,
  scriptNonce = browserCapabilityToken({ bytes: 18 }),
  allowLocalForms = false,
  portable = false,
  trustedParentOrigin,
  screenId = artifactId,
  prototypeState = false,
  reviewSelection = false,
} = {}) {
  if (typeof html !== 'string' || html.length === 0) {
    throw pipelineError(ARTIFACT_ERROR_CODES.SANDBOX_POLICY, 'Artifact HTML is required.');
  }
  if (typeof artifactId !== 'string' || !ID_RE.test(artifactId)) {
    throw pipelineError(ARTIFACT_ERROR_CODES.SANDBOX_POLICY, 'Artifact id is invalid.');
  }
  if (!isCapabilityToken(nonce)) {
    throw pipelineError(ARTIFACT_ERROR_CODES.SANDBOX_POLICY, 'Artifact bridge nonce is invalid.');
  }
  if (typeof reviewSelection !== 'boolean')
    throw pipelineError(
      ARTIFACT_ERROR_CODES.SANDBOX_POLICY,
      'Artifact review selection option must be a boolean.',
    );
  if (reviewSelection && artifactId.length > 128)
    throw pipelineError(
      ARTIFACT_ERROR_CODES.SANDBOX_POLICY,
      'Review selection requires an artifact view id of at most 128 characters.',
    );
  if (prototypeState && (typeof screenId !== 'string' || !ID_RE.test(screenId)))
    throw pipelineError(
      ARTIFACT_ERROR_CODES.SANDBOX_POLICY,
      'Prototype screen identity is invalid.',
    );
  const originMatch = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(parentOrigin ?? '');
  const originPort = Number(originMatch?.[1]);
  if (
    !(portable && parentOrigin === 'null') &&
    !(portable && parentOrigin === trustedParentOrigin && validHostedOrigin(parentOrigin)) &&
    (!originMatch ||
      !Number.isInteger(originPort) ||
      originPort < 1 ||
      originPort > 65_535 ||
      String(originPort) !== originMatch[1])
  ) {
    throw pipelineError(
      ARTIFACT_ERROR_CODES.SANDBOX_POLICY,
      'Artifact parent origin must be IPv4 loopback or an explicitly trusted HTTPS origin.',
    );
  }
  const document = parse(html, { sourceCodeLocationInfo: false });
  assertSandboxableTree(document, { allowLocalForms });
  const head = findElement(document, 'head');
  if (!head)
    throw pipelineError(
      ARTIFACT_ERROR_CODES.SANDBOX_POLICY,
      'Artifact document has no head element.',
    );

  for (const node of [...descendants(head)]) {
    if (node?.tagName?.toLowerCase() === 'meta') {
      const httpEquiv = getAttr(node, 'http-equiv')?.trim().toLowerCase();
      if (httpEquiv === 'content-security-policy') removeNode(node);
    }
  }
  const csp = artifactContentSecurityPolicy(scriptNonce);
  const hasViewport = descendants(head).some(
    (node) =>
      node?.tagName?.toLowerCase() === 'meta' &&
      getAttr(node, 'name')?.trim().toLowerCase() === 'viewport',
  );
  const viewportMeta = hasViewport ? null : createElement('meta');
  if (viewportMeta) {
    setAttr(viewportMeta, 'name', 'viewport');
    setAttr(viewportMeta, 'content', 'width=device-width,initial-scale=1,viewport-fit=cover');
    viewportMeta.parentNode = head;
  }
  const cspMeta = createElement('meta');
  setAttr(cspMeta, 'http-equiv', 'Content-Security-Policy');
  setAttr(cspMeta, 'content', csp);
  cspMeta.parentNode = head;
  const referrerMeta = createElement('meta');
  setAttr(referrerMeta, 'name', 'referrer');
  setAttr(referrerMeta, 'content', 'no-referrer');
  referrerMeta.parentNode = head;
  const bridge = createElement('script');
  setAttr(bridge, 'nonce', scriptNonce);
  bridge.childNodes = [
    createText(
      artifactGuardAndBridgeSource({
        artifactId,
        nonce,
        parentOrigin,
        prototypeState,
        reviewSelection,
        screenId,
      }),
      bridge,
    ),
  ];
  bridge.parentNode = head;

  const queue = descendants(document);
  while (queue.length > 0) {
    const node = queue.shift();
    if (node?.tagName?.toLowerCase() === 'script') setAttr(node, 'nonce', scriptNonce);
    queue.push(...descendants(node));
  }
  head.childNodes = [
    cspMeta,
    referrerMeta,
    ...(viewportMeta ? [viewportMeta] : []),
    bridge,
    ...(head.childNodes ?? []),
  ];
  return Object.freeze({ html: serialize(document), csp, scriptNonce });
}

/** Prepare a shared portable source once; bind its generated bridge identity for each viewport. */
export function prepareArtifactSourceTemplate(options = {}) {
  const artifactId = `template-${browserCapabilityToken()}`;
  const prepared = prepareArtifactDocument({
    ...options,
    artifactId,
    portable: true,
    parentOrigin: options.parentOrigin ?? 'null',
  });
  const artifactIdToken = `"artifactId":${JSON.stringify(artifactId)}`;
  if (prepared.html.split(artifactIdToken).length !== 2)
    throw pipelineError(
      ARTIFACT_ERROR_CODES.BRIDGE_INVALID,
      'Shared source bridge identity is not unique.',
    );
  return Object.freeze({ html: prepared.html, artifactIdToken });
}

/** Prepare an execution copy for a dedicated trusted preview site. Never pass company credentials. */
export function prepareHostedArtifactDocument(options = {}) {
  if (!validHostedOrigin(options.parentOrigin))
    throw pipelineError(
      ARTIFACT_ERROR_CODES.SANDBOX_POLICY,
      'Hosted preview requires an exact HTTPS origin.',
    );
  return prepareArtifactDocument({
    ...options,
    portable: true,
    trustedParentOrigin: options.parentOrigin,
  });
}

function timingSafeTokenEqual(left, right) {
  if (!isCapabilityToken(left) || !isCapabilityToken(right)) return false;
  let difference = 0;
  for (let index = 0; index < 43; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataValue(value, key) {
  const descriptor = isPlainRecord(value) ? Object.getOwnPropertyDescriptor(value, key) : null;
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function exactKeys(value, allowed) {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function bridgeFailure(reason, details) {
  return Object.freeze({
    ok: false,
    code: ARTIFACT_ERROR_CODES.BRIDGE_INVALID,
    reason,
    fallback: 'coordinates',
    ...(details === undefined ? {} : { details }),
  });
}

/** Pure parent-side validator. Invalid messages preserve coordinate fallback. */
export function validateArtifactBridgeMessage(
  event,
  {
    source,
    nonce,
    artifactId,
    viewport,
    pendingRequestIds,
    pendingChallengeIds,
    viewportGesturesEnabled = false,
  } = {},
) {
  if (
    !source ||
    !isCapabilityToken(nonce) ||
    typeof artifactId !== 'string' ||
    !ID_RE.test(artifactId)
  ) {
    return bridgeFailure('contract');
  }
  if (!event || event.source !== source) return bridgeFailure('source');
  if (event.origin !== 'null') return bridgeFailure('origin');
  const data = event.data;
  if (!isPlainRecord(data)) return bridgeFailure('schema');
  const type = ownDataValue(data, 'type');
  const baseKeys = new Set(['channel', 'schemaVersion', 'type', 'nonce', 'artifactId']);
  if (['inspect.result', 'inspect.miss', 'thumbnail.result', 'thumbnail.error'].includes(type)) {
    if (
      ownDataValue(data, 'channel') !== ARTIFACT_BRIDGE_CHANNEL ||
      ownDataValue(data, 'schemaVersion') !== ARTIFACT_BRIDGE_VERSION ||
      !timingSafeTokenEqual(ownDataValue(data, 'nonce'), nonce) ||
      ownDataValue(data, 'artifactId') !== artifactId
    )
      return bridgeFailure('contract');
    const requestId = ownDataValue(data, 'requestId');
    if (
      typeof requestId !== 'string' ||
      !REQUEST_ID_RE.test(requestId) ||
      !(pendingRequestIds instanceof Set) ||
      !pendingRequestIds.has(requestId)
    )
      return bridgeFailure('request');
    const result = normalizeArtifactBridgeToolResult(
      type.startsWith('inspect.') ? 'inspect.point' : 'thumbnail.request',
      data,
      viewport,
    );
    return result.valid
      ? Object.freeze({
          ok: true,
          value: Object.freeze({ type, artifactId, requestId, result: result.value }),
        })
      : bridgeFailure('tool-result');
  }
  if (type === 'bridge.ready') {
    if (!exactKeys(data, baseKeys)) return bridgeFailure('schema');
  } else if (type === 'viewport.zoom') {
    if (!exactKeys(data, new Set([...baseKeys, 'x', 'y', 'deltaY'])))
      return bridgeFailure('schema');
  } else if (type === 'viewport.pan') {
    if (!exactKeys(data, new Set([...baseKeys, 'deltaX', 'deltaY'])))
      return bridgeFailure('schema');
  } else if (type === 'layout.measurement') {
    if (!exactKeys(data, new Set([...baseKeys, 'layout']))) return bridgeFailure('schema');
  } else if (type === 'bridge.challenge-ack' || type === 'anchor.miss') {
    if (!exactKeys(data, new Set([...baseKeys, 'requestId']))) return bridgeFailure('schema');
  } else if (type === 'anchor.result') {
    if (!exactKeys(data, new Set([...baseKeys, 'requestId', 'anchor'])))
      return bridgeFailure('schema');
  } else if (type === 'export.error') {
    if (!exactKeys(data, new Set([...baseKeys, 'requestId', 'reason'])))
      return bridgeFailure('schema');
  } else if (type === 'export.result') {
    if (
      !exactKeys(data, new Set([...baseKeys, 'requestId', 'dataUrl', 'width', 'height', 'label']))
    )
      return bridgeFailure('schema');
  } else {
    return bridgeFailure('type');
  }
  if (
    ownDataValue(data, 'channel') !== ARTIFACT_BRIDGE_CHANNEL ||
    ownDataValue(data, 'schemaVersion') !== ARTIFACT_BRIDGE_VERSION
  ) {
    return bridgeFailure('schema');
  }
  if (!timingSafeTokenEqual(ownDataValue(data, 'nonce'), nonce)) return bridgeFailure('nonce');
  if (ownDataValue(data, 'artifactId') !== artifactId) return bridgeFailure('artifact');
  if (type === 'viewport.zoom') {
    if (viewportGesturesEnabled !== true) return bridgeFailure('disabled');
    const zoom = normalizeArtifactViewportZoom(
      {
        x: ownDataValue(data, 'x'),
        y: ownDataValue(data, 'y'),
        deltaY: ownDataValue(data, 'deltaY'),
      },
      viewport,
    );
    return zoom
      ? Object.freeze({ ok: true, value: Object.freeze({ type, artifactId, zoom }) })
      : bridgeFailure('viewport');
  }
  if (type === 'viewport.pan') {
    if (viewportGesturesEnabled !== true) return bridgeFailure('disabled');
    const pan = normalizeArtifactViewportPan({
      deltaX: ownDataValue(data, 'deltaX'),
      deltaY: ownDataValue(data, 'deltaY'),
    });
    return pan
      ? Object.freeze({ ok: true, value: Object.freeze({ type, artifactId, pan }) })
      : bridgeFailure('viewport');
  }
  if (type === 'bridge.ready') {
    return Object.freeze({
      ok: true,
      value: Object.freeze({ type, artifactId, authenticated: false }),
    });
  }
  if (type === 'layout.measurement') {
    const layout = ownDataValue(data, 'layout');
    if (!exactKeys(layout, new Set(['width', 'height']))) return bridgeFailure('layout');
    const layoutWidth = ownDataValue(layout, 'width');
    const layoutHeight = ownDataValue(layout, 'height');
    if (
      !Number.isInteger(layoutWidth) ||
      !Number.isInteger(layoutHeight) ||
      layoutWidth < 1 ||
      layoutWidth > ARTIFACT_LAYOUT_MAX_WIDTH ||
      layoutHeight < 1 ||
      layoutHeight > ARTIFACT_LAYOUT_MAX_HEIGHT
    ) {
      return bridgeFailure('layout');
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        type,
        artifactId,
        authenticated: true,
        layout: Object.freeze({ width: layoutWidth, height: layoutHeight }),
      }),
    });
  }

  const requestId = ownDataValue(data, 'requestId');
  if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId))
    return bridgeFailure('request');
  if (type === 'bridge.challenge-ack') {
    if (!(pendingChallengeIds instanceof Set) || !pendingChallengeIds.has(requestId)) {
      return bridgeFailure('request');
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({ type, artifactId, requestId, authenticated: true }),
    });
  }
  if (!(pendingRequestIds instanceof Set) || !pendingRequestIds.has(requestId)) {
    return bridgeFailure('request');
  }
  if (type === 'export.error') {
    const reason = ownDataValue(data, 'reason');
    if (typeof reason !== 'string' || reason.length > 256) return bridgeFailure('export');
    return Object.freeze({
      ok: true,
      value: Object.freeze({ type, artifactId, requestId, reason }),
    });
  }
  if (type === 'export.result') {
    const dataUrl = ownDataValue(data, 'dataUrl');
    const exportWidth = ownDataValue(data, 'width');
    const exportHeight = ownDataValue(data, 'height');
    const label = ownDataValue(data, 'label');
    if (
      typeof dataUrl !== 'string' ||
      dataUrl.length > ARTIFACT_EXPORT_MAX_DATA_URL ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(dataUrl) ||
      !Number.isInteger(exportWidth) ||
      !Number.isInteger(exportHeight) ||
      exportWidth < 1 ||
      exportHeight < 1 ||
      exportWidth > ARTIFACT_EXPORT_MAX_EDGE ||
      exportHeight > ARTIFACT_EXPORT_MAX_EDGE ||
      typeof label !== 'string' ||
      label.length < 1 ||
      label.length > 128
    ) {
      return bridgeFailure('export');
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        type,
        artifactId,
        requestId,
        dataUrl,
        width: exportWidth,
        height: exportHeight,
        label,
      }),
    });
  }
  if (type === 'anchor.miss') {
    return Object.freeze({ ok: true, value: Object.freeze({ type, artifactId, requestId }) });
  }

  const anchor = ownDataValue(data, 'anchor');
  const anchorKeys = new Set(['planrId', 'rect', 'viewport']);
  if (isPlainRecord(anchor) && Object.hasOwn(anchor, 'screen')) anchorKeys.add('screen');
  if (!exactKeys(anchor, anchorKeys)) return bridgeFailure('anchor');
  const planrId = ownDataValue(anchor, 'planrId');
  const screen = ownDataValue(anchor, 'screen');
  if (
    typeof planrId !== 'string' ||
    !ID_RE.test(planrId) ||
    (screen !== undefined &&
      (typeof screen !== 'string' ||
        screen.length < 1 ||
        screen.length > 128 ||
        [...screen].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )))
  ) {
    return bridgeFailure('anchor');
  }
  const rect = ownDataValue(anchor, 'rect');
  const reportedViewport = ownDataValue(anchor, 'viewport');
  if (
    !exactKeys(rect, new Set(['x', 'y', 'width', 'height'])) ||
    !exactKeys(reportedViewport, new Set(['width', 'height']))
  )
    return bridgeFailure('geometry');
  const width = viewport?.width;
  const height = viewport?.height;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    ownDataValue(reportedViewport, 'width') !== width ||
    ownDataValue(reportedViewport, 'height') !== height
  )
    return bridgeFailure('viewport');
  const geometry = Object.fromEntries(
    ['x', 'y', 'width', 'height'].map((key) => [key, ownDataValue(rect, key)]),
  );
  if (
    !Object.values(geometry).every(finite) ||
    geometry.x < 0 ||
    geometry.y < 0 ||
    geometry.width < 0 ||
    geometry.height < 0 ||
    geometry.x + geometry.width > width ||
    geometry.y + geometry.height > height
  ) {
    return bridgeFailure('geometry');
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      type,
      artifactId,
      requestId,
      anchor: Object.freeze({
        planrId,
        ...(screen === undefined ? {} : { screen }),
        rect: Object.freeze(geometry),
        viewport: Object.freeze({ width, height }),
      }),
    }),
  });
}
