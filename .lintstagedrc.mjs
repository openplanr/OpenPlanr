// The fast gates CI runs, applied at commit time; tests stay in CI.
export default {
  '*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,json,jsonc,css}':
    'biome check --write --no-errors-on-unmatched --diagnostic-level=error',
  '*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,css}': () => 'node scripts/check-source-comments.mjs',
  '*.{md,yml}': () => 'node scripts/docs/check-public-docs.mjs',
};
