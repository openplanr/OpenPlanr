// Keep verified source and integrity pins unchanged; apply fixes before verification.
export default {
  '*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,json,jsonc,css}':
    'biome check --no-errors-on-unmatched --diagnostic-level=error',
  '*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,css}': () => 'node scripts/check-source-comments.mjs',
  '*.{md,yml}': () => 'node scripts/docs/check-public-docs.mjs',
};
