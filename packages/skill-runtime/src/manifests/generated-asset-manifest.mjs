import {
  canonicalizeJson,
  sha256Hex,
  withDocumentDigest,
} from '@openplanr/protocol/canonical-json';

import { SkillRuntimeError } from '../errors.mjs';
import {
  assertUniqueAssetIdentities,
  compareAssetIdentity,
  normalizedAssetHost,
} from './asset-identity.mjs';

const MEDIA_TYPES = Object.freeze({
  '.md': 'text/markdown',
  '.mdc': 'text/markdown',
  '.tmpl': 'text/markdown',
  '.json': 'application/json',
});

function mediaTypeFor(path) {
  const dot = path.lastIndexOf('.');
  const extension = dot === -1 ? '' : path.slice(dot);
  const mediaType = MEDIA_TYPES[extension];
  if (!mediaType)
    throw new SkillRuntimeError(
      'E_ASSET_MEDIA_TYPE_UNKNOWN',
      `No media type is registered for ${path}.`,
      { path },
    );
  return mediaType;
}

/** Deterministic asset-set id derived from host-qualified asset identities. */
export function deriveAssetSetId(assets) {
  const normalized = assets.map((asset) => ({
    path: asset.path,
    host: normalizedAssetHost(asset),
    digest: asset.digest,
  }));
  assertUniqueAssetIdentities(normalized);
  const seed = normalized
    .sort(compareAssetIdentity)
    .map(({ path, host, digest }) => [path, host, digest]);
  return `sas_${sha256Hex(canonicalizeJson(seed)).slice(0, 32)}`;
}

/**
 * Build a Protocol 1.6 generated-asset-manifest. Pure function of its inputs: no
 * wall-clock, no randomness, so re-running the same compilation is byte-stable.
 */
export function buildGeneratedAssetManifest({ assets, sourceFormat, documentVersion = '1.0.0' }) {
  const normalized = assets.map((asset) => ({
    path: asset.path,
    host: normalizedAssetHost(asset),
    mediaType: mediaTypeFor(asset.path),
    byteLength: asset.byteLength,
    digest: asset.digest,
    sourceMap: asset.sourceMap.map((range) => ({
      startByte: range.startByte,
      endByte: range.endByte,
      owner: {
        ownerKind: range.owner.ownerKind,
        pointer: range.owner.pointer,
        version: range.owner.version,
        digest: range.owner.digest,
      },
    })),
  }));
  assertUniqueAssetIdentities(normalized);
  normalized.sort(compareAssetIdentity);
  return withDocumentDigest({
    kind: 'generated-asset-manifest',
    schemaVersion: '1.6.0',
    protocolVersion: '1.6.0',
    documentVersion,
    digestAlgorithm: 'sha256',
    canonicalization: 'rfc8785',
    assetSetId: deriveAssetSetId(normalized),
    sourceFormat,
    assets: normalized,
  });
}
