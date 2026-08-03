import { createHash } from 'node:crypto';
import { lookup as lookupDns } from 'node:dns/promises';
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';

import { build, transform } from 'esbuild';
import { parse, parseFragment, serialize } from 'parse5';

import { isPathContained } from '../design/path-util.mjs';
import { ARTIFACT_ERROR_CODES, PipelineError } from '../pipeline/errors.mjs';
import { digestArtifact, normalizeUtf8Text } from './envelope.mjs';

const DEFAULT_MAX_FILES = 1_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_GENERATED_OUTPUT_BYTES = 10 * 1024 * 1024;
const REMOTE_FETCH_TIMEOUT_MS = 15_000;
const MAX_REMOTE_REDIRECTS = 5;
const REMOTE_RE = /^(?:https?:|file:|ftp:|wss?:|\/\/)/i;
const URI_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_ABSOLUTE_RE = /^[A-Za-z]:[\\/]/;
const SAFE_XML_URLS = [
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/XML/1998/namespace',
];
const MODULE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.css'];
const SVG_SMIL_ELEMENTS = new Set([
  'animate',
  'animatecolor',
  'animatemotion',
  'animatetransform',
  'discard',
  'set',
]);
const JAVASCRIPT_SCRIPT_TYPES = new Set([
  '',
  'application/ecmascript',
  'application/javascript',
  'text/ecmascript',
  'text/javascript',
]);
const INERT_SCRIPT_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'text/html',
  'text/x-template',
]);

const MIME_TYPES = Object.freeze({
  '.avif': 'image/avif',
  '.eot': 'application/vnd.ms-fontobject',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

const ESBUILD_LOADERS = Object.freeze({
  '.avif': 'file', '.eot': 'file', '.gif': 'file', '.ico': 'file',
  '.jpeg': 'file', '.jpg': 'file', '.mp3': 'file', '.mp4': 'file',
  '.otf': 'file', '.png': 'file', '.svg': 'file', '.ttf': 'file',
  '.wav': 'file', '.webm': 'file', '.webp': 'file', '.woff': 'file',
  '.woff2': 'file', '.css': 'css', '.cjs': 'js', '.js': 'js', '.jsx': 'jsx',
  '.json': 'json', '.mjs': 'js', '.ts': 'ts', '.tsx': 'tsx',
});

const REMOTE_CONTENT_TYPES = Object.freeze({
  'application/ecmascript': 'js',
  'application/javascript': 'js',
  'application/json': 'json',
  'application/ld+json': 'json',
  'application/x-javascript': 'js',
  'application/xhtml+xml': 'file',
  'font/otf': 'file',
  'font/ttf': 'file',
  'font/woff': 'file',
  'font/woff2': 'file',
  'image/avif': 'file',
  'image/gif': 'file',
  'image/jpeg': 'file',
  'image/png': 'file',
  'image/svg+xml': 'file',
  'image/webp': 'file',
  'text/css': 'css',
  'text/ecmascript': 'js',
  'text/javascript': 'js',
});

function artifactError(code, message, fix = '', details = undefined) {
  return new PipelineError(code, message, fix, details);
}

function constrainedLimit(value, hardMaximum, label) {
  if (value === undefined) return hardMaximum;
  if (!Number.isInteger(value) || value < 1 || value > hardMaximum) {
    throw artifactError(
      ARTIFACT_ERROR_CODES.INPUT_INVALID,
      `${label} must be a positive integer no greater than ${hardMaximum}.`,
    );
  }
  return value;
}

class GeneratedOutputBudget {
  constructor(initialBytes, label) {
    this.bytes = initialBytes;
    this.label = label;
    this.assertWithinLimit('source');
  }

  accountGeneratedReplacement(previous, next, label) {
    this.accountGeneratedReplacementBytes(previous, Buffer.byteLength(next, 'utf8'), label);
  }

  accountGeneratedReplacementBytes(previous, nextBytes, label, count = 1) {
    const previousBytes = Buffer.byteLength(previous ?? '', 'utf8');
    this.bytes = Math.max(0, this.bytes + ((nextBytes - previousBytes) * count));
    this.assertWithinLimit(label);
  }

  accountGeneratedAdditionBytes(bytes, label) {
    this.bytes += bytes;
    this.assertWithinLimit(label);
  }

  assertWithinLimit(label) {
    if (this.bytes > MAX_GENERATED_OUTPUT_BYTES) {
      throw artifactError(
        ARTIFACT_ERROR_CODES.OUTPUT_LIMIT,
        `Generated ${this.label} exceeds ${MAX_GENERATED_OUTPUT_BYTES} bytes while rewriting ${label}.`,
      );
    }
  }
}

function countOccurrences(value, needle) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = value.indexOf(needle, offset)) >= 0) {
    count++;
    offset += needle.length;
  }
  return count;
}

function escapedUtf8Bytes(value, { attribute = false, raw = false } = {}) {
  let bytes = Buffer.byteLength(value, 'utf8');
  if (raw) return bytes;
  for (let index = value.indexOf('&'); index >= 0; index = value.indexOf('&', index + 1)) bytes += 4;
  for (let index = value.indexOf('<'); index >= 0; index = value.indexOf('<', index + 1)) bytes += 3;
  if (attribute) {
    for (let index = value.indexOf('"'); index >= 0; index = value.indexOf('"', index + 1)) bytes += 5;
  }
  return bytes;
}

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const HTML_VOID_ELEMENTS = new Set([
  'area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'hr', 'img',
  'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const HTML_RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);

function assertBoundedSerialization(root, label) {
  let bytes = 0;
  const add = (amount) => {
    bytes += amount;
    if (bytes > MAX_GENERATED_OUTPUT_BYTES) {
      throw artifactError(
        ARTIFACT_ERROR_CODES.OUTPUT_LIMIT,
        `Generated ${label} exceeds ${MAX_GENERATED_OUTPUT_BYTES} bytes before serialization.`,
      );
    }
  };
  const stack = [...descendants(root)].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.nodeName === '#text') {
      const parentTag = node.parentNode?.tagName?.toLowerCase();
      add(escapedUtf8Bytes(node.value ?? '', {
        raw: node.parentNode?.namespaceURI === HTML_NAMESPACE && HTML_RAW_TEXT_ELEMENTS.has(parentTag),
      }));
      continue;
    }
    if (node.nodeName === '#comment') {
      add(7 + Buffer.byteLength(node.data ?? '', 'utf8'));
      continue;
    }
    if (node.nodeName === '#documentType') {
      add(16 + Buffer.byteLength(node.name ?? 'html', 'utf8')
        + (2 * Buffer.byteLength(node.publicId ?? '', 'utf8'))
        + (2 * Buffer.byteLength(node.systemId ?? '', 'utf8')));
      continue;
    }
    if (!node.tagName) {
      stack.push(...descendants(node).reverse());
      continue;
    }
    const tag = node.tagName.toLowerCase();
    add(2 + Buffer.byteLength(tag, 'utf8'));
    for (const attr of node.attrs ?? []) {
      const attrName = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name;
      add(4 + Buffer.byteLength(attrName, 'utf8') + escapedUtf8Bytes(attr.value, { attribute: true }));
    }
    const isVoid = node.namespaceURI === HTML_NAMESPACE && HTML_VOID_ELEMENTS.has(tag);
    if (!isVoid) {
      add(3 + Buffer.byteLength(tag, 'utf8'));
      const children = node.content?.childNodes ?? node.childNodes ?? [];
      stack.push(...children.slice().reverse());
    }
  }
  return bytes;
}

function encodedDataUrlBytes(mediaType, buffer, fragment = '') {
  return Buffer.byteLength(`data:${mediaType};base64,${fragment}`, 'utf8')
    + (4 * Math.ceil(buffer.byteLength / 3));
}

function encodeDataUrl(mediaType, buffer, fragment = '') {
  return `data:${mediaType};base64,${buffer.toString('base64')}${fragment}`;
}

function cleanReference(value) {
  if (typeof value !== 'string') return '';
  let decoded;
  try {
    decoded = decodeURIComponent(value.trim());
  } catch {
    throw artifactError(ARTIFACT_ERROR_CODES.INPUT_INVALID, `Invalid percent-encoding in asset reference: ${value}`);
  }
  return decoded.split('#', 1)[0].split('?', 1)[0];
}

function classifyReference(value) {
  const cleaned = cleanReference(value);
  if (!cleaned || value.trim().startsWith('#')) return { kind: 'internal', value: cleaned };
  if (/^data:/i.test(cleaned)) return { kind: 'data', value: cleaned };
  if (/^blob:/i.test(cleaned)) return { kind: 'external', value: cleaned };
  if (REMOTE_RE.test(cleaned) || (URI_SCHEME_RE.test(cleaned) && !WINDOWS_ABSOLUTE_RE.test(cleaned))) {
    return { kind: 'external', value: cleaned };
  }
  if (isAbsolute(cleaned) || WINDOWS_ABSOLUTE_RE.test(cleaned)) return { kind: 'absolute', value: cleaned };
  return { kind: 'local', value: cleaned };
}

function remoteUrlFor(reference, baseUrl = undefined) {
  let url;
  try {
    url = baseUrl === undefined ? new URL(reference) : new URL(reference, baseUrl);
  } catch {
    throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `Remote asset URL is invalid: ${reference}`);
  }
  if (url.protocol !== 'https:') {
    throw artifactError(
      ARTIFACT_ERROR_CODES.EXTERNAL_ASSET,
      `Only HTTPS remote assets can be packaged: ${reference}`,
      'Download the asset locally or use an HTTPS URL.',
    );
  }
  if (url.username || url.password || (url.port && url.port !== '443')) {
    throw artifactError(
      ARTIFACT_ERROR_CODES.EXTERNAL_ASSET,
      `Remote asset URL is not safe to package: ${reference}`,
    );
  }
  url.hash = '';
  return url;
}

function isPublicIpv4(address) {
  const values = address.split('.').map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [first, second] = values;
  if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
  if (first === 100 && second >= 64 && second <= 127) return false;
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && (second === 0 || second === 168)) return false;
  if (first === 198 && (second === 18 || second === 19 || second === 51)) return false;
  if (first === 203 && second === 0) return false;
  return true;
}

function isPublicIpAddress(address) {
  const type = isIP(address);
  if (type === 4) return isPublicIpv4(address);
  if (type !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('::ffff:')) return false;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8')
    || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
    || normalized.startsWith('ff')) return false;
  return true;
}

function remoteContentType(response, url) {
  const header = response.headers?.get?.('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (header && REMOTE_CONTENT_TYPES[header]) return { mediaType: header, loader: REMOTE_CONTENT_TYPES[header] };
  const extension = extname(url.pathname).toLowerCase();
  const mediaType = MIME_TYPES[extension];
  const loader = ESBUILD_LOADERS[extension];
  if (mediaType && loader) return { mediaType, loader };
  throw artifactError(
    ARTIFACT_ERROR_CODES.EXTERNAL_ASSET,
    `Remote asset has an unsupported content type: ${url.toString()}`,
    'Download the dependency locally or use a CSS, JavaScript, image, font, audio, or video asset.',
  );
}

function isBaseUrlAttribute(attr) {
  const name = attr?.name?.toLowerCase() ?? '';
  return name === 'base' || name.endsWith(':base') || attr?.prefix?.toLowerCase() === 'xml' && name === 'base';
}

function decodeSvgDataUri(reference, label) {
  const withoutFragment = reference.split('#', 1)[0];
  const match = withoutFragment.match(/^data:image\/svg\+xml((?:;[^,]*)?),(.*)$/is);
  if (!match) return null;
  try {
    const bytes = /(?:^|;)base64(?:;|$)/i.test(match[1])
      ? Buffer.from(match[2], 'base64')
      : Buffer.from(decodeURIComponent(match[2]), 'utf8');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw artifactError(ARTIFACT_ERROR_CODES.INPUT_INVALID, `Invalid embedded SVG data URI in ${label}.`);
  }
}

function assertSafeSvgMarkup(markup, label, depth = 0) {
  if (depth > 16) {
    throw artifactError(ARTIFACT_ERROR_CODES.UNSAFE_HTML, `Embedded SVG nesting is too deep in ${label}.`);
  }
  let inspected = markup;
  for (const allowed of SAFE_XML_URLS) inspected = inspected.split(allowed).join('');
  if (/https?:\/\/|(?:^|[^A-Za-z0-9._-])\/(?:Users|home|private|Volumes)\//i.test(inspected)) {
    throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `Private or remote content exists in embedded SVG ${label}.`);
  }
  const fragment = parseFragment(markup);
  const queue = descendants(fragment);
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node?.tagName) {
      queue.push(...descendants(node));
      continue;
    }
    const tag = node.tagName.toLowerCase();
    if (SVG_SMIL_ELEMENTS.has(tag)
      || ['a', 'base', 'embed', 'foreignobject', 'form', 'frame', 'frameset', 'iframe', 'noembed', 'noframes', 'noscript', 'object', 'script'].includes(tag)) {
      throw artifactError(ARTIFACT_ERROR_CODES.UNSAFE_HTML, `Unsafe <${tag}> in embedded SVG ${label}.`);
    }
    for (const attr of node.attrs ?? []) {
      const name = attr.name.toLowerCase();
      if (isBaseUrlAttribute(attr)) {
        throw artifactError(ARTIFACT_ERROR_CODES.UNSAFE_HTML, `SVG base-URL attributes are not supported in ${label}.`);
      }
      if (name.startsWith('on') || name === 'srcdoc' || ['action', 'formaction', 'ping', 'target'].includes(name)) {
        throw artifactError(ARTIFACT_ERROR_CODES.UNSAFE_HTML, `Unsafe ${name} in embedded SVG ${label}.`);
      }
      if (['href', 'src'].includes(name) && attr.value) {
        const reference = classifyReference(attr.value);
        if (!['internal', 'data'].includes(reference.kind)) {
          throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `Unpackaged URI in embedded SVG ${label}.`);
        }
        const nested = decodeSvgDataUri(attr.value, label);
        if (nested !== null) assertSafeSvgMarkup(nested, label, depth + 1);
      }
      for (const match of attr.value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
        const reference = classifyReference(match[2]);
        if (!['internal', 'data'].includes(reference.kind)) {
          throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `Unpackaged CSS URI in embedded SVG ${label}.`);
        }
        const nested = decodeSvgDataUri(match[2], label);
        if (nested !== null) assertSafeSvgMarkup(nested, label, depth + 1);
      }
    }
    if (tag === 'style') {
      for (const match of textContent(node).matchAll(/(?:url\(\s*(['"]?)(.*?)\1\s*\)|@import\s+(?:url\()?\s*(['"])(.*?)\3)/gi)) {
        const value = match[2] ?? match[4];
        const reference = classifyReference(value);
        if (!['internal', 'data'].includes(reference.kind)) {
          throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `Unpackaged stylesheet URI in embedded SVG ${label}.`);
        }
        const nested = decodeSvgDataUri(value, label);
        if (nested !== null) assertSafeSvgMarkup(nested, label, depth + 1);
      }
    }
    queue.push(...descendants(node));
  }
}

function assertSafeEmbeddedSvgDataUris(text, label) {
  const matches = text.match(/data:image\/svg\+xml(?:;[^,\s"')]+)*,[^\s"')]+/gi) ?? [];
  for (const reference of matches) {
    const markup = decodeSvgDataUri(reference, label);
    if (markup !== null) assertSafeSvgMarkup(markup, label);
  }
}

class BundleContext {
  constructor({ root, maxFiles, maxBytes, sensitiveValues, remoteAssets, fetchImpl, lookupImpl }) {
    if (!existsSync(root)) throw artifactError(ARTIFACT_ERROR_CODES.ROOT_MISSING, `Artifact root does not exist: ${root}`);
    if (sensitiveValues !== undefined && !Array.isArray(sensitiveValues)) {
      throw artifactError(ARTIFACT_ERROR_CODES.INPUT_INVALID, 'sensitiveValues must be an array of strings.');
    }
    this.root = realpathSync(root);
    if (!statSync(this.root).isDirectory()) {
      throw artifactError(ARTIFACT_ERROR_CODES.ROOT_MISSING, `Artifact root is not a directory: ${root}`);
    }
    this.maxFiles = maxFiles;
    this.maxBytes = maxBytes;
    if (!['bundle', 'reject'].includes(remoteAssets)) {
      throw artifactError(ARTIFACT_ERROR_CODES.INPUT_INVALID, 'remoteAssets must be bundle or reject.');
    }
    if (typeof fetchImpl !== 'function' || typeof lookupImpl !== 'function') {
      throw artifactError(ARTIFACT_ERROR_CODES.INPUT_INVALID, 'Remote asset fetch and DNS lookup implementations must be functions.');
    }
    this.remoteAssets = remoteAssets;
    this.fetchImpl = fetchImpl;
    this.lookupImpl = lookupImpl;
    this.sensitiveValues = [...new Set((sensitiveValues ?? []).filter((value) => typeof value === 'string' && value.length >= 4))];
    this.buffers = new Map();
    this.pendingReads = new Map();
    this.remoteBuffers = new Map();
    this.remoteAliases = new Map();
    this.pendingRemoteReads = new Map();
    this.totalBytes = 0;
    this.generatedOutputBytes = 0;
    this.assets = new Map();
    this.svgCache = new Map();
    this.svgInProgress = new Set();
  }

  beginGeneratedOutput(source) {
    this.generatedOutputBytes = Buffer.byteLength(source, 'utf8');
    this.assertGeneratedOutputLimit('artifact source');
  }

  accountGeneratedReplacement(previous, next, label) {
    this.accountGeneratedReplacementBytes(previous, Buffer.byteLength(next, 'utf8'), label);
  }

  accountGeneratedReplacementBytes(previous, nextBytes, label, count = 1) {
    const previousBytes = Buffer.byteLength(previous ?? '', 'utf8');
    this.generatedOutputBytes = Math.max(
      0,
      this.generatedOutputBytes + ((nextBytes - previousBytes) * count),
    );
    this.assertGeneratedOutputLimit(label);
  }

  accountGeneratedAddition(value, label) {
    this.generatedOutputBytes += Buffer.byteLength(value, 'utf8');
    this.assertGeneratedOutputLimit(label);
  }

  assertGeneratedFragment(value, label) {
    if (Buffer.byteLength(value, 'utf8') > MAX_GENERATED_OUTPUT_BYTES) {
      throw artifactError(
        ARTIFACT_ERROR_CODES.OUTPUT_LIMIT,
        `Generated ${label} exceeds ${MAX_GENERATED_OUTPUT_BYTES} bytes.`,
      );
    }
  }

  assertGeneratedOutputLimit(label) {
    if (this.generatedOutputBytes > MAX_GENERATED_OUTPUT_BYTES) {
      throw artifactError(
        ARTIFACT_ERROR_CODES.OUTPUT_LIMIT,
        `Generated artifact output exceeds ${MAX_GENERATED_OUTPUT_BYTES} bytes while rewriting ${label}.`,
      );
    }
  }

  assertFinalGeneratedOutput(value) {
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes > MAX_GENERATED_OUTPUT_BYTES) {
      throw artifactError(
        ARTIFACT_ERROR_CODES.OUTPUT_LIMIT,
        `Generated artifact output exceeds ${MAX_GENERATED_OUTPUT_BYTES} bytes.`,
      );
    }
    this.generatedOutputBytes = bytes;
  }

  logicalPath(path) {
    return relative(this.root, path).split('\\').join('/');
  }

  resolveLocal(reference, fromDir, purpose = 'asset') {
    const classified = classifyReference(reference);
    if (classified.kind === 'external') {
      throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `External ${purpose} is not allowed: ${reference}`);
    }
    if (classified.kind === 'absolute') {
      throw artifactError(ARTIFACT_ERROR_CODES.REDACTION, `Absolute ${purpose} path is not shareable: ${reference}`);
    }
    if (classified.kind !== 'local') return classified;
    const candidate = resolve(fromDir, classified.value);
    if (!isPathContained(this.root, candidate)) {
      throw artifactError(ARTIFACT_ERROR_CODES.PATH_TRAVERSAL, `Artifact ${purpose} escapes the configured root: ${reference}`);
    }
    if (!existsSync(candidate)) {
      throw artifactError(ARTIFACT_ERROR_CODES.UNRESOLVED_ASSET, `Artifact ${purpose} does not exist: ${reference}`);
    }
    const realPath = realpathSync(candidate);
    if (!isPathContained(this.root, realPath)) {
      throw artifactError(ARTIFACT_ERROR_CODES.SYMLINK_ESCAPE, `Artifact ${purpose} resolves through a symlink outside the root: ${reference}`);
    }
    if (!statSync(realPath).isFile()) {
      throw artifactError(ARTIFACT_ERROR_CODES.UNRESOLVED_ASSET, `Artifact ${purpose} is not a regular file: ${reference}`);
    }
    return { kind: 'local', value: classified.value, path: realPath };
  }

  async resolveRemote(reference, purpose = 'asset', baseUrl = undefined) {
    if (this.remoteAssets !== 'bundle') {
      throw artifactError(
        ARTIFACT_ERROR_CODES.EXTERNAL_ASSET,
        `External ${purpose} is not allowed: ${reference}`,
        'Remove the dependency, download it locally, or enable remote asset packaging.',
      );
    }
    const url = remoteUrlFor(reference, baseUrl);
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
      || hostname.endsWith('.internal') || hostname.endsWith('.home')) {
      throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `Remote asset host is not public: ${url.toString()}`);
    }
    if (isIP(hostname)) {
      if (!isPublicIpAddress(hostname)) {
        throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `Remote asset host is not public: ${url.toString()}`);
      }
      return url;
    }
    let addresses;
    try {
      addresses = await this.lookupImpl(hostname, { all: true, verbatim: true });
    } catch {
      throw artifactError(
        ARTIFACT_ERROR_CODES.EXTERNAL_ASSET,
        `Unable to resolve remote asset host: ${hostname}`,
        'Check your network connection or download the dependency locally.',
      );
    }
    const values = Array.isArray(addresses) ? addresses : [addresses];
    if (values.length === 0 || values.some((entry) => !isPublicIpAddress(entry?.address ?? ''))) {
      throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `Remote asset host is not public: ${url.toString()}`);
    }
    return url;
  }

  async readRemote(reference, purpose = 'asset', baseUrl = undefined) {
    const initial = await this.resolveRemote(reference, purpose, baseUrl);
    const initialKey = initial.toString();
    const alias = this.remoteAliases.get(initialKey);
    if (alias && this.remoteBuffers.has(alias)) return this.remoteBuffers.get(alias);
    if (this.remoteBuffers.has(initialKey)) return this.remoteBuffers.get(initialKey);
    if (this.pendingRemoteReads.has(initialKey)) return this.pendingRemoteReads.get(initialKey);
    if (this.buffers.size + this.pendingReads.size + this.remoteBuffers.size + this.pendingRemoteReads.size + 1 > this.maxFiles) {
      throw artifactError(ARTIFACT_ERROR_CODES.FILE_LIMIT, `Artifact graph exceeds ${this.maxFiles} files.`);
    }
    const pending = this.readRemoteUncached(initial, purpose);
    this.pendingRemoteReads.set(initialKey, pending);
    try {
      return await pending;
    } finally {
      this.pendingRemoteReads.delete(initialKey);
    }
  }

  async readRemoteUncached(initial, purpose) {
    let url = initial;
    for (let redirect = 0; redirect <= MAX_REMOTE_REDIRECTS; redirect++) {
      await this.resolveRemote(url.toString(), purpose);
      let response;
      try {
        response = await this.fetchImpl(url, {
          redirect: 'manual',
          signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS) : undefined,
          headers: { accept: 'text/css, text/javascript, application/javascript, image/*, font/*, audio/*, video/*;q=0.8, */*;q=0.1' },
        });
      } catch {
        throw artifactError(
          ARTIFACT_ERROR_CODES.EXTERNAL_ASSET,
          `Unable to fetch remote ${purpose}: ${url.toString()}`,
          'Check the URL and network connection, or download the dependency locally.',
        );
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get?.('location');
        if (!location || redirect === MAX_REMOTE_REDIRECTS) {
          throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `Remote ${purpose} has an unsafe redirect: ${url.toString()}`);
        }
        url = await this.resolveRemote(location, purpose, url);
        continue;
      }
      if (!response.ok) {
        throw artifactError(
          ARTIFACT_ERROR_CODES.EXTERNAL_ASSET,
          `Remote ${purpose} returned HTTP ${response.status}: ${url.toString()}`,
          'Check the URL or download the dependency locally.',
        );
      }
      const contentLength = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(contentLength) && contentLength > this.maxBytes - this.totalBytes) {
        throw artifactError(ARTIFACT_ERROR_CODES.BYTE_LIMIT, `Artifact graph exceeds ${this.maxBytes} decoded bytes.`);
      }
      const chunks = [];
      let bytes = 0;
      try {
        for await (const chunk of response.body ?? []) {
          const buffer = Buffer.from(chunk);
          bytes += buffer.byteLength;
          this.totalBytes += buffer.byteLength;
          if (this.totalBytes > this.maxBytes) {
            throw artifactError(ARTIFACT_ERROR_CODES.BYTE_LIMIT, `Artifact graph exceeds ${this.maxBytes} decoded bytes.`);
          }
          chunks.push(buffer);
        }
      } catch (error) {
        if (error instanceof PipelineError) throw error;
        throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `Unable to read remote ${purpose}: ${url.toString()}`);
      }
      const buffer = Buffer.concat(chunks, bytes);
      const type = remoteContentType(response, url);
      const record = { url: url.toString(), buffer, ...type };
      this.remoteBuffers.set(record.url, record);
      this.remoteAliases.set(initial.toString(), record.url);
      this.registerAsset(buffer, url.pathname, type.mediaType);
      return record;
    }
    throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `Remote ${purpose} redirect limit exceeded: ${initial.toString()}`);
  }

  resolveImport(reference, fromDir) {
    const classified = classifyReference(reference);
    if (classified.kind === 'external' || classified.kind === 'absolute') {
      throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `External import is not allowed: ${reference}`);
    }
    if (classified.kind !== 'local') return classified;
    const base = resolve(fromDir, classified.value);
    if (!isPathContained(this.root, base)) {
      throw artifactError(ARTIFACT_ERROR_CODES.PATH_TRAVERSAL, `Artifact import escapes the configured root: ${reference}`);
    }
    const candidates = [
      base,
      ...MODULE_EXTENSIONS.map((extension) => `${base}${extension}`),
      ...MODULE_EXTENSIONS.map((extension) => resolve(base, `index${extension}`)),
    ];
    const candidate = candidates.find((value) => existsSync(value) && statSync(value).isFile());
    if (!candidate) {
      throw artifactError(ARTIFACT_ERROR_CODES.UNRESOLVED_ASSET, `Artifact import does not exist: ${reference}`);
    }
    const realPath = realpathSync(candidate);
    if (!isPathContained(this.root, realPath)) {
      throw artifactError(ARTIFACT_ERROR_CODES.SYMLINK_ESCAPE, `Artifact import resolves through a symlink outside the root: ${reference}`);
    }
    return { kind: 'local', value: classified.value, path: realPath };
  }

  async read(path) {
    if (this.buffers.has(path)) return this.buffers.get(path);
    if (this.pendingReads.has(path)) return this.pendingReads.get(path);
    if (this.buffers.size + this.pendingReads.size + 1 > this.maxFiles) {
      throw artifactError(ARTIFACT_ERROR_CODES.FILE_LIMIT, `Artifact graph exceeds ${this.maxFiles} files.`);
    }
    const pending = this.readUncached(path);
    this.pendingReads.set(path, pending);
    try {
      return await pending;
    } finally {
      this.pendingReads.delete(path);
    }
  }

  async readUncached(path) {
    const chunks = [];
    for await (const chunk of createReadStream(path)) {
      this.totalBytes += chunk.byteLength;
      if (this.totalBytes > this.maxBytes) {
        throw artifactError(ARTIFACT_ERROR_CODES.BYTE_LIMIT, `Artifact graph exceeds ${this.maxBytes} decoded bytes.`);
      }
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    this.buffers.set(path, buffer);
    this.registerAsset(buffer, path);
    return buffer;
  }

  async readText(path, { allowRemoteUrls = false } = {}) {
    const buffer = await this.read(path);
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw artifactError(ARTIFACT_ERROR_CODES.INPUT_INVALID, `Artifact text file is not valid UTF-8: ${this.logicalPath(path)}`);
    }
    this.assertPrivacySafe(text, this.logicalPath(path), { allowRemoteUrls });
    return normalizeUtf8Text(text);
  }

  registerAsset(buffer, path, mediaType = MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream') {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    if (!this.assets.has(sha256)) {
      this.assets.set(sha256, {
        sha256,
        bytes: buffer.byteLength,
        mediaType,
      });
    }
    return sha256;
  }

  assertPrivacySafe(text, label, { allowRemoteUrls = false } = {}) {
    let inspected = text;
    for (const allowed of SAFE_XML_URLS) inspected = inspected.split(allowed).join('');
    const forbidden = [
      { pattern: /(?:^|[^A-Za-z0-9._-])\/(?:Users|home|private|Volumes)\/[A-Za-z0-9._-]+\//, reason: 'absolute machine path' },
      { pattern: /[A-Za-z]:\\(?:Users|Documents and Settings)\\/i, reason: 'absolute Windows path' },
      { pattern: /(?:git@|ssh:\/\/|git(?:\+ssh)?:\/\/)[^\s"']+|https?:\/\/[^\s"']+\.git(?:\b|$)/i, reason: 'repository remote' },
      ...(allowRemoteUrls ? [] : [{ pattern: /(?:https?|ftp|file|wss?):\/\/[^\s"')<>]+/i, reason: 'remote URL', code: ARTIFACT_ERROR_CODES.EXTERNAL_ASSET }]),
      { pattern: /planr-asset:\//i, reason: 'reserved bundler placeholder', code: ARTIFACT_ERROR_CODES.EXTERNAL_ASSET },
      { pattern: /(?:process\.env|import\.meta\.env|__dirname|__filename)\b/, reason: 'machine/environment metadata reference' },
      { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, reason: 'private key material' },
      { pattern: /\bAKIA[0-9A-Z]{16}\b/, reason: 'access key material' },
    ];
    for (const { pattern, reason, code = ARTIFACT_ERROR_CODES.REDACTION } of forbidden) {
      if (pattern.test(inspected)) {
        throw artifactError(code, `Artifact ${label} contains ${reason}.`);
      }
    }
    for (const value of this.sensitiveValues) {
      if (inspected.includes(value)) {
        throw artifactError(ARTIFACT_ERROR_CODES.REDACTION, `Artifact ${label} contains a configured sensitive value.`);
      }
    }
    assertSafeEmbeddedSvgDataUris(inspected, label);
  }
}

function getAttr(node, name) {
  return node.attrs?.find((attr) => attr.name.toLowerCase() === name)?.value;
}

function setAttr(node, name, value) {
  const existing = node.attrs?.find((attr) => attr.name.toLowerCase() === name);
  if (existing) existing.value = value;
  else (node.attrs ??= []).push({ name, value });
}

function setGeneratedAttr(context, node, name, value, label) {
  const previous = getAttr(node, name) ?? '';
  context.accountGeneratedReplacement(previous, value, label);
  setAttr(node, name, value);
}

function removeAttr(node, name) {
  if (node.attrs) node.attrs = node.attrs.filter((attr) => attr.name.toLowerCase() !== name);
}

function textContent(node) {
  return (node.childNodes ?? []).map((child) => child.nodeName === '#text' ? child.value : textContent(child)).join('');
}

function setTextContent(node, value) {
  const child = { nodeName: '#text', value, parentNode: node };
  node.childNodes = [child];
}

function setGeneratedText(context, node, value, label) {
  const previous = textContent(node);
  context.accountGeneratedReplacement(previous, value, label);
  setTextContent(node, value);
}

function descendants(node) {
  return [
    ...(node?.childNodes ?? []),
    ...(node?.content?.childNodes ?? []),
  ];
}

function replaceNode(node, replacement) {
  const parent = node.parentNode;
  const index = parent?.childNodes?.indexOf(node) ?? -1;
  if (index < 0) throw artifactError(ARTIFACT_ERROR_CODES.INPUT_INVALID, 'Unable to rewrite artifact HTML node.');
  replacement.parentNode = parent;
  parent.childNodes[index] = replacement;
}

function createElement(tagName) {
  return parseFragment(`<${tagName}></${tagName}>`).childNodes[0];
}

function esbuildLoader(path) {
  const loader = ESBUILD_LOADERS[extname(path).toLowerCase()];
  if (!loader) {
    throw artifactError(ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE, `Unsupported bundled dependency type: ${extname(path) || '(none)'}`);
  }
  return loader;
}

function unwrapBuildError(error) {
  const detail = error?.errors?.find(({ detail }) => detail instanceof PipelineError)?.detail;
  if (detail) throw detail;
  if (error instanceof PipelineError) throw error;
  throw artifactError(ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE, `Unable to bundle local dependency graph: ${error.message}`);
}

function artifactDependencyPlugin(context) {
  return {
    name: 'openplanr-artifact-dependencies',
    setup(api) {
      api.onResolve({ filter: /.*/ }, async (args) => {
        try {
          if (args.kind === 'entry-point' && isAbsolute(args.path)) {
            const realPath = realpathSync(args.path);
            if (!isPathContained(context.root, realPath)) {
              throw artifactError(ARTIFACT_ERROR_CODES.PATH_TRAVERSAL, 'Bundler entry point escapes the artifact root.');
            }
            return { path: realPath };
          }
          if (args.path.startsWith('#')) return { path: args.path, external: true };
          if (args.namespace === 'openplanr-remote') {
            const remote = await context.resolveRemote(args.path, 'import', args.importer);
            return { path: remote.toString(), namespace: 'openplanr-remote' };
          }
          const classified = classifyReference(args.path);
          if (classified.kind === 'data') {
            if (args.kind === 'url-token') return { path: args.path, external: true };
            throw artifactError(
              ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE,
              `Data URI ${args.kind} is not supported: ${args.path.slice(0, 64)}`,
            );
          }
          if (classified.kind === 'external') {
            const remote = await context.resolveRemote(args.path, 'import');
            return { path: remote.toString(), namespace: 'openplanr-remote' };
          }
          if (classified.kind === 'absolute') {
            throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `External import is not allowed: ${args.path}`);
          }
          if (!args.path.startsWith('.') && !args.path.startsWith('/')) {
            throw artifactError(ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE, `Bare module import is not supported: ${args.path}`);
          }
          const resolved = context.resolveImport(args.path, args.resolveDir);
          return { path: resolved.path };
        } catch (error) {
          return { errors: [{ text: error.message, detail: error }] };
        }
      });
      api.onLoad({ filter: /.*/, namespace: 'openplanr-remote' }, async (args) => {
        try {
          const remote = await context.readRemote(args.path, 'import');
          let contents = remote.buffer;
          if (remote.mediaType === 'image/svg+xml') {
            let markup;
            try {
              markup = new TextDecoder('utf-8', { fatal: true }).decode(contents);
            } catch {
              throw artifactError(ARTIFACT_ERROR_CODES.INPUT_INVALID, `Remote SVG is not valid UTF-8: ${remote.url}`);
            }
            assertSafeSvgMarkup(markup, remote.url);
          }
          if (['js', 'css', 'json'].includes(remote.loader)) {
            const text = contents.toString('utf8');
            context.assertPrivacySafe(text, remote.url, { allowRemoteUrls: true });
            if (remote.loader === 'js' && /new\s+URL\s*\([\s\S]*?import\.meta\.url/.test(text)) {
              throw artifactError(
                ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE,
                `new URL(..., import.meta.url) assets are not supported: ${remote.url}`,
              );
            }
          }
          return { contents, loader: remote.loader };
        } catch (error) {
          return { errors: [{ text: error.message, detail: error }] };
        }
      });
      api.onLoad({ filter: /.*/ }, async (args) => {
        try {
          let contents = await context.read(args.path);
          if (extname(args.path).toLowerCase() === '.svg') {
            contents = await bundleSvg(context, args.path, contents);
          }
          if (['js', 'jsx', 'ts', 'tsx', 'css', 'json'].includes(esbuildLoader(args.path))) {
            context.assertPrivacySafe(contents.toString('utf8'), context.logicalPath(args.path), { allowRemoteUrls: true });
          }
          if (['js', 'jsx', 'ts', 'tsx'].includes(esbuildLoader(args.path))
            && /new\s+URL\s*\([\s\S]*?import\.meta\.url/.test(contents.toString('utf8'))) {
            throw artifactError(
              ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE,
              `new URL(..., import.meta.url) assets are not supported: ${context.logicalPath(args.path)}`,
            );
          }
          return { contents, loader: esbuildLoader(args.path), resolveDir: dirname(args.path) };
        } catch (error) {
          return { errors: [{ text: error.message, detail: error }] };
        }
      });
    },
  };
}

async function bundleWithEsbuild(context, { entryPath, source, resolveDir, loader, kind }) {
  try {
    if (source && /new\s+URL\s*\([\s\S]*?import\.meta\.url/.test(source)) {
      throw artifactError(
        ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE,
        'new URL(..., import.meta.url) assets are not supported in inline modules.',
      );
    }
    const outputDir = resolve(context.root, '.planr-artifact-esbuild');
    const publicPath = 'planr-asset:/';
    const result = await build({
      ...(entryPath ? { entryPoints: [entryPath] } : { stdin: { contents: source, resolveDir, loader, sourcefile: `inline.${loader}` } }),
      bundle: true,
      write: false,
      platform: 'browser',
      format: kind === 'css' ? undefined : 'iife',
      target: ['es2022'],
      charset: 'utf8',
      legalComments: 'none',
      logLevel: 'silent',
      minify: true,
      sourcemap: false,
      outdir: outputDir,
      entryNames: 'artifact',
      assetNames: 'assets/[hash]',
      publicPath,
      metafile: true,
      plugins: [artifactDependencyPlugin(context)],
      absWorkingDir: context.root,
    });
    const outputFiles = result.outputFiles ?? [];
    const assetFiles = outputFiles
      .filter((file) => file.path.split('\\').join('/').includes('/assets/'))
      .sort((left, right) => left.path.localeCompare(right.path));
    const codeFiles = outputFiles.filter((file) => !assetFiles.includes(file));
    if (codeFiles.length !== 1) {
      throw artifactError(
        ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE,
        `Bundling produced ${codeFiles.length} executable/style outputs; exactly one is supported.`,
      );
    }
    if (codeFiles[0].contents.byteLength > MAX_GENERATED_OUTPUT_BYTES) {
      throw artifactError(
        ARTIFACT_ERROR_CODES.OUTPUT_LIMIT,
        `Generated bundled ${kind} exceeds ${MAX_GENERATED_OUTPUT_BYTES} bytes.`,
      );
    }
    const codeLogicalOutputPath = relative(outputDir, codeFiles[0].path).split('\\').join('/');
    const codeMetadata = Object.entries(result.metafile?.outputs ?? {})
      .find(([path]) => {
        const normalized = path.split('\\').join('/');
        return normalized === codeLogicalOutputPath || normalized.endsWith(`/${codeLogicalOutputPath}`);
      })?.[1];
    if (!codeMetadata) {
      throw artifactError(ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE, 'Esbuild output metadata is missing.');
    }
    let output = codeFiles[0].text;
    const outputBudget = new GeneratedOutputBudget(Buffer.byteLength(output, 'utf8'), `bundled ${kind}`);
    const replacements = [];
    for (const assetFile of assetFiles) {
      const logicalOutputPath = relative(outputDir, assetFile.path).split('\\').join('/');
      const placeholder = `${publicPath}${logicalOutputPath}`;
      const count = countOccurrences(output, placeholder);
      const expectedCount = (codeMetadata.imports ?? []).filter((entry) => {
        const normalized = entry.path.split('\\').join('/');
        return normalized === logicalOutputPath || normalized.endsWith(`/${logicalOutputPath}`);
      }).length;
      if (count === 0 || expectedCount === 0) {
        throw artifactError(
          ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE,
          `Bundled asset placeholder is missing: ${logicalOutputPath}`,
        );
      }
      if (count !== expectedCount) {
        throw artifactError(
          ARTIFACT_ERROR_CODES.EXTERNAL_ASSET,
          `Reserved asset placeholder collision detected: ${logicalOutputPath}`,
        );
      }
      const mediaType = MIME_TYPES[extname(assetFile.path).toLowerCase()];
      if (!mediaType) {
        throw artifactError(ARTIFACT_ERROR_CODES.UNRESOLVED_ASSET, `Unsupported bundled asset: ${logicalOutputPath}`);
      }
      const contents = assetFile.contents;
      const dataUrlBytes = encodedDataUrlBytes(mediaType, contents);
      outputBudget.accountGeneratedReplacementBytes(placeholder, dataUrlBytes, logicalOutputPath, count);
      replacements.push({
        placeholder,
        dataUrl: () => encodeDataUrl(
          mediaType,
          Buffer.from(contents.buffer, contents.byteOffset, contents.byteLength),
        ),
      });
    }
    for (const replacement of replacements) {
      output = output.split(replacement.placeholder).join(replacement.dataUrl());
    }
    if (kind !== 'css' && /\bimport\s*\(/.test(output)) {
      throw artifactError(ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE, 'Nonliteral or unresolved dynamic import is not supported.');
    }
    context.assertGeneratedFragment(output, `bundled ${kind}`);
    context.assertPrivacySafe(output, `bundled ${kind}`);
    return normalizeUtf8Text(output).trimEnd();
  } catch (error) {
    unwrapBuildError(error);
  }
}

async function transformClassicScript(context, source, label) {
  if (/\bimport\s*\(/.test(source) || /^\s*import\s/m.test(source)
    || /new\s+URL\s*\([\s\S]*?import\.meta\.url/.test(source)) {
    throw artifactError(ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE, `Classic script ${label} contains an unsupported import.`);
  }
  try {
    const result = await transform(source, { loader: 'js', target: 'es2022', charset: 'utf8', legalComments: 'none', sourcemap: false });
    context.assertGeneratedFragment(result.code, label);
    context.assertPrivacySafe(result.code, label);
    return normalizeUtf8Text(result.code).trimEnd();
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw artifactError(ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE, `Invalid classic script ${label}: ${error.message}`);
  }
}

async function rewriteStyleDeclaration(context, value, resolveDir, label = 'inline CSS') {
  const css = await bundleWithEsbuild(context, {
    source: `.planr-inline{${value}}`,
    resolveDir,
    loader: 'css',
    kind: 'css',
  });
  const match = css.match(/\.planr-inline\s*\{([\s\S]*)\}\s*$/);
  if (!match) throw artifactError(ARTIFACT_ERROR_CODES.INPUT_INVALID, `Unable to normalize ${label}.`);
  return match[1].trim();
}

async function bundleSvg(context, path, sourceBuffer) {
  if (context.svgCache.has(path)) return context.svgCache.get(path);
  if (context.svgInProgress.has(path)) {
    throw artifactError(
      ARTIFACT_ERROR_CODES.UNRESOLVED_ASSET,
      `Circular SVG dependency is not supported: ${context.logicalPath(path)}`,
    );
  }
  context.svgInProgress.add(path);
  try {
    let source;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(sourceBuffer);
    } catch {
      throw artifactError(
        ARTIFACT_ERROR_CODES.INPUT_INVALID,
        `SVG is not valid UTF-8: ${context.logicalPath(path)}`,
      );
    }
    source = normalizeUtf8Text(source);
    const svgBudget = new GeneratedOutputBudget(Buffer.byteLength(source, 'utf8'), 'packaged SVG');
    context.assertPrivacySafe(source, context.logicalPath(path));
    const fragment = parseFragment(source);
    const roots = (fragment.childNodes ?? []).filter((node) => node.tagName);
    if (roots.length !== 1 || roots[0].tagName?.toLowerCase() !== 'svg') {
      throw artifactError(ARTIFACT_ERROR_CODES.UNSAFE_HTML, 'Packaged SVG must contain one <svg> root.');
    }
    const queue = [...(fragment.childNodes ?? [])];
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node?.tagName) {
        queue.push(...(node?.childNodes ?? []));
        continue;
      }
      const tag = node.tagName.toLowerCase();
      if (SVG_SMIL_ELEMENTS.has(tag)
        || ['a', 'base', 'embed', 'foreignobject', 'form', 'iframe', 'noembed', 'noframes', 'noscript', 'object', 'script'].includes(tag)) {
        throw artifactError(ARTIFACT_ERROR_CODES.UNSAFE_HTML, `Unsafe <${tag}> is not supported in packaged SVG.`);
      }
      for (const attr of node.attrs ?? []) {
        const name = attr.name.toLowerCase();
        if (isBaseUrlAttribute(attr)) {
          throw artifactError(ARTIFACT_ERROR_CODES.UNSAFE_HTML, 'SVG base-URL attributes are not supported.');
        }
        if (name.startsWith('on') || ['action', 'formaction', 'ping', 'target'].includes(name)) {
          throw artifactError(ARTIFACT_ERROR_CODES.UNSAFE_HTML, `Unsafe SVG attribute is not supported: ${name}`);
        }
      }
      if (tag === 'style') {
        const css = await bundleWithEsbuild(context, {
          source: textContent(node),
          resolveDir: dirname(path),
          loader: 'css',
          kind: 'css',
        });
        setGeneratedText(svgBudget, node, css, 'SVG stylesheet');
      }
      for (const attr of node.attrs ?? []) {
        const name = attr.name.toLowerCase();
        if (['href', 'src'].includes(name) && attr.value) {
          attr.value = await dataUrlFor(
            context,
            attr.value,
            dirname(path),
            `SVG ${tag} ${name}`,
            svgBudget,
          );
        } else if ((name === 'style' || /url\s*\(/i.test(attr.value)) && /(?:url\s*\(|@import)/i.test(attr.value)) {
          if (name === 'style') {
            const rewritten = await rewriteStyleDeclaration(context, attr.value, dirname(path), 'SVG style');
            svgBudget.accountGeneratedReplacement(attr.value, rewritten, 'SVG style');
            attr.value = rewritten;
          } else {
            const declaration = await rewriteStyleDeclaration(
              context,
              `${name}:${attr.value}`,
              dirname(path),
              'SVG presentation attribute',
            );
            const separator = declaration.indexOf(':');
            const rewritten = separator >= 0 ? declaration.slice(separator + 1).trim() : declaration;
            svgBudget.accountGeneratedReplacement(attr.value, rewritten, 'SVG presentation attribute');
            attr.value = rewritten;
          }
        }
      }
      queue.push(...(node.childNodes ?? []));
    }
    assertBoundedSerialization(fragment, 'packaged SVG');
    const output = Buffer.from(normalizeUtf8Text(serialize(fragment)), 'utf8');
    context.assertGeneratedFragment(output.toString('utf8'), 'packaged SVG');
    context.assertPrivacySafe(output.toString('utf8'), `bundled ${context.logicalPath(path)}`);
    context.svgCache.set(path, output);
    return output;
  } finally {
    context.svgInProgress.delete(path);
  }
}

async function dataUrlFor(context, reference, fromDir, purpose, outputBudget = undefined) {
  const classification = classifyReference(reference);
  if (classification.kind === 'internal' || classification.kind === 'data') return reference;
  let buffer;
  let mediaType;
  if (classification.kind === 'external') {
    const remote = await context.readRemote(reference, purpose);
    buffer = remote.buffer;
    mediaType = remote.mediaType;
    if (mediaType === 'image/svg+xml') {
      let markup;
      try {
        markup = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        throw artifactError(ARTIFACT_ERROR_CODES.INPUT_INVALID, `Remote SVG is not valid UTF-8: ${remote.url}`);
      }
      assertSafeSvgMarkup(markup, remote.url);
    }
  } else {
    const classified = context.resolveLocal(reference, fromDir, purpose);
    if (classified.kind === 'internal' || classified.kind === 'data') return reference;
    buffer = await context.read(classified.path);
    mediaType = MIME_TYPES[extname(classified.path).toLowerCase()];
    if (mediaType === 'image/svg+xml') buffer = await bundleSvg(context, classified.path, buffer);
  }
  if (!mediaType) throw artifactError(ARTIFACT_ERROR_CODES.UNRESOLVED_ASSET, `Unsupported ${purpose} type: ${reference}`);
  const fragment = reference.includes('#') ? `#${reference.split('#').slice(1).join('#')}` : '';
  const outputBytes = encodedDataUrlBytes(mediaType, buffer, fragment);
  if (outputBudget) {
    outputBudget.accountGeneratedReplacementBytes(reference, outputBytes, purpose);
  } else if (outputBytes > MAX_GENERATED_OUTPUT_BYTES) {
    throw artifactError(ARTIFACT_ERROR_CODES.OUTPUT_LIMIT, `Generated ${purpose} exceeds ${MAX_GENERATED_OUTPUT_BYTES} bytes.`);
  }
  return encodeDataUrl(mediaType, buffer, fragment);
}

function parseSrcset(value) {
  const entries = [];
  let index = 0;
  while (index < value.length) {
    while (index < value.length && /[\s,]/.test(value[index])) index++;
    if (index >= value.length) break;
    const start = index;
    const isData = value.slice(index, index + 5).toLowerCase() === 'data:';
    while (index < value.length && !/\s/.test(value[index]) && (isData || value[index] !== ',')) index++;
    const url = value.slice(start, index);
    if (isData) {
      const separator = url.indexOf(',');
      if (separator < 0 || url.indexOf(',', separator + 1) >= 0) {
        throw artifactError(
          ARTIFACT_ERROR_CODES.INPUT_INVALID,
          'Ambiguous data URI in srcset; encode payload commas and separate candidates with descriptors.',
        );
      }
    }
    while (index < value.length && /\s/.test(value[index])) index++;
    const descriptorStart = index;
    while (index < value.length && value[index] !== ',') index++;
    const descriptor = value.slice(descriptorStart, index).trim();
    if (index < value.length && value[index] === ',') index++;
    if (!url) throw artifactError(ARTIFACT_ERROR_CODES.INPUT_INVALID, `Invalid srcset: ${value}`);
    entries.push({ url, descriptor });
  }
  return entries;
}

async function rewriteSrcset(context, value, fromDir) {
  const rewritten = [];
  for (const entry of parseSrcset(value)) {
    const url = await dataUrlFor(context, entry.url, fromDir, 'srcset asset', context);
    rewritten.push(`${url}${entry.descriptor ? ` ${entry.descriptor}` : ''}`);
  }
  return rewritten.join(', ');
}

async function rewriteHtml(context, entryPath, input) {
  context.beginGeneratedOutput(input);
  const document = parse(input, { sourceCodeLocationInfo: false });
  const queue = descendants(document);
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node?.tagName) {
      queue.push(...descendants(node));
      continue;
    }
    const tag = node.tagName.toLowerCase();
    const fromDir = dirname(entryPath);
    if ((node.namespaceURI === 'http://www.w3.org/2000/svg' && SVG_SMIL_ELEMENTS.has(tag))
      || ['applet', 'base', 'embed', 'fencedframe', 'form', 'frame', 'frameset', 'iframe', 'noembed', 'noframes', 'noscript', 'object', 'portal'].includes(tag)) {
      throw artifactError(ARTIFACT_ERROR_CODES.UNSAFE_HTML, `Unsafe <${tag}> is not supported in artifacts.`);
    }
    for (const attr of node.attrs ?? []) {
      const name = attr.name.toLowerCase();
      if (node.namespaceURI === 'http://www.w3.org/2000/svg' && isBaseUrlAttribute(attr)) {
        throw artifactError(ARTIFACT_ERROR_CODES.UNSAFE_HTML, 'SVG base-URL attributes are not supported.');
      }
      if (['action', 'archive', 'background', 'classid', 'codebase', 'formaction', 'longdesc', 'manifest', 'ping', 'profile', 'srcdoc', 'target'].includes(name)) {
        throw artifactError(ARTIFACT_ERROR_CODES.UNSAFE_HTML, `Navigation/form attribute ${name} is not supported.`);
      }
      if (name.startsWith('on')) context.assertPrivacySafe(attr.value, `inline ${name}`);
    }
    if (tag === 'meta' && getAttr(node, 'http-equiv')?.toLowerCase() === 'refresh') {
      throw artifactError(ARTIFACT_ERROR_CODES.UNSAFE_HTML, 'Meta refresh navigation is not supported.');
    }
    if (['a', 'area'].includes(tag)) {
      const href = getAttr(node, 'href');
      if (href && !href.trim().startsWith('#')) {
        throw artifactError(ARTIFACT_ERROR_CODES.UNSAFE_HTML, `Navigation target is not supported: ${href}`);
      }
    }
    if (tag === 'link') {
      const href = getAttr(node, 'href');
      const rel = (getAttr(node, 'rel') ?? '').toLowerCase().split(/\s+/);
      if (rel.includes('stylesheet')) {
        if (!href) throw artifactError(ARTIFACT_ERROR_CODES.UNRESOLVED_ASSET, 'Stylesheet link requires href.');
        const classification = classifyReference(href);
        let entryPath;
        if (classification.kind === 'external') {
          entryPath = (await context.resolveRemote(href, 'stylesheet')).toString();
        } else {
          const resolved = context.resolveLocal(href, fromDir, 'stylesheet');
          if (resolved.kind !== 'local') throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `Stylesheet must be local: ${href}`);
          entryPath = resolved.path;
        }
        const css = await bundleWithEsbuild(context, { entryPath, loader: 'css', kind: 'css' });
        const replacement = createElement('style');
        const assetDigest = digestArtifact(css);
        context.accountGeneratedAddition(`${assetDigest}${css}`, 'linked stylesheet');
        setAttr(replacement, 'data-planr-asset', assetDigest);
        setTextContent(replacement, css);
        replaceNode(node, replacement);
        continue;
      }
      if (href && rel.some((value) => ['icon', 'apple-touch-icon', 'mask-icon'].includes(value))) {
        setAttr(node, 'href', await dataUrlFor(context, href, fromDir, 'link asset', context));
      } else if (href) {
        throw artifactError(ARTIFACT_ERROR_CODES.UNSAFE_HTML, `Unsupported link relation: ${rel.join(' ') || '(none)'}`);
      }
    }
    if (tag === 'style') {
      const css = await bundleWithEsbuild(context, { source: textContent(node), resolveDir: fromDir, loader: 'css', kind: 'css' });
      setGeneratedText(context, node, css, 'inline stylesheet');
    }
    if (tag === 'script') {
      const src = getAttr(node, 'src');
      const type = (getAttr(node, 'type') ?? '').trim().toLowerCase();
      const isModule = type === 'module';
      const isInert = INERT_SCRIPT_TYPES.has(type) || type.startsWith('text/x-');
      if (isInert) {
        if (src) {
          throw artifactError(
            ARTIFACT_ERROR_CODES.UNSAFE_HTML,
            `Inert script data must be embedded instead of loaded from src: ${src}`,
          );
        }
        context.assertPrivacySafe(textContent(node), `inert ${type || 'script'} data`);
        queue.push(...descendants(node));
        continue;
      }
      if (!isModule && !JAVASCRIPT_SCRIPT_TYPES.has(type)) {
        throw artifactError(
          ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE,
          `Unsupported script type: ${type || '(none)'}`,
        );
      }
      let source;
      let sourcePath;
      if (src) {
        if (getAttr(node, 'async') !== undefined || getAttr(node, 'defer') !== undefined) {
          throw artifactError(
            ARTIFACT_ERROR_CODES.UNSUPPORTED_MODULE,
            'External scripts using async or defer cannot be safely inlined.',
          );
        }
        const classification = classifyReference(src);
        if (classification.kind === 'external') {
          const remote = await context.readRemote(src, 'script');
          if (remote.loader !== 'js') {
            throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `Remote script is not JavaScript: ${src}`);
          }
          sourcePath = remote.url;
          source = new TextDecoder('utf-8', { fatal: true }).decode(remote.buffer);
          context.assertPrivacySafe(source, remote.url, { allowRemoteUrls: true });
        } else {
          const resolved = context.resolveLocal(src, fromDir, 'script');
          if (resolved.kind !== 'local') throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `Script must be local: ${src}`);
          sourcePath = resolved.path;
          source = await context.readText(sourcePath, { allowRemoteUrls: true });
        }
        removeAttr(node, 'src');
        for (const attr of ['integrity', 'crossorigin', 'referrerpolicy']) removeAttr(node, attr);
      } else {
        source = textContent(node);
        context.assertPrivacySafe(source, 'inline script');
      }
      const code = isModule
        ? await bundleWithEsbuild(context, sourcePath
          ? { entryPath: sourcePath, loader: 'js', kind: 'module' }
          : { source, resolveDir: fromDir, loader: 'js', kind: 'module' })
        : await transformClassicScript(context, source, src ?? 'inline script');
      setGeneratedText(context, node, code, 'script');
    }
    const sourceAttrs = [];
    if (['img', 'source', 'video', 'audio', 'track', 'input'].includes(tag)) sourceAttrs.push('src');
    if (tag === 'video') sourceAttrs.push('poster');
    if (node.namespaceURI === 'http://www.w3.org/2000/svg' && !['a', 'style'].includes(tag)) {
      sourceAttrs.push('href', 'xlink:href');
    }
    for (const name of sourceAttrs) {
      const value = getAttr(node, name);
      if (value) {
        setAttr(node, name, await dataUrlFor(context, value, fromDir, `${tag} ${name}`, context));
      }
    }
    const srcset = getAttr(node, 'srcset');
    if (srcset) {
      setAttr(node, 'srcset', await rewriteSrcset(context, srcset, fromDir));
    }
    const style = getAttr(node, 'style');
    if (style && /(?:url\s*\(|@import)/i.test(style)) {
      setGeneratedAttr(
        context,
        node,
        'style',
        await rewriteStyleDeclaration(context, style, fromDir),
        'inline style',
      );
    }
    queue.push(...descendants(node));
  }
  assertBoundedSerialization(document, 'artifact output');
  const html = normalizeUtf8Text(serialize(document));
  context.assertFinalGeneratedOutput(html);
  context.assertPrivacySafe(html, 'bundled HTML');
  const finalDocument = parse(html);
  const remaining = descendants(finalDocument);
  while (remaining.length > 0) {
    const node = remaining.shift();
    for (const attr of node.attrs ?? []) {
      if (attr.name.toLowerCase() === 'srcset') {
        for (const candidate of parseSrcset(attr.value)) {
          if (!['data', 'internal'].includes(classifyReference(candidate.url).kind)) {
            throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `Unpackaged srcset URI remains: ${candidate.url}`);
          }
        }
        continue;
      }
      if (!['src', 'href', 'xlink:href', 'poster', 'data', 'action', 'formaction', 'ping'].includes(attr.name.toLowerCase())) continue;
      const reference = classifyReference(attr.value);
      if (!['data', 'internal'].includes(reference.kind)) {
        throw artifactError(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET, `Unpackaged URI remains in bundled HTML: ${attr.value}`);
      }
    }
    remaining.push(...descendants(node));
  }
  return html;
}

/**
 * Bundle one HTML entry into stable, self-contained UTF-8 HTML.
 * Paths in the result are root-relative logical identifiers only.
 */
export async function bundleArtifact(entryOrOptions, maybeOptions = {}) {
  const provided = typeof entryOrOptions === 'object' && entryOrOptions !== null
    ? entryOrOptions
    : { ...maybeOptions, entry: entryOrOptions };
  const entry = provided.entry ?? provided.file;
  if (typeof entry !== 'string' || entry.trim() === '') {
    throw artifactError(ARTIFACT_ERROR_CODES.INPUT_INVALID, 'bundleArtifact requires a non-empty HTML entry path.');
  }
  const root = resolve(provided.root ?? process.cwd());
  const context = new BundleContext({
    root,
    maxFiles: constrainedLimit(provided.maxFiles, DEFAULT_MAX_FILES, 'maxFiles'),
    maxBytes: constrainedLimit(provided.maxBytes, DEFAULT_MAX_BYTES, 'maxBytes'),
    sensitiveValues: provided.sensitiveValues,
    remoteAssets: provided.remoteAssets ?? 'bundle',
    fetchImpl: provided.fetchImpl ?? globalThis.fetch,
    lookupImpl: provided.lookupImpl ?? lookupDns,
  });
  const absoluteEntry = isAbsolute(entry);
  const entryCandidate = absoluteEntry ? resolve(entry) : resolve(context.root, entry);
  if (!absoluteEntry && !isPathContained(context.root, entryCandidate)) {
    throw artifactError(ARTIFACT_ERROR_CODES.PATH_TRAVERSAL, 'Artifact entry escapes the configured root.');
  }
  if (!existsSync(entryCandidate)) {
    throw artifactError(ARTIFACT_ERROR_CODES.FILE_MISSING, `Artifact entry does not exist: ${entry}`);
  }
  const entryPath = realpathSync(entryCandidate);
  if (!isPathContained(context.root, entryPath)) {
    const code = isPathContained(context.root, entryCandidate)
      ? ARTIFACT_ERROR_CODES.SYMLINK_ESCAPE
      : ARTIFACT_ERROR_CODES.PATH_TRAVERSAL;
    throw artifactError(code, 'Artifact entry resolves outside the configured root.');
  }
  if (!statSync(entryPath).isFile()) {
    throw artifactError(ARTIFACT_ERROR_CODES.INPUT_INVALID, 'Artifact entry must be a regular HTML file.');
  }
  if (!['.html', '.htm'].includes(extname(entryPath).toLowerCase())) {
    throw artifactError(ARTIFACT_ERROR_CODES.INPUT_INVALID, 'Artifact entry must be an HTML file.');
  }
  const input = await context.readText(entryPath, { allowRemoteUrls: context.remoteAssets === 'bundle' });
  const html = await rewriteHtml(context, entryPath, input);
  const bytes = Buffer.byteLength(html, 'utf8');
  return {
    schemaVersion: '1.0.0',
    html,
    sha256: digestArtifact(html),
    bytes,
    inputBytes: context.totalBytes,
    fileCount: context.buffers.size + context.remoteBuffers.size,
    remoteAssetCount: context.remoteBuffers.size,
    files: [...context.buffers.keys()].map((path) => context.logicalPath(path)).sort(),
    assets: [...context.assets.values()].sort((left, right) => left.sha256.localeCompare(right.sha256)),
  };
}
