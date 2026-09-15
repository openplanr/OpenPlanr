/**
 * claude-svg provider — ALWAYS available, no key (hard rule 9).
 *
 * The calling Claude session authors precise SVG/HTML sheets itself; for logos
 * and UI this often BEATS diffusion: exact hex, real fonts, production-ready
 * vector output. The engine's job is the CONTRACT + VALIDATION, not generation:
 *
 *   sheetContract(target)        → dimensions, required sections, dark+light tiles
 *   contractInstructions(c)      → the text the agent follows when authoring
 *   validateSheet(svgText, c)    → structural pass/issues (the provider's
 *                                  quality gate — no vision call needed)
 *
 * Iteration = the agent edits the SVG per feedback; the session records lineage
 * (lastResponseId stays null — the file IS the chain).
 */

export const CONTRACTS = {
  logo: {
    target: 'logo',
    width: 1200,
    height: 800,
    sections: ['mark', 'wordmark', 'lockup'],
    tiles: ['light', 'dark'],
    notes:
      'Primary mark at 3 sizes (64/32/16px optical test row), horizontal lockup, ' +
      'mono variant. Geometry on a grid; currentColor where the mark must inherit.',
  },
  'brand-sheet': {
    target: 'brand-sheet',
    width: 1400,
    height: 2000,
    sections: ['palette', 'type', 'mark', 'components'],
    tiles: ['light', 'dark'],
    notes: 'Exact hex swatches with names, real type specimens, spacing scale, sample components.',
  },
  screen: {
    target: 'screen',
    width: 1440,
    height: 1024,
    sections: ['shell', 'content'],
    tiles: ['light'],
    notes: 'A real desktop screen on the 4-point grid; AA contrast; tokens not raw hex where a system exists.',
  },
  'og-image': {
    target: 'og-image',
    width: 1200,
    height: 630,
    sections: ['headline', 'mark'],
    tiles: ['light'],
    notes: 'Legible at 400px wide; one focal point; brand colors.',
  },
};

export function sheetContract(target) {
  const c = CONTRACTS[target] ?? CONTRACTS.logo;
  return { ...c, sections: [...c.sections], tiles: [...c.tiles] };
}

/** The authoring brief fragment the agent embeds in its own generation pass. */
export function contractInstructions(contract) {
  return [
    `Author ONE self-contained SVG, exactly ${contract.width}×${contract.height} ` +
      `(width/height + matching viewBox="0 0 ${contract.width} ${contract.height}").`,
    `Wrap each required section in <g id="section-<name>"> — required: ${contract.sections
      .map((s) => `section-${s}`)
      .join(', ')}.`,
    `Include a tile per theme: ${contract.tiles.map((t) => `<g id="tile-${t}">`).join(', ')} ` +
      '(dark tile = the same content proven on a dark background).',
    'Self-contained: no external href/CDN/scripts; system or declared fonts only; real <text> elements (not outlined paths) so type stays editable.',
    `Craft: ${contract.notes}`,
  ].join('\n');
}

/**
 * Structural quality gate — pass/issues without any network.
 * @param {string} svgText
 */
export function validateSheet(svgText, contract) {
  const issues = [];
  const text = String(svgText);

  if (!/<svg[\s>]/.test(text)) issues.push('not an <svg> document');

  const width = text.match(/<svg[^>]*\bwidth="(\d+)/)?.[1];
  const height = text.match(/<svg[^>]*\bheight="(\d+)/)?.[1];
  if (width !== String(contract.width) || height !== String(contract.height)) {
    issues.push(`dimensions must be ${contract.width}×${contract.height} (got ${width ?? '?'}×${height ?? '?'})`);
  }
  const viewBox = text.match(/<svg[^>]*\bviewBox="([^"]+)"/)?.[1];
  if (viewBox !== `0 0 ${contract.width} ${contract.height}`) {
    issues.push(`viewBox must be "0 0 ${contract.width} ${contract.height}" (got "${viewBox ?? 'missing'}")`);
  }

  for (const s of contract.sections) {
    if (!new RegExp(`id="section-${s}"`).test(text)) issues.push(`missing required <g id="section-${s}">`);
  }
  for (const t of contract.tiles) {
    if (!new RegExp(`id="tile-${t}"`).test(text)) issues.push(`missing required <g id="tile-${t}">`);
  }

  if (/<script[\s>]/i.test(text)) issues.push('contains <script> — sheets must be inert');
  if (/\bhref="https?:/i.test(text) || /url\(https?:/i.test(text)) {
    issues.push('references an external URL — must be self-contained/offline');
  }
  if (!/<text[\s>]/.test(text)) issues.push('no <text> elements — type must stay real/editable, not outlined');

  return { pass: issues.length === 0, issues };
}

/** Provider-interface alias so the registry exposes one shape (hard rule 10). */
export function checkQuality(svgText, _brief, { contract }) {
  return validateSheet(svgText, contract);
}
