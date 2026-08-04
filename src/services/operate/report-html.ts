import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readOperatingReport } from './reports.js';
import { resolveOperatingPaths } from './workspace.js';

/**
 * Render a finished operating cycle report into a single, self-contained,
 * shareable HTML file: inline CSS only, real `<table>` markup for Markdown
 * tables, headings/lists/code/bold, dark-mode friendly. The output opens cleanly
 * in `planr artifact open`, whose validator blocks remote hrefs in attributes —
 * so this renderer emits NO `<a href>`/`<img src>`/external `<link>`/`<script>`.
 * A URL that appears in the source prose is kept as plain, escaped text (allowed);
 * a Markdown link `[text](url)` is flattened to `text (url)` text, never an anchor.
 *
 * The report Markdown is deterministic runtime/board content, not attacker input,
 * but every interpolation is HTML-escaped regardless so a stray `<`, `&`, or `"`
 * can neither break the document nor smuggle in an attribute.
 */

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ENTITIES[character] ?? character);
}

const CODE_PLACEHOLDER_PREFIX = '\u0000CODE';
const CODE_PLACEHOLDER_SUFFIX = '\u0000';

/**
 * Render inline Markdown (bold, inline code, and links-as-text) to safe HTML.
 * Inline-code spans are extracted first so their contents are never re-parsed as
 * bold, then everything is escaped, then bold is applied to the escaped text, then
 * the code spans are restored as escaped `<code>`. Italics are intentionally NOT
 * supported: identifiers in this report (evidence refs, session ids) are full of
 * `_`, so treating `_` as emphasis would mangle them.
 */
function renderInline(raw: string): string {
  const codeSpans: string[] = [];
  let text = raw.replace(/`([^`]+)`/g, (_match, code: string) => {
    codeSpans.push(code);
    return `${CODE_PLACEHOLDER_PREFIX}${codeSpans.length - 1}${CODE_PLACEHOLDER_SUFFIX}`;
  });
  // Flatten Markdown links/images to plain text before escaping — never an anchor.
  // The visible text is kept; the URL is kept as trailing text (a URL in prose is
  // allowed by the artifact validator, an `href`/`src` attribute is not).
  text = text.replace(
    /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_match, label: string, url: string) => (label ? `${label} (${url})` : url),
  );
  text = escapeHtml(text);
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(
    new RegExp(`${CODE_PLACEHOLDER_PREFIX}(\\d+)${CODE_PLACEHOLDER_SUFFIX}`, 'g'),
    (_match, index: string) => `<code>${escapeHtml(codeSpans[Number(index)] ?? '')}</code>`,
  );
  return text;
}

function isTableSeparator(line: string): boolean {
  // A GitHub-style separator row: pipe-delimited cells of dashes with optional
  // alignment colons, e.g. `|---|:--:|--:|`.
  return /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-');
}

function parseTableRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * Convert the report Markdown into an HTML body. A small, focused block parser —
 * the repository ships no Markdown renderer, and the pipeline's decision-brief
 * renderer builds structured brief data, not arbitrary report Markdown with
 * tables. It handles exactly the constructs the report emits: ATX headings,
 * fenced code, GitHub tables, unordered/ordered lists, and paragraphs.
 */
export function renderOperatingReportBody(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      out.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  let index = 0;
  while (index < lines.length) {
    const current = lines[index];
    // Fenced code block.
    if (/^\s*```/.test(current)) {
      flushParagraph();
      index += 1;
      const code: string[] = [];
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1; // consume the closing fence
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    // GitHub table: a pipe row immediately followed by a separator row.
    if (/^\s*\|/.test(current) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      flushParagraph();
      const header = parseTableRow(current);
      index += 2; // header + separator
      const bodyRows: string[][] = [];
      while (index < lines.length && /^\s*\|/.test(lines[index])) {
        bodyRows.push(parseTableRow(lines[index]));
        index += 1;
      }
      const thead = `<thead><tr>${header
        .map((cell) => `<th>${renderInline(cell)}</th>`)
        .join('')}</tr></thead>`;
      const tbody = `<tbody>${bodyRows
        .map(
          (cells) => `<tr>${cells.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`,
        )
        .join('')}</tbody>`;
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }
    // ATX heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(current);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }
    // Unordered list.
    if (/^\s*[-*+]\s+/.test(current)) {
      flushParagraph();
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ''));
        index += 1;
      }
      out.push(`<ul>${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`);
      continue;
    }
    // Ordered list.
    if (/^\s*\d+\.\s+/.test(current)) {
      flushParagraph();
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ''));
        index += 1;
      }
      out.push(`<ol>${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ol>`);
      continue;
    }
    // Blank line closes the current paragraph.
    if (current.trim() === '') {
      flushParagraph();
      index += 1;
      continue;
    }
    paragraph.push(current.trim());
    index += 1;
  }
  flushParagraph();
  return out.join('\n');
}

// Dark-first, print-friendly styling with a light `prefers-color-scheme`
// override. All fonts are system fonts and every rule is inline: the document
// references no remote stylesheet, font, or image, so it stays fully offline.
const REPORT_STYLE = `
:root { color-scheme: dark light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2.5rem 1.25rem;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.6;
  background: #0d1117;
  color: #c9d1d9;
}
main { max-width: 52rem; margin: 0 auto; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.8rem 0 0.8rem; color: #f0f6fc; }
h1 { font-size: 1.9rem; border-bottom: 1px solid #30363d; padding-bottom: 0.4rem; }
h2 { font-size: 1.45rem; border-bottom: 1px solid #21262d; padding-bottom: 0.3rem; }
h3 { font-size: 1.2rem; }
p { margin: 0.7rem 0; }
ul, ol { margin: 0.7rem 0; padding-left: 1.5rem; }
li { margin: 0.25rem 0; }
strong { color: #f0f6fc; }
a { color: inherit; }
code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.9em;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 4px;
  padding: 0.1rem 0.3rem;
}
pre {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 0.9rem 1rem;
  overflow-x: auto;
}
pre code { background: none; border: none; padding: 0; }
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1rem 0;
  font-size: 0.95em;
}
th, td { border: 1px solid #30363d; padding: 0.5rem 0.7rem; text-align: left; vertical-align: top; }
th { background: #161b22; color: #f0f6fc; }
tr:nth-child(even) td { background: rgba(255, 255, 255, 0.02); }
@media (prefers-color-scheme: light) {
  body { background: #ffffff; color: #1f2328; }
  h1, h2, h3, h4, h5, h6, strong, th { color: #1f2328; }
  h1 { border-bottom-color: #d0d7de; }
  h2 { border-bottom-color: #d8dee4; }
  code, pre { background: #f6f8fa; border-color: #d0d7de; }
  th { background: #f6f8fa; }
  th, td { border-color: #d0d7de; }
  tr:nth-child(even) td { background: #f6f8fa; }
}
`.trim();

/** Wrap a rendered body in the self-contained HTML document shell. */
export function renderOperatingReportHtml(input: { markdown: string; title: string }): string {
  const body = renderOperatingReportBody(input.markdown);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
${REPORT_STYLE}
</style>
</head>
<body>
<main class="operating-report">
${body}
</main>
</body>
</html>
`;
}

/** Resolve the output path for a rendered report. */
function resolveReportHtmlPath(input: {
  projectRoot: string;
  cycleId: string;
  out?: string;
  localRoot?: string;
}): string {
  if (typeof input.out === 'string' && input.out.trim()) {
    return path.isAbsolute(input.out) ? input.out : path.resolve(input.projectRoot, input.out);
  }
  // Default alongside the committed cycle directory when it exists (the natural
  // home next to `report.md`), otherwise a temp file.
  const paths = resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot });
  const cycleDir = path.join(paths.cycles, input.cycleId);
  return existsSync(cycleDir)
    ? path.join(cycleDir, 'report.html')
    : path.join(tmpdir(), `operate-report-${input.cycleId}.html`);
}

export interface WrittenOperatingReportHtml {
  path: string;
  cycleId: string;
  title: string;
  suggestedNext: string;
}

/**
 * Read a cycle report, render it to self-contained HTML, and write it to the
 * resolved destination. Returns the written path plus the exact suggested
 * `planr artifact open` command that opens it.
 */
export async function writeOperatingReportHtml(input: {
  projectRoot: string;
  cycleId?: string;
  lens?: string;
  out?: string;
  localRoot?: string;
}): Promise<WrittenOperatingReportHtml> {
  const report = await readOperatingReport({
    projectRoot: input.projectRoot,
    ...(input.cycleId ? { cycleId: input.cycleId } : {}),
    ...(input.lens ? { lens: input.lens } : {}),
    ...(input.localRoot ? { localRoot: input.localRoot } : {}),
  });
  const title = `Operating report ${report.cycleId}`;
  const html = renderOperatingReportHtml({ markdown: report.markdown, title });
  const target = resolveReportHtmlPath({
    projectRoot: input.projectRoot,
    cycleId: report.cycleId,
    ...(input.out ? { out: input.out } : {}),
    ...(input.localRoot ? { localRoot: input.localRoot } : {}),
  });
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, html, 'utf8');
  await rename(temporary, target);
  return {
    path: target,
    cycleId: report.cycleId,
    title,
    suggestedNext: `planr artifact open ${target} --title ${JSON.stringify(title)}`,
  };
}
