import { canonicalizeJson } from '@openplanr/protocol/canonical-json';

import { SkillRuntimeError } from '../errors.mjs';

export function normalizedAssetHost(asset) {
  return asset.host ?? null;
}

export function assetIdentityKey(asset) {
  return canonicalizeJson([asset.path, normalizedAssetHost(asset)]);
}

export function compareAssetIdentity(left, right) {
  return left.path.localeCompare(right.path)
    || String(normalizedAssetHost(left) ?? '').localeCompare(String(normalizedAssetHost(right) ?? ''))
    || left.digest.localeCompare(right.digest);
}

export function assertUniqueAssetIdentities(assets) {
  const seen = new Set();
  for (const asset of assets) {
    const key = assetIdentityKey(asset);
    if (seen.has(key)) {
      throw new SkillRuntimeError(
        'E_ASSET_IDENTITY_COLLISION',
        `Generated asset identity ${asset.path} (${normalizedAssetHost(asset) ?? 'host-neutral'}) is duplicated.`,
        { path: asset.path, host: normalizedAssetHost(asset) },
      );
    }
    seen.add(key);
  }
}
