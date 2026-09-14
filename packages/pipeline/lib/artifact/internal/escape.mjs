/**
 * HTML / JSON escaping helpers for design-artifact generation.
 *
 * The design generator interpolates spec-derived text (screen names, copy,
 * field labels) into generated HTML and into JSON embedded in inline
 * `<script>` blocks (DesignCanvas artboard data, the `.design-canvas.state.json`
 * sidecar). That text is user-controlled, so every interpolation MUST pass
 * through one of these helpers. Otherwise a screen titled
 * `</script><img src=x onerror=alert(1)>` becomes stored XSS the moment the
 * artifact is opened in a browser.
 *
 * Rule of thumb:
 *   - text or attribute value inside HTML   → escapeHtml()
 *   - object embedded in a <script> block    → embedJson()
 *
 * Pure, stdlib-only, no dependencies. (SPEC-015 finding S1.)
 */

/** @type {Readonly<Record<string, string>>} */
const HTML_ENTITIES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

// U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR built from code points
// (pure-ASCII source) so the file never contains the invisible literals.
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

/**
 * Characters that make embedded JSON unsafe inside HTML, mapped to `\uXXXX`
 * escapes. `<`/`>`/`&` could start a `</script>` or entity; the line/paragraph
 * separators are valid JSON but break JS string literals.
 * @type {Readonly<Record<string, string>>}
 */
const JSON_HTML_ESCAPES = Object.freeze({
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  [LINE_SEP]: '\\u2028',
  [PARA_SEP]: '\\u2029',
});

const JSON_HTML_RE = new RegExp(`[<>&${LINE_SEP}${PARA_SEP}]`, 'g');

/**
 * Escape a value for safe interpolation into HTML text or a single/double
 * quoted attribute. `null`/`undefined` become the empty string; other
 * non-strings are coerced via String().
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]);
}

/**
 * Serialize a value for safe embedding inside an inline `<script>` block. The
 * result is still valid JSON and `JSON.parse`s to an identical value, but can
 * never break out of the script element.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function embedJson(value) {
  return JSON.stringify(value ?? null).replace(JSON_HTML_RE, (ch) => JSON_HTML_ESCAPES[ch]);
}

/**
 * True when a string still contains a raw character that can break OUT of an
 * HTML text or attribute context — angle brackets (form a tag) or quotes
 * (close an attribute). `&` is intentionally excluded: correctly-escaped output
 * contains `&` inside entities (`&lt;`), so flagging it would defeat the check.
 * Used by the injection regression test to assert "no live markup slipped
 * through".
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function hasUnsafeHtml(value) {
  return /[<>"']/.test(String(value ?? ''));
}
