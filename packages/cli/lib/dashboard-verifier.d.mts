export const DASHBOARD_BUNDLE_BUDGETS: Readonly<{
  maxJavaScriptBytes: number;
  maxCssBytes: number;
  maxRuntimeAssetBytes: number;
  maxSourceMapBytes: number;
}>;

export const DASHBOARD_ASSET_ERROR_CODES: Readonly<{
  MISSING: 'E_DASHBOARD_ASSETS_MISSING';
  MANIFEST_INVALID: 'E_DASHBOARD_MANIFEST_INVALID';
  ASSETS_INVALID: 'E_DASHBOARD_ASSETS_INVALID';
}>;

export function verifyDashboardAssets(root?: string): Readonly<{
  ok: boolean;
  code: string | null;
  problem: string | null;
  root: string;
  violations: readonly string[];
  buildId: string | null;
  assetManifestHash?: string | null;
  assets: readonly Readonly<{
    path: string;
    bytes: number;
    sha256: string;
    kind: string;
  }>[];
  sizes: Readonly<Record<string, number>>;
}>;
