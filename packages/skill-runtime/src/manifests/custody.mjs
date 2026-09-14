import { canonicalizeJson, sha256Hex } from '@openplanr/protocol/canonical-json';

import {
  assertUniqueAssetIdentities,
  compareAssetIdentity,
  normalizedAssetHost,
} from './asset-identity.mjs';

/**
 * Collect the unique contributing owners (source, module, host-profile, template)
 * of one generated asset, each with the source-map ranges it owns. Ordering is
 * stable so custody is a pure function of the compilation.
 */
export function buildAssetCustody(asset) {
  const byKey = new Map();
  for (const range of asset.sourceMap) {
    const key = canonicalizeJson([
      range.owner.ownerKind,
      range.owner.pointer,
      range.owner.version,
    ]);
    if (!byKey.has(key)) {
      byKey.set(key, {
        ownerKind: range.owner.ownerKind,
        pointer: range.owner.pointer,
        version: range.owner.version,
        digest: range.owner.digest,
        ranges: [],
      });
    }
    byKey.get(key).ranges.push({ startByte: range.startByte, endByte: range.endByte });
  }
  const contributors = [...byKey.values()].sort((left, right) => (
    left.ownerKind.localeCompare(right.ownerKind) || left.pointer.localeCompare(right.pointer) || left.version.localeCompare(right.version)
  ));
  return {
    path: asset.path,
    host: normalizedAssetHost(asset),
    digest: asset.digest,
    byteLength: asset.byteLength,
    contributors,
  };
}

/**
 * Build a deterministic custody manifest binding every generated asset to its
 * contributing sources, modules, and host profiles. No timestamps or randomness.
 */
export function buildCustodyManifest({ assets, sourceFormat, assetSetId }) {
  const rows = assets.map((asset) => buildAssetCustody(asset));
  assertUniqueAssetIdentities(rows);
  rows.sort(compareAssetIdentity);
  const custodyDigest = `sha256:${sha256Hex(canonicalizeJson(
    rows.map(({ path, host, digest }) => [path, host, digest]),
  ))}`;
  return {
    kind: 'openplanr-skill-generated-custody',
    schemaVersion: '1.0.0',
    protocolVersion: '1.6.0',
    sourceFormat,
    assetSetId,
    assets: rows,
    custodyDigest,
  };
}
