import type { Digest, SourceMapOwner, SourceMapRange } from '../compiler/index.mjs';

export type { Digest } from '../compiler/index.mjs';

export interface GeneratedAsset {
  readonly path: string;
  readonly host?: string | null;
  readonly byteLength: number;
  readonly digest: Digest;
  readonly sourceMap: ReadonlyArray<SourceMapRange>;
}

export interface AssetCustody {
  readonly path: string;
  readonly host: string | null;
  readonly digest: Digest;
  readonly byteLength: number;
  readonly contributors: ReadonlyArray<SourceMapOwner & {
    readonly ranges: ReadonlyArray<{
      readonly startByte: number;
      readonly endByte: number;
    }>;
  }>;
}

export interface CustodyManifest {
  kind: 'openplanr-skill-generated-custody';
  schemaVersion: string;
  protocolVersion: '1.6.0';
  sourceFormat: string;
  assetSetId: string;
  readonly assets: ReadonlyArray<AssetCustody>;
  custodyDigest: Digest;
}

export interface GeneratedAssetManifest {
  kind: 'generated-asset-manifest';
  schemaVersion: string;
  protocolVersion: '1.6.0';
  documentVersion: string;
  digestAlgorithm: 'sha256';
  canonicalization: 'rfc8785';
  assetSetId: string;
  sourceFormat: string;
  readonly assets: ReadonlyArray<GeneratedAsset>;
  documentDigest: Digest;
}

export declare function buildAssetCustody(asset: GeneratedAsset): AssetCustody;
export declare function buildCustodyManifest(options: {
  assets: ReadonlyArray<GeneratedAsset>;
  sourceFormat: string;
  assetSetId: string;
}): CustodyManifest;
export declare function deriveAssetSetId(assets: ReadonlyArray<{
  path: string;
  host?: string | null;
  digest: Digest;
}>): string;
export declare function buildGeneratedAssetManifest(options: {
  assets: ReadonlyArray<GeneratedAsset>;
  sourceFormat: string;
  documentVersion?: string;
}): GeneratedAssetManifest;
