import { createEncryptedWorkspaceClient } from '@openplanr/artifact/encrypted-workspace-client.mjs';
import { canonicalizeJson, sha256Hex } from '@openplanr/protocol/canonical-json';
import {
  assertDesignReviewBundle,
  assertDesignReviewMetadata,
} from '@openplanr/protocol/review-experience-contracts';
import {
  assertWorkspaceContract,
  DESIGN_WORKSPACE_API,
  DESIGN_WORKSPACE_CREATE_SCHEMA,
  DESIGN_WORKSPACE_EVENT_SCHEMA,
  DESIGN_WORKSPACE_MAX_BYTES,
  DESIGN_WORKSPACE_MAX_EVENT_BYTES,
  DESIGN_WORKSPACE_REVISION_SCHEMA,
  DESIGN_WORKSPACE_SCHEMA,
  DESIGN_WORKSPACE_VERSION,
} from '@openplanr/protocol/workspace-contracts';

export const DESIGN_SHARE_BASE_URL = 'https://share.openplanr.dev';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const PACKED_BUNDLE_KIND = 'openplanr-design-review-bundle-packed';
const PACKED_BUNDLE_MAX_BYTES = 128 * 1024 * 1024;
const SHARED_BLOCK_MIN_LENGTH = 2048;
const sharedBlockPattern = /(<(script|style)\b[^>]*>)([\s\S]*?)<\/\2\s*>/gi;

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function inflateRaw(bytes, limit) {
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new RangeError('The shared design expands beyond its size limit.');
    }
    chunks.push(value);
  }
  const inflated = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    inflated.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return inflated;
}

/**
 * Stores each distinct artboard page and each repeated script or style body once, then
 * deflates. A design at three frame sizes otherwise carries every page three times.
 */
export async function packDesignReviewBundle(bundle) {
  const pages = [];
  const pageIndex = new Map();
  const blocks = [];
  const blockIndex = new Map();
  const segmentsOf = (html) => {
    const segments = [];
    let offset = 0;
    for (const match of html.matchAll(sharedBlockPattern)) {
      const body = match[3];
      if (body.length < SHARED_BLOCK_MIN_LENGTH) continue;
      const start = match.index + match[1].length;
      segments.push(html.slice(offset, start));
      if (!blockIndex.has(body)) blockIndex.set(body, blocks.push(body) - 1);
      segments.push(blockIndex.get(body));
      offset = start + body.length;
    }
    segments.push(html.slice(offset));
    return segments;
  };
  const artifactPages = [];
  const artifacts = bundle.envelope.artifacts.map(({ html, ...artifact }) => {
    if (!pageIndex.has(html)) pageIndex.set(html, pages.push(segmentsOf(html)) - 1);
    artifactPages.push(pageIndex.get(html));
    return artifact;
  });
  const packed = {
    bundle: { ...bundle, envelope: { ...bundle.envelope, artifacts } },
    artifactPages,
    pages,
    blocks,
  };
  return {
    kind: PACKED_BUNDLE_KIND,
    version: 1,
    data: encodeWorkspaceBytes(await deflateRaw(encoder.encode(JSON.stringify(packed)))),
  };
}

/** The bundle a packed share holds, or `value` unchanged when it was shared unpacked. */
export async function unpackDesignReviewBundle(value, { maxBytes = PACKED_BUNDLE_MAX_BYTES } = {}) {
  if (value?.kind !== PACKED_BUNDLE_KIND) return value;
  if (value.version !== 1 || typeof value.data !== 'string')
    throw new Error('The shared design uses an unsupported packing.');
  const { bundle, artifactPages, pages, blocks } = JSON.parse(
    decoder.decode(await inflateRaw(decodeWorkspaceBytes(value.data), maxBytes)),
  );
  const invalid = () => new Error('The shared design packing is invalid.');
  if (
    !Array.isArray(bundle?.envelope?.artifacts) ||
    !Array.isArray(pages) ||
    !Array.isArray(blocks) ||
    !Array.isArray(artifactPages) ||
    artifactPages.length !== bundle.envelope.artifacts.length
  )
    throw invalid();
  let expanded = 0;
  const html = pages.map((segments) => {
    if (!Array.isArray(segments)) throw invalid();
    const page = segments
      .map((segment) => {
        if (typeof segment === 'string') return segment;
        if (!Number.isInteger(segment) || typeof blocks[segment] !== 'string') throw invalid();
        return blocks[segment];
      })
      .join('');
    expanded += page.length;
    if (expanded > maxBytes)
      throw new RangeError('The shared design expands beyond its size limit.');
    return page;
  });
  const artifacts = bundle.envelope.artifacts.map((artifact, index) => {
    const page = html[artifactPages[index]];
    if (page === undefined) throw invalid();
    return { ...artifact, html: page };
  });
  return { ...bundle, envelope: { ...bundle.envelope, artifacts } };
}

const client = createEncryptedWorkspaceClient({
  domain: 'openplanr-design-workspace/v1',
  apiPath: DESIGN_WORKSPACE_API,
  reviewPath: '/d',
  label: 'Design',
  defaultBaseUrl: DESIGN_SHARE_BASE_URL,
  version: DESIGN_WORKSPACE_VERSION,
  maxBytes: DESIGN_WORKSPACE_MAX_BYTES,
  maxEventBytes: DESIGN_WORKSPACE_MAX_EVENT_BYTES,
  schemas: {
    create: DESIGN_WORKSPACE_CREATE_SCHEMA,
    event: DESIGN_WORKSPACE_EVENT_SCHEMA,
    revision: DESIGN_WORKSPACE_REVISION_SCHEMA,
    workspace: DESIGN_WORKSPACE_SCHEMA,
  },
  assertContract: assertWorkspaceContract,
  assertBundle: assertDesignReviewBundle,
  assertFeedback(payload) {
    if (['category', 'disposition'].includes(payload.kind)) assertDesignReviewMetadata(payload);
    if (!['review', 'direction', 'category', 'disposition'].includes(payload.kind))
      throw new TypeError('Unknown design feedback kind.');
    if (typeof payload.author !== 'string' || !payload.author.trim() || payload.author.length > 160)
      throw new TypeError('Enter your name before leaving feedback.');
    return payload;
  },
  digestInput: (bundle) => bundle.envelope,
  bundleDigest: (envelope) =>
    sha256Hex(
      canonicalizeJson({
        schemaVersion: envelope.schemaVersion,
        artifacts: envelope.artifacts,
        viewer: envelope.viewer,
      }),
    ),
  packBundle: packDesignReviewBundle,
  unpackBundle: unpackDesignReviewBundle,
});
export const {
  encodeWorkspaceBytes,
  decodeWorkspaceBytes,
  newWorkspaceToken,
  newWorkspaceId,
  normalizeWorkspaceBase,
  workspaceReviewUrl,
  deriveWorkspaceAuthentication,
  canonicalWorkspacePublicKey,
  createWorkspaceSigner,
  signWorkspaceValue,
  verifyWorkspaceSignature,
  workspaceEnvelopeDigest,
  prepareWorkspace,
  commitWorkspace,
  getWorkspace,
  listWorkspaceRevisions,
  decryptWorkspaceRevision,
  prepareWorkspaceMutation,
  commitWorkspaceMutation,
  publishWorkspace,
  rotateWorkspace,
  manageWorkspace,
  prepareWorkspaceEvent,
  appendWorkspaceEvent,
  readWorkspaceEvents,
} = client;
