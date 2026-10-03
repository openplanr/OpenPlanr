/** Resource packing with independent bounded codecs and lazy authenticated delivery. */

import { canonicalizeJson } from '@openplanr/protocol/canonical-json';
import {
  assertLargeObjectContract,
  LARGE_OBJECT_CHUNK_CONTEXT,
  LARGE_OBJECT_LIMITS as LIMITS,
  RESOURCE_HTML_SEGMENT_ENCODING,
} from '@openplanr/protocol/large-object-contracts';
import { deflateRaw, Inflate } from 'pako';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const htmlSegmentMagic = encoder.encode(`\0${RESOURCE_HTML_SEGMENT_ENCODING}\0`);
const blockPattern = /(<(script|style)\b[^>]*>)([\s\S]*?)<\/\2\s*>/gi;
export function encodeResourceBytes(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
export function decodeResourceBytes(value, maxBytes = 65536) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9_-]+$/u.test(value) ||
    value.length > Math.ceil((maxBytes * 4) / 3)
  )
    throw new TypeError('Invalid encoded resource value.');
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) =>
    char.charCodeAt(0),
  );
  if (bytes.byteLength > maxBytes || encodeResourceBytes(bytes) !== value)
    throw new TypeError('Noncanonical resource encoding.');
  return bytes;
}
export async function resourceSha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
}
export function encodeResource(bytes) {
  const compressed = deflateRaw(bytes);
  return compressed.byteLength < bytes.byteLength
    ? { bytes: compressed, codec: 'deflate-raw' }
    : { bytes, codec: 'identity' };
}
export function decodeResource(bytes, descriptor, maxBytes = LIMITS.decodedBytes) {
  if (
    descriptor.encodedBytes !== bytes.byteLength ||
    descriptor.decodedBytes > maxBytes ||
    descriptor.decodedBytes < 1
  )
    throw new RangeError('Resource size is invalid.');
  if (descriptor.codec === 'identity') {
    if (bytes.byteLength !== descriptor.decodedBytes)
      throw new TypeError('Identity resource length differs.');
    return bytes;
  }
  if (descriptor.codec !== 'deflate-raw') throw new TypeError('Unsupported resource codec.');
  const inflater = new Inflate({ raw: true, chunkSize: 65536 });
  const chunks = [];
  let size = 0;
  inflater.onData = (part) => {
    size += part.byteLength;
    if (size > descriptor.decodedBytes || size > maxBytes)
      throw new RangeError('Resource expands beyond its declared limit.');
    chunks.push(part);
  };
  inflater.push(bytes, true);
  // A full output buffer can leave a pending match even after input is consumed.
  // Drain it without adding input; require the actual deflate end marker below.
  if (!inflater.ended && !inflater.err && inflater.strm?.avail_in === 0)
    inflater.push(new Uint8Array(0), true);
  if (
    !inflater.ended ||
    inflater.err ||
    size !== descriptor.decodedBytes ||
    inflater.strm?.avail_in
  )
    throw new TypeError('Compressed resource is corrupt or has trailing data.');
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

// Count JSON string escapes before building a potentially much larger serialized source.
function jsonStringByteLength(value, maxBytes) {
  let bytes = 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92) bytes += 2;
    else if (code < 32) bytes += [8, 9, 10, 12, 13].includes(code) ? 2 : 6;
    else if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 6;
    } else bytes += code >= 0xdc00 && code <= 0xdfff ? 6 : 3;
    if (bytes > maxBytes) throw new RangeError('Resource pack exceeds its decoded byte limit.');
  }
  return bytes;
}

function utf8SegmentInfo(text, maximum) {
  let bytes = 0,
    wellFormed = true;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else {
        bytes += 3;
        wellFormed = false;
      }
    } else {
      bytes += 3;
      if (code >= 0xdc00 && code <= 0xdfff) wellFormed = false;
    }
    if (bytes > maximum) throw new RangeError('Resource pack exceeds its decoded byte limit.');
  }
  return { bytes, wellFormed };
}
function segmentText(segment) {
  if (typeof segment === 'string') return { type: 0, text: segment };
  if (!segment || typeof segment !== 'object' || Array.isArray(segment))
    throw new TypeError('Source segment is invalid.');
  const descriptors = Object.getOwnPropertyDescriptors(segment);
  if (
    Reflect.ownKeys(descriptors).length !== 1 ||
    !Object.hasOwn(descriptors, 'resourceId') ||
    !Object.hasOwn(descriptors.resourceId, 'value') ||
    typeof descriptors.resourceId.value !== 'string' ||
    !/^r[0-9]{1,4}$/u.test(descriptors.resourceId.value)
  )
    throw new TypeError('Source segment is invalid.');
  return { type: 1, text: descriptors.resourceId.value };
}
/** Versioned binary literals preserve UTF-8 bytes without JSON escaping amplification. */
export function encodeHtmlSegments(segments, maxBytes = LIMITS.decodedBytes) {
  if (
    !Array.isArray(segments) ||
    !segments.length ||
    segments.length > LIMITS.resources * 2 + 1 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > LIMITS.decodedBytes
  )
    throw new RangeError('Source segment count or byte limit is invalid.');
  let byteLength = htmlSegmentMagic.byteLength + 4,
    wellFormed = true;
  const parts = [];
  for (const segment of segments) {
    const part = segmentText(segment);
    byteLength += 5;
    if (byteLength > maxBytes)
      throw new RangeError('Resource pack exceeds its decoded byte limit.');
    const info = utf8SegmentInfo(part.text, maxBytes - byteLength);
    byteLength += info.bytes;
    wellFormed &&= info.wellFormed;
    parts.push({ ...part, byteLength: info.bytes });
  }
  // Canonical bundle JSON also rejects lone surrogates; never silently replace source text.
  if (!wellFormed) throw new TypeError('Source segment text is not valid Unicode.');
  const bytes = new Uint8Array(byteLength),
    view = new DataView(bytes.buffer);
  bytes.set(htmlSegmentMagic);
  view.setUint32(htmlSegmentMagic.byteLength, parts.length);
  let cursor = htmlSegmentMagic.byteLength + 4;
  for (const part of parts) {
    bytes[cursor++] = part.type;
    view.setUint32(cursor, part.byteLength);
    cursor += 4;
    const encoded = encoder.encodeInto(part.text, bytes.subarray(cursor, cursor + part.byteLength));
    if (encoded.read !== part.text.length || encoded.written !== part.byteLength)
      throw new TypeError('Source segment byte accounting differs.');
    cursor += part.byteLength;
  }
  return bytes;
}
/** Legacy JSON segments remain readable; binary spans are bounded before allocating strings. */
export function decodeHtmlSegments(bytes, maxBytes = LIMITS.decodedBytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    !bytes.byteLength ||
    bytes.byteLength > maxBytes ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > LIMITS.decodedBytes
  )
    throw new RangeError('Source segment bytes exceed their limit.');
  if (bytes[0] !== 0) {
    const segments = JSON.parse(decoder.decode(bytes));
    if (!Array.isArray(segments) || !segments.length || segments.length > LIMITS.resources * 2 + 1)
      throw new TypeError('Source segment count is invalid.');
    for (const segment of segments) segmentText(segment);
    return segments;
  }
  if (
    bytes.byteLength < htmlSegmentMagic.byteLength + 4 ||
    htmlSegmentMagic.some((byte, index) => byte !== bytes[index])
  )
    throw new TypeError('Source segment encoding is unsupported or corrupt.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(htmlSegmentMagic.byteLength);
  if (!count || count > LIMITS.resources * 2 + 1)
    throw new TypeError('Source segment count is invalid.');
  const segments = [];
  let cursor = htmlSegmentMagic.byteLength + 4;
  for (let index = 0; index < count; index++) {
    if (bytes.byteLength - cursor < 5) throw new TypeError('Source segment span is truncated.');
    const type = bytes[cursor++],
      length = view.getUint32(cursor);
    cursor += 4;
    if (
      ![0, 1].includes(type) ||
      length > bytes.byteLength - cursor ||
      (type === 1 && length > 128)
    )
      throw new TypeError('Source segment span is invalid.');
    const text = decoder.decode(bytes.subarray(cursor, cursor + length));
    cursor += length;
    const segment = type === 0 ? text : { resourceId: text };
    segmentText(segment);
    segments.push(segment);
  }
  if (cursor !== bytes.byteLength) throw new TypeError('Source segment bytes have trailing data.');
  return segments;
}

/** Preserve original HTML bytes; factor shared script/style bodies before independent compression. */
export async function packResourceBundle(bundle, { reviewOf } = {}) {
  if (reviewOf !== undefined && !/^[a-f0-9]{64}$/u.test(reviewOf))
    throw new TypeError('Invalid full review identity.');
  const diagram = bundle?.kind === 'openplanr-diagram-review-bundle';
  const envelope = diagram
    ? { schemaVersion: '1.0.0', artifacts: [{ id: 'diagram', html: bundle.scene?.svg }] }
    : bundle?.envelope;
  const views = envelope?.artifacts;
  if (
    !Array.isArray(views) ||
    !views.length ||
    views.length > LIMITS.views ||
    new Set(views.map((view) => view.id)).size !== views.length
  )
    throw new RangeError('Resource pack view count or identity is invalid.');
  const pooled = envelope.schemaVersion === '1.1.0';
  let sources;
  const viewSources = Object.create(null);
  if (pooled) {
    sources = envelope.sources;
    if (
      !Array.isArray(sources) ||
      !sources.length ||
      sources.length > LIMITS.sources ||
      new Set(sources.map((source) => source.id)).size !== sources.length
    )
      throw new RangeError('Resource pack source count or identity is invalid.');
    const sourceIds = new Set(sources.map((source) => source.id));
    for (const view of views) {
      if (!sourceIds.has(view.sourceId)) throw new TypeError('View references an unknown source.');
      viewSources[view.id] = view.sourceId;
    }
  } else {
    sources = [];
    const pages = new Map();
    for (const view of views) {
      if (typeof view.html !== 'string') throw new TypeError('View has no HTML source.');
      if (!pages.has(view.html)) {
        const id = `source-${sources.length}`;
        pages.set(view.html, id);
        sources.push({ id, html: view.html });
      }
      viewSources[view.id] = pages.get(view.html);
    }
  }
  if (sources.length > LIMITS.sources)
    throw new RangeError('Resource pack exceeds its source limit.');
  const blocks = new Map();
  const resources = [];
  const encodedResources = [];
  let encodedBytes = 0,
    decodedBytes = 0,
    uniqueHtmlBytes = 0;
  async function addResource(type, bytes) {
    if (!bytes.byteLength || resources.length >= LIMITS.resources)
      throw new RangeError('Resource count exceeds its limit.');
    if (bytes.byteLength > LIMITS.decodedBytes - decodedBytes)
      throw new RangeError('Resource pack exceeds its decoded byte limit.');
    const encoded = encodeResource(bytes);
    const descriptor = {
      id: `r${resources.length}`,
      type,
      offset: encodedBytes,
      encodedBytes: encoded.bytes.byteLength,
      decodedBytes: bytes.byteLength,
      codec: encoded.codec,
      sha256: await resourceSha256(bytes),
    };
    encodedBytes += descriptor.encodedBytes;
    decodedBytes += descriptor.decodedBytes;
    if (decodedBytes > LIMITS.decodedBytes || encodedBytes > LIMITS.decodedBytes)
      throw new RangeError('Resource pack exceeds its decoded byte limit.');
    resources.push(descriptor);
    encodedResources.push(encoded.bytes);
    return descriptor.id;
  }
  const sourceRecords = [];
  for (const source of sources) {
    if (typeof source.html !== 'string' || !source.html.length)
      throw new TypeError('Source HTML is invalid.');
    let info;
    try {
      info = utf8SegmentInfo(source.html, LIMITS.uniqueHtmlBytes - uniqueHtmlBytes);
    } catch {
      throw new RangeError('Resource pack exceeds its unique HTML limit.');
    }
    if (!info.wellFormed) throw new TypeError('Source HTML is not valid Unicode.');
    uniqueHtmlBytes += info.bytes;
    const htmlBytes = encoder.encode(source.html);
    const sha256 = await resourceSha256(htmlBytes);
    if (source.sha256 && source.sha256 !== sha256)
      throw new TypeError('Source digest does not match its HTML.');
    const segments = [];
    let offset = 0;
    for (const match of source.html.matchAll(blockPattern)) {
      const body = match[3];
      if (
        segments.length >= LIMITS.resources * 2 ||
        body.length < 2048 ||
        (!blocks.has(body) && blocks.size >= 512)
      )
        continue;
      const start = match.index + match[1].length;
      segments.push(source.html.slice(offset, start));
      if (!blocks.has(body))
        blocks.set(body, await addResource('shared-block', encoder.encode(body)));
      segments.push({ resourceId: blocks.get(body) });
      offset = start + body.length;
    }
    segments.push(source.html.slice(offset));
    const resourceId = await addResource(
      'html-segments',
      encodeHtmlSegments(segments, LIMITS.decodedBytes - decodedBytes),
    );
    sourceRecords.push({ id: source.id, resourceId, htmlBytes: htmlBytes.byteLength, sha256 });
  }
  const withoutHtml = ({ html: _html, ...value }) => value;
  const metadata = diagram
    ? { ...bundle, scene: { ...bundle.scene, svg: '' } }
    : {
        ...bundle,
        envelope: {
          ...envelope,
          artifacts: views.map(withoutHtml),
          ...(pooled ? { sources: sources.map(withoutHtml) } : {}),
        },
      };
  const catalog = {
    schemaVersion: '1.0.0',
    kind: 'openplanr-resource-catalog',
    ...(reviewOf === undefined ? {} : { reviewOf }),
    bundle: metadata,
    uniqueHtmlBytes,
    totalDecodedBytes: decodedBytes,
    resources,
    sources: sourceRecords,
    viewSources,
  };
  let catalogBytes;
  for (let attempt = 0; attempt < 4; attempt++) {
    catalogBytes = encoder.encode(canonicalizeJson(catalog));
    const total = decodedBytes + catalogBytes.byteLength;
    if (catalog.totalDecodedBytes === total) break;
    catalog.totalDecodedBytes = total;
  }
  catalogBytes = encoder.encode(canonicalizeJson(catalog));
  if (
    decodedBytes + catalogBytes.byteLength !== catalog.totalDecodedBytes ||
    catalog.totalDecodedBytes > LIMITS.decodedBytes
  )
    throw new RangeError('Resource pack total exceeds its decoded limit.');
  assertLargeObjectContract(catalog, 'resource-catalog');
  const encodedCatalog = encodeResource(catalogBytes);
  const catalogSpan = {
    offset: encodedBytes,
    encodedBytes: encodedCatalog.bytes.byteLength,
    decodedBytes: catalogBytes.byteLength,
    codec: encodedCatalog.codec,
  };
  return {
    catalog,
    catalogSpan,
    encodedResources: [...encodedResources, encodedCatalog.bytes],
    plaintextBytes: encodedBytes + encodedCatalog.bytes.byteLength,
  };
}

export function resourceChunkAAD(manifest, index) {
  return encoder.encode(
    canonicalizeJson({
      context: LARGE_OBJECT_CHUNK_CONTEXT,
      workspaceId: manifest.workspaceId,
      revisionId: manifest.revisionId,
      epoch: manifest.epoch,
      index,
    }),
  );
}
/** Encrypt sequential bounded pieces; never join the complete package in one ArrayBuffer. */
export async function encryptResourcePack(
  pack,
  { workspaceId, revisionId, epoch, rawKey, sign, createdAt = new Date().toISOString() },
) {
  const header = {
    schemaVersion: '2.0.0',
    kind: 'openplanr-encrypted-resource-manifest',
    workspaceId,
    revisionId,
    epoch,
    createdAt,
    plaintextBytes: pack.plaintextBytes,
    catalog: pack.catalogSpan,
  };
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const chunks = [];
  const descriptors = [];
  const ivs = new Set();
  let part = new Uint8Array(LIMITS.chunkPlaintextBytes),
    filled = 0;
  async function flush() {
    if (!filled) return;
    let iv, encodedIv;
    do {
      iv = crypto.getRandomValues(new Uint8Array(12));
      encodedIv = encodeResourceBytes(iv);
    } while (ivs.has(encodedIv));
    ivs.add(encodedIv);
    const index = chunks.length;
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: resourceChunkAAD(header, index), tagLength: 128 },
        key,
        part.subarray(0, filled),
      ),
    );
    if (chunks.length >= LIMITS.chunks)
      throw new RangeError('Encrypted pack exceeds its chunk limit.');
    chunks.push(cipher);
    descriptors.push({
      index,
      iv: encodedIv,
      byteLength: cipher.byteLength,
      sha256: await resourceSha256(cipher),
    });
    filled = 0;
  }
  for (const bytes of pack.encodedResources) {
    for (let offset = 0; offset < bytes.byteLength; ) {
      const take = Math.min(part.byteLength - filled, bytes.byteLength - offset);
      part.set(bytes.subarray(offset, offset + take), filled);
      filled += take;
      offset += take;
      if (filled === part.byteLength) await flush();
    }
  }
  await flush();
  part.fill(0);
  const manifest = await sign({
    ...header,
    ciphertextBytes: chunks.reduce((sum, value) => sum + value.byteLength, 0),
    chunks: descriptors,
  });
  assertLargeObjectContract(manifest, 'encrypted-resource-manifest');
  return { manifest, chunks };
}

/** Verify signed ciphertext before decryption, then lazily resolve only selected source dependencies. */
export async function openResourcePack(
  manifest,
  { rawKey, verify, fetchChunk, maxCachedBytes = 8 * 1024 * 1024 },
) {
  assertLargeObjectContract(manifest, 'encrypted-resource-manifest');
  if (!(await verify(manifest))) throw new TypeError('Resource manifest signature is invalid.');
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const cache = new Map();
  let cacheBytes = 0,
    disposed = false;
  if (
    !Number.isSafeInteger(maxCachedBytes) ||
    maxCachedBytes < LIMITS.chunkBytes ||
    maxCachedBytes > LIMITS.decodedBytes
  )
    throw new RangeError('Resource cache bound is invalid.');
  async function chunkAt(index) {
    if (disposed) throw new Error('Resource pack has been disposed.');
    if (cache.has(index)) {
      const bytes = cache.get(index);
      cache.delete(index);
      cache.set(index, bytes);
      return bytes;
    }
    const descriptor = manifest.chunks[index];
    const bytes = await fetchChunk(index, descriptor);
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength !== descriptor.byteLength ||
      (await resourceSha256(bytes)) !== descriptor.sha256
    )
      throw new TypeError('Ciphertext chunk integrity check failed.');
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: decodeResourceBytes(descriptor.iv, 12),
          additionalData: resourceChunkAAD(manifest, index),
          tagLength: 128,
        },
        key,
        bytes,
      ),
    );
    if (disposed) {
      plaintext.fill(0);
      throw new Error('Resource pack has been disposed.');
    }
    cache.set(index, plaintext);
    cacheBytes += plaintext.byteLength;
    while (cacheBytes > maxCachedBytes && cache.size > 1) {
      const first = cache.keys().next().value;
      cacheBytes -= cache.get(first).byteLength;
      cache.delete(first);
    }
    return plaintext;
  }
  return openPackedResources({
    catalogSpan: manifest.catalog,
    plaintextBytes: manifest.plaintextBytes,
    chunkPlaintextBytes: LIMITS.chunkPlaintextBytes,
    chunkAt,
    dispose() {
      disposed = true;
      for (const bytes of cache.values()) bytes.fill(0);
      cache.clear();
      cacheBytes = 0;
    },
  });
}

async function openPackedResources({
  catalogSpan,
  plaintextBytes,
  chunkPlaintextBytes,
  chunkAt,
  dispose = () => {},
}) {
  async function spanBytes(span) {
    if (
      !Number.isSafeInteger(span.offset) ||
      !Number.isSafeInteger(span.encodedBytes) ||
      span.offset < 0 ||
      span.encodedBytes < 1 ||
      span.offset + span.encodedBytes > plaintextBytes
    )
      throw new TypeError('Resource span is invalid.');
    const bytes = new Uint8Array(span.encodedBytes);
    for (let copied = 0; copied < bytes.byteLength; ) {
      const absolute = span.offset + copied,
        index = Math.floor(absolute / chunkPlaintextBytes),
        within = absolute % chunkPlaintextBytes;
      const chunk = await chunkAt(index);
      const take = Math.min(chunk.byteLength - within, bytes.byteLength - copied);
      if (take < 1) throw new TypeError('Resource span exceeds its chunks.');
      bytes.set(chunk.subarray(within, within + take), copied);
      copied += take;
    }
    return bytes;
  }
  const catalogBytes = decodeResource(
    await spanBytes(catalogSpan),
    catalogSpan,
    LIMITS.catalogBytes,
  );
  const catalog = assertLargeObjectContract(
    JSON.parse(decoder.decode(catalogBytes)),
    'resource-catalog',
  );
  const resourceBytes = catalog.resources.reduce((sum, part) => sum + part.decodedBytes, 0);
  const encodedBytes = catalog.resources.reduce((sum, part) => sum + part.encodedBytes, 0);
  if (
    resourceBytes + catalogBytes.byteLength !== catalog.totalDecodedBytes ||
    encodedBytes !== catalogSpan.offset
  )
    throw new TypeError('Catalog and manifest byte accounting differ.');
  const resources = new Map(catalog.resources.map((resource) => [resource.id, resource]));
  const sourceRecords = new Map(catalog.sources.map((source) => [source.id, source]));
  async function resourceAt(id, expectedType, maxBytes = LIMITS.decodedBytes) {
    const descriptor = resources.get(id);
    if (
      !descriptor ||
      descriptor.type !== expectedType ||
      descriptor.offset + descriptor.encodedBytes > catalogSpan.offset
    )
      throw new TypeError('Resource reference is invalid.');
    if (descriptor.decodedBytes > maxBytes || descriptor.encodedBytes > maxBytes)
      throw new RangeError('Selected source resource exceeds its read limit.');
    const decoded = decodeResource(await spanBytes(descriptor), descriptor, maxBytes);
    if ((await resourceSha256(decoded)) !== descriptor.sha256)
      throw new TypeError('Decoded resource integrity check failed.');
    return decoded;
  }
  async function loadSource(id, { maxSourceBytes } = {}) {
    const source = sourceRecords.get(id);
    if (!source) throw new TypeError('Unknown source.');
    if (
      maxSourceBytes !== undefined &&
      (!Number.isSafeInteger(maxSourceBytes) ||
        maxSourceBytes < 1 ||
        maxSourceBytes > LIMITS.uniqueHtmlBytes)
    )
      throw new RangeError('Selected source read limit is invalid.');
    if (maxSourceBytes !== undefined && source.htmlBytes > maxSourceBytes)
      throw new RangeError('Selected source exceeds its read limit.');
    // Legacy JSON literals can escape each UTF-8 byte into six bytes. Reference
    // records and the binary header have separate bounded overhead. Enforce this
    // before fetching or inflating a source that lies about its HTML byte count.
    const segmentLimit =
      maxSourceBytes === undefined
        ? LIMITS.decodedBytes
        : Math.min(
            LIMITS.decodedBytes,
            maxSourceBytes * 6 + (LIMITS.resources * 2 + 1) * 160 + htmlSegmentMagic.byteLength + 4,
          );
    const segments = decodeHtmlSegments(
      await resourceAt(source.resourceId, 'html-segments', segmentLimit),
      segmentLimit,
    );
    if (!Array.isArray(segments) || segments.length > LIMITS.resources * 2 + 1)
      throw new TypeError('Source segment count is invalid.');
    const parts = [];
    let htmlBytes = 0;
    for (const segment of segments) {
      let text;
      if (typeof segment === 'string') text = segment;
      else if (
        segment &&
        Object.keys(segment).length === 1 &&
        typeof segment.resourceId === 'string'
      )
        text = decoder.decode(
          await resourceAt(
            segment.resourceId,
            'shared-block',
            maxSourceBytes ?? LIMITS.decodedBytes,
          ),
        );
      else throw new TypeError('Source segment is invalid.');
      htmlBytes += encoder.encode(text).byteLength;
      if (htmlBytes > source.htmlBytes)
        throw new RangeError('Source expands beyond its declared limit.');
      parts.push(text);
    }
    const html = parts.join('');
    if (
      htmlBytes !== source.htmlBytes ||
      (await resourceSha256(encoder.encode(html))) !== source.sha256
    )
      throw new TypeError('Reconstructed HTML integrity check failed.');
    return html;
  }
  async function loadView(viewId, options) {
    if (catalog.bundle.kind === 'openplanr-diagram-review-bundle') {
      if (viewId !== 'diagram') throw new TypeError('Unknown diagram view.');
      return { id: 'diagram', html: await loadSource(catalog.viewSources.diagram, options) };
    }
    const view = catalog.bundle.envelope.artifacts.find((item) => item.id === viewId);
    if (!view || !Object.hasOwn(catalog.viewSources, viewId)) throw new TypeError('Unknown view.');
    return { ...view, html: await loadSource(catalog.viewSources[viewId], options) };
  }
  async function loadBundle({ sourcePool = false } = {}) {
    // Unique-resource accounting does not bound inline reconstruction: repeated views can
    // amplify one source thousands of times. Bound the serialized result before any fetch.
    const metadataBytes = encoder.encode(canonicalizeJson(catalog.bundle)).byteLength;
    const poolInline =
      sourcePool &&
      catalog.bundle.kind === 'openplanr-design-review-bundle' &&
      catalog.bundle.envelope.schemaVersion !== '1.1.0';
    const references =
      catalog.bundle.kind === 'openplanr-diagram-review-bundle'
        ? [{ id: catalog.viewSources.diagram, field: null }]
        : catalog.bundle.envelope.schemaVersion === '1.1.0'
          ? catalog.bundle.envelope.sources.map((source) => ({ id: source.id, field: 'html' }))
          : poolInline
            ? catalog.sources.map((source) => ({ id: source.id, field: 'html' }))
            : catalog.bundle.envelope.artifacts.map((view) => ({
                id: catalog.viewSources[view.id],
                field: 'html',
              }));
    const counts = new Map();
    let serializedBytes = metadataBytes;
    for (const { id, field } of references) {
      const source = sourceRecords.get(id);
      if (!source) throw new TypeError('Unknown source.');
      // All removed HTML/SVG fields are additions to a nonempty object.
      serializedBytes += source.htmlBytes + (field === null ? 0 : field.length + 6);
      if (serializedBytes > LIMITS.decodedBytes)
        throw new RangeError(
          'Complete bundle reconstruction exceeds its serialized byte limit. Use lazy views.',
        );
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    // Pooled/unique representations allocate every source once. JSON escaping is a local
    // export concern, rather than extra decoded transport content. Repeated inline copies
    // still need a serialized budget before a consumer can accidentally expand them.
    const uniqueRepresentation = [...counts.values()].every((count) => count === 1);
    const htmlBySource = new Map();
    for (const [id, count] of counts) {
      const html = await loadSource(id);
      const source = sourceRecords.get(id);
      if (!uniqueRepresentation) {
        const escapedBytes = jsonStringByteLength(html, LIMITS.decodedBytes);
        serializedBytes += count * (escapedBytes - source.htmlBytes - 2);
      }
      if (serializedBytes > LIMITS.decodedBytes)
        throw new RangeError(
          'Complete bundle reconstruction exceeds its serialized byte limit. Use lazy views.',
        );
      htmlBySource.set(id, html);
    }
    const bundle = structuredClone(catalog.bundle);
    if (poolInline) {
      // Version 1.0 allowed a shared envelope; version 1.1 needs the additive pooled 1.2 shape.
      if (bundle.schemaVersion === '1.1.0') bundle.schemaVersion = '1.2.0';
      bundle.envelope.schemaVersion = '1.1.0';
      bundle.envelope.sources = catalog.sources.map((source) => ({
        id: source.id,
        kind: 'html',
        sha256: source.sha256,
        html: htmlBySource.get(source.id),
      }));
      bundle.envelope.artifacts = bundle.envelope.artifacts.map((view) => ({
        ...view,
        sourceId: catalog.viewSources[view.id],
      }));
      const actualMetadata = {
        ...bundle,
        envelope: {
          ...bundle.envelope,
          sources: bundle.envelope.sources.map(({ html: _html, ...source }) => source),
        },
      };
      const extraMetadata =
        encoder.encode(canonicalizeJson(actualMetadata)).byteLength - metadataBytes;
      if (serializedBytes + extraMetadata > LIMITS.decodedBytes)
        throw new RangeError('Complete pooled reconstruction exceeds its serialized byte limit.');
      return bundle;
    }
    if (bundle.kind === 'openplanr-diagram-review-bundle')
      bundle.scene.svg = htmlBySource.get(catalog.viewSources.diagram);
    else if (bundle.envelope.schemaVersion === '1.1.0') {
      for (const source of bundle.envelope.sources) source.html = htmlBySource.get(source.id);
    } else
      for (const view of bundle.envelope.artifacts)
        view.html = htmlBySource.get(catalog.viewSources[view.id]);
    return bundle;
  }
  return {
    catalog: structuredClone(catalog),
    bundle: structuredClone(catalog.bundle),
    reviewOf: catalog.reviewOf,
    loadSource,
    loadView,
    loadBundle,
    assertMatchesBundle: (value) => assertResourceBundleMatchesCatalog(value, catalog),
    dispose,
  };
}

/** Compare saved authored content to the exact logical catalog without encryption or recompression. */
export async function assertResourceBundleMatchesCatalog(bundle, catalog) {
  assertLargeObjectContract(catalog, 'resource-catalog');
  const diagram = bundle?.kind === 'openplanr-diagram-review-bundle';
  const envelope = diagram
    ? { schemaVersion: '1.0.0', artifacts: [{ id: 'diagram', html: bundle.scene?.svg }] }
    : bundle?.envelope;
  if (!Array.isArray(envelope?.artifacts))
    throw new TypeError('Saved content differs from resource catalog.');
  const sources = [],
    viewSources = Object.create(null),
    pages = new Map();
  if (envelope.schemaVersion === '1.1.0') {
    if (!Array.isArray(envelope.sources))
      throw new TypeError('Saved content differs from resource catalog.');
    sources.push(...envelope.sources);
    for (const view of envelope.artifacts) viewSources[view.id] = view.sourceId;
  } else
    for (const view of envelope.artifacts) {
      if (typeof view.html !== 'string')
        throw new TypeError('Saved content differs from resource catalog.');
      if (!pages.has(view.html)) {
        const id = `source-${sources.length}`;
        pages.set(view.html, id);
        sources.push({ id, html: view.html });
      }
      viewSources[view.id] = pages.get(view.html);
    }
  const withoutHtml = ({ html: _html, ...value }) => value;
  const metadata = diagram
    ? { ...bundle, scene: { ...bundle.scene, svg: '' } }
    : {
        ...bundle,
        envelope: {
          ...envelope,
          artifacts: envelope.artifacts.map(withoutHtml),
          ...(envelope.schemaVersion === '1.1.0' ? { sources: sources.map(withoutHtml) } : {}),
        },
      };
  if (
    canonicalizeJson(metadata) !== canonicalizeJson(catalog.bundle) ||
    canonicalizeJson(viewSources) !== canonicalizeJson(catalog.viewSources) ||
    sources.length !== catalog.sources.length
  )
    throw new TypeError('Saved content differs from resource catalog.');
  const saved = new Map(catalog.sources.map((source) => [source.id, source]));
  for (const source of sources) {
    const record = saved.get(source.id);
    if (!record || typeof source.html !== 'string')
      throw new TypeError('Saved source differs from resource catalog.');
    const info = utf8SegmentInfo(source.html, record.htmlBytes);
    if (!info.wellFormed || info.bytes !== record.htmlBytes)
      throw new TypeError('Saved source differs from resource catalog.');
    const bytes = encoder.encode(source.html);
    if ((await resourceSha256(bytes)) !== record.sha256)
      throw new TypeError('Saved source differs from resource catalog.');
  }
  return bundle;
}

/** Company resources are service-visible; this helper intentionally adds no client encryption. */
export async function packCompanyResourceBundle(
  bundle,
  { organizationId, projectId, artifactId, revisionId },
) {
  const pack = await packResourceBundle(bundle);
  const chunks = [];
  let bytes = new Uint8Array(LIMITS.chunkBytes),
    filled = 0;
  for (const resource of pack.encodedResources)
    for (let offset = 0; offset < resource.byteLength; ) {
      const take = Math.min(bytes.byteLength - filled, resource.byteLength - offset);
      bytes.set(resource.subarray(offset, offset + take), filled);
      filled += take;
      offset += take;
      if (filled === bytes.byteLength) {
        chunks.push(bytes);
        bytes = new Uint8Array(LIMITS.chunkBytes);
        filled = 0;
      }
    }
  if (filled) chunks.push(bytes.slice(0, filled));
  const descriptors = [];
  for (const [index, bytes] of chunks.entries())
    descriptors.push({ index, byteLength: bytes.byteLength, sha256: await resourceSha256(bytes) });
  const manifest = {
    schemaVersion: '2.0.0',
    kind: 'openplanr-company-resource-manifest',
    organizationId,
    projectId,
    artifactId,
    revisionId,
    contentDigest: `sha256:${await resourceSha256(encoder.encode(canonicalizeJson(pack.catalog)))}`,
    contentType: 'application/json',
    byteLength: pack.plaintextBytes,
    decodedBytes: pack.catalog.totalDecodedBytes,
    catalog: pack.catalogSpan,
    chunks: descriptors,
  };
  assertLargeObjectContract(manifest, 'company-resource-manifest');
  return { manifest, chunks, catalog: pack.catalog };
}
export async function openCompanyResourcePack(
  manifest,
  { fetchChunk, maxCachedBytes = 8 * 1024 * 1024 },
) {
  assertLargeObjectContract(manifest, 'company-resource-manifest');
  const cache = new Map();
  let size = 0;
  const result = await openPackedResources({
    catalogSpan: manifest.catalog,
    plaintextBytes: manifest.byteLength,
    chunkPlaintextBytes: LIMITS.chunkBytes,
    async chunkAt(index) {
      if (cache.has(index)) return cache.get(index);
      const descriptor = manifest.chunks[index],
        bytes = await fetchChunk(index, descriptor);
      if (
        !(bytes instanceof Uint8Array) ||
        bytes.byteLength !== descriptor.byteLength ||
        (await resourceSha256(bytes)) !== descriptor.sha256
      )
        throw new TypeError('Company resource chunk is corrupt.');
      cache.set(index, bytes);
      size += bytes.byteLength;
      while (size > maxCachedBytes && cache.size > 1) {
        const first = cache.keys().next().value;
        size -= cache.get(first).byteLength;
        cache.delete(first);
      }
      return bytes;
    },
    dispose() {
      cache.clear();
      size = 0;
    },
  });
  if (
    manifest.contentDigest !==
      `sha256:${await resourceSha256(encoder.encode(canonicalizeJson(result.catalog)))}` ||
    manifest.decodedBytes !== result.catalog.totalDecodedBytes
  ) {
    result.dispose();
    throw new TypeError('Company catalog identity differs.');
  }
  const exactLoad = result.loadBundle;
  result.loadBundle = async (options) => {
    try {
      return await exactLoad(options);
    } catch (error) {
      if (
        !(error instanceof RangeError) ||
        !/reconstruction.*serialized byte limit/.test(error.message)
      )
        throw error;
      return exactLoad({ sourcePool: true });
    }
  };
  return result;
}
