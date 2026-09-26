import { escapeXml } from './svg.mjs';
import { DIAGRAM_THEME } from './theme.mjs';

const LEGACY_PAGE = Object.freeze({
  colorScheme: 'light',
  wash: '#f8fafc',
  canvas: '#fff',
  rule: '#d9e1e8',
  shadow: 'rgba(15,23,42,.08)',
});

function rootDeclarations(palette, page) {
  return `--bg:${palette.background};--surface:${palette.surface};--ink:${palette.foreground};--muted:${palette.muted};--border:${page.rule};--accent:${palette.accent}`;
}

/** Page chrome around the drawing; themes without a page block keep the original light chrome. */
function pageChrome(theme) {
  if (!theme.page) {
    return { ...LEGACY_PAGE, root: rootDeclarations(theme, LEGACY_PAGE), extra: '' };
  }
  const declarations = (palette) =>
    `${rootDeclarations(palette, palette.page)};--wash:${palette.page.wash};--canvas:${palette.page.canvas};--shadow:${palette.page.shadow}`;
  const extra = [
    theme.page.headlineFontFamily ? `h1{font-family:${theme.page.headlineFontFamily}}` : '',
    theme.dark ? `@media (prefers-color-scheme: dark){:root{${declarations(theme.dark)}}}` : '',
  ]
    .filter(Boolean)
    .map((rule) => `\n    ${rule}`)
    .join('');
  return {
    colorScheme: theme.dark ? 'light dark' : theme.page.colorScheme,
    wash: 'var(--wash)',
    canvas: 'var(--canvas)',
    shadow: 'var(--shadow)',
    root: declarations(theme),
    extra,
  };
}

export function renderDiagramHtml(document, svg, { theme = DIAGRAM_THEME } = {}) {
  const grammar = escapeXml(document.grammar.id);
  const detail = escapeXml(document.layout.detailTier);
  const direction = escapeXml(document.layout.direction);
  const page = pageChrome(theme);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
  <title>${escapeXml(document.title)}</title>
  <style>
    :root{color-scheme:${page.colorScheme};${page.root}}
    *{box-sizing:border-box}html{background:var(--bg);color:var(--ink);font-family:${theme.fontFamily},ui-sans-serif,system-ui,sans-serif}body{margin:0;min-width:320px;background:linear-gradient(180deg,${page.wash} 0,${page.canvas} 320px)}
    .diagram-studio{width:min(1600px,100%);margin:auto;padding:clamp(20px,4vw,56px)}
    header{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:start;margin-bottom:28px}
    .eyebrow{margin:0 0 10px;color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}
    h1{margin:0;font-size:clamp(28px,4vw,52px);line-height:1.04;letter-spacing:-.035em}p{max-width:78ch;margin:16px 0 0;color:var(--muted);font-size:16px;line-height:1.6}
    .meta{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.chip{border:1px solid var(--border);border-radius:999px;background:${page.canvas};padding:8px 12px;color:var(--muted);font-size:12px;font-weight:700}
    main{max-width:100%;overflow:auto;border:1px solid var(--border);border-radius:20px;background:${page.canvas};box-shadow:0 18px 50px ${page.shadow};padding:clamp(16px,3vw,36px)}
    svg{display:block;max-width:none;height:auto;margin:auto}.hint{display:flex;justify-content:space-between;gap:16px;margin-top:14px;color:var(--muted);font-size:12px}
    @media(max-width:720px){.diagram-studio{padding:18px}header{grid-template-columns:1fr}.meta{justify-content:flex-start}main{border-radius:14px;padding:12px}.hint{display:block}.hint span{display:block;margin-top:6px}}${page.extra}
  </style>
</head>
<body>
  <article class="diagram-studio" data-planr-diagram-studio="1">
    <header>
      <div><div class="eyebrow">OpenPlanr diagram</div><h1>${escapeXml(document.title)}</h1><p>${escapeXml(document.summary)}</p></div>
      <div class="meta" aria-label="Diagram settings"><span class="chip">${grammar}</span><span class="chip">${detail}</span><span class="chip">${direction}</span></div>
    </header>
    <main aria-label="${escapeXml(document.accessibility.title)}">${svg.trim()}</main>
    <div class="hint"><span>Scroll horizontally when the diagram is wider than the viewport.</span><span>Open in the review studio to zoom, annotate, and export feedback.</span></div>
  </article>
</body>
</html>
`;
}
