/**
 * Resolve the screen list for a feature from its spec markdown.
 *
 * The design generator needs to know WHICH screens to render — and how many,
 * to pick a default format (see recommendFormat). Screens are sourced, in
 * priority order, from:
 *   1. a frontmatter `ui_files:` / `UIFiles:` list (file stems → screen names)
 *   2. the first body section whose heading mentions "screen" (its bullet items)
 *
 * Best-effort and forgiving: an unparseable or screenless spec yields `[]`, and
 * the orchestrator then treats it as a thin spec and clarifies rather than
 * fabricating screens (SPEC-015 finding F8/E3). Pure, stdlib-only.
 */

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const BULLET_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/;
const SCREEN_HEADING_RE = /\bscreens?\b/i;
const UIFILES_KEY_RE = /^\s*(?:ui_files|uifiles)\s*:/i;

/** Strip markdown decoration and a trailing " — description" from a label. */
function cleanScreenName(raw) {
  return String(raw)
    .replace(/`([^`]*)`/g, '$1')                 // `code`
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')      // [text](url)
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1') // **bold** / _em_
    .split(/\s+[—–:]\s+/)[0]                       // "Login — the sign-in page"
    .replace(/\.(png|jpe?g|webp|svg)$/i, '')      // file stems → names
    .replace(/[.\s]+$/, '')
    .trim();
}

/** Push a cleaned, de-duplicated name onto `out`. */
function addScreen(out, seen, raw) {
  const name = cleanScreenName(raw);
  if (!name) return;
  const key = name.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(name);
}

/** Extract `ui_files:` / `UIFiles:` list items from a frontmatter block. */
function screensFromFrontmatter(frontmatter, out, seen) {
  const lines = frontmatter.split('\n');
  let inList = false;
  for (const line of lines) {
    if (UIFILES_KEY_RE.test(line)) {
      inList = true;
      // inline form: `ui_files: [a.png, b.png]`
      const inline = line.slice(line.indexOf(':') + 1).trim();
      if (inline.startsWith('[')) {
        inline.replace(/^\[|\]$/g, '').split(',').forEach((s) => addScreen(out, seen, s.replace(/['"]/g, '')));
        inList = false;
      }
      continue;
    }
    if (inList) {
      const m = line.match(/^\s*-\s+(.+?)\s*$/);
      if (m) { addScreen(out, seen, m[1].replace(/['"]/g, '')); continue; }
      if (line.trim() && !/^\s/.test(line)) inList = false; // next top-level key
    }
  }
}

/** Extract bullets under the first heading whose text mentions "screen". */
function screensFromBody(body, out, seen) {
  const lines = body.split('\n');
  let collecting = false;
  for (const line of lines) {
    const heading = line.match(HEADING_RE);
    if (heading) {
      collecting = SCREEN_HEADING_RE.test(heading[2]);
      continue;
    }
    if (!collecting) continue;
    const bullet = line.match(BULLET_RE);
    if (bullet) addScreen(out, seen, bullet[1]);
  }
}

/**
 * @param {string} specMarkdown
 * @returns {string[]} ordered, de-duplicated screen names ([] if none found)
 */
export function resolveScreens(specMarkdown) {
  const text = String(specMarkdown ?? '');
  const out = [];
  const seen = new Set();

  const fm = text.match(FRONTMATTER_RE);
  if (fm) screensFromFrontmatter(fm[1], out, seen);

  const body = fm ? text.slice(fm[0].length) : text;
  screensFromBody(body, out, seen);

  return out;
}

/**
 * @param {string} specMarkdown
 * @returns {number}
 */
export function countScreens(specMarkdown) {
  return resolveScreens(specMarkdown).length;
}
