/**
 * FR7 — Shareable decision briefs.
 *
 * Render an operating brief and (optionally) the owner's decision into ONE
 * self-contained HTML artifact carried by the SPEC-001 artifact-envelope
 * pipeline, so a non-technical decision owner can read the question, the
 * evidence, the options, and what the decision blocks without a terminal.
 *
 * The rendered document is fully offline: it references no remote CSS, JS, or
 * font. That posture is enforced in this module (not just in the test) — a
 * generated fragment containing any `http://`/`https://` reference fails closed
 * before an envelope is ever produced. Rendering is deterministic: the same
 * brief/decision produce a byte-identical envelope. Nothing here publishes or
 * shares; briefs render locally and are shared only on explicit request.
 *
 * Pure, stdlib-only. Reuses the artifact-envelope validator and the design
 * HTML escaper; no new dependencies.
 */

import { createArtifactEnvelope, digestArtifact } from '../artifact/envelope.mjs';
import { escapeHtml } from '../design/escape.mjs';
import { PipelineError } from '../pipeline/errors.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';

const BRIEF_ERROR = 'E_OPERATE_DECISION_BRIEF_INVALID';
const OFFLINE_ERROR = 'E_OPERATE_DECISION_BRIEF_NOT_OFFLINE';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DEFAULT_ARTIFACT_ID = 'operating-decision-brief';
// A document-presentation viewport; the shell scrolls the body, so the constant
// only needs to stay within the envelope's 1..16384 integer bounds. Fixed so
// two renders of the same content are byte-identical.
const DEFAULT_VIEWPORT = Object.freeze({ width: 880, height: 1400 });

function fail(message, details) {
  throw new PipelineError(BRIEF_ERROR, message, '', details);
}

/**
 * Reject any generated fragment that reaches for a remote resource. The check
 * is intentionally blunt: a decision owner must be able to open the file with
 * no network at all, so ANY `http://`/`https://` occurrence is disqualifying.
 */
function assertOffline(html) {
  if (/https?:\/\//i.test(html)) {
    throw new PipelineError(
      OFFLINE_ERROR,
      'A decision brief must render fully offline; the generated HTML contains an external http(s) reference.',
    );
  }
  return html;
}

function sanitizeArtifactId(candidate) {
  if (candidate === undefined || candidate === null) return DEFAULT_ARTIFACT_ID;
  const value = String(candidate);
  return ID_RE.test(value) && value.length <= 128 ? value : DEFAULT_ARTIFACT_ID;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// ── Minimal, deterministic Markdown → HTML fragment renderer ─────────────────
// Supports: ATX headings (#..###), unordered (`- `/`* `) and ordered (`1. `)
// lists, blank-line-separated paragraphs, and inline `**bold**`, `*italic*`,
// and `` `code` ``. Text is HTML-escaped BEFORE inline markup is applied, so
// user content can never introduce live markup. No links are emitted, keeping
// the fragment free of any URL.
function renderInline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  return out;
}

function renderMarkdown(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null; // { tag: 'ul' | 'ol', items: [] }

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((item) => `<li>${renderInline(item)}</li>`).join('');
      blocks.push(`<${list.tag}>${items}</${list.tag}>`);
      list = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      continue;
    }
    const unordered = /^\s*[-*]\s+(.*)$/.exec(line);
    if (unordered) {
      flushParagraph();
      if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
      list.items.push(unordered[1].trim());
      continue;
    }
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ordered) {
      flushParagraph();
      if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
      list.items.push(ordered[1].trim());
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks.join('\n');
}

// ── Brief/decision → canonical Markdown document ─────────────────────────────
function normalizeEvidence(evidence) {
  if (Array.isArray(evidence)) {
    return evidence
      .filter(isNonEmptyString)
      .map((item) => `- ${String(item).trim()}`)
      .join('\n');
  }
  return isNonEmptyString(evidence) ? String(evidence).trim() : '';
}

function normalizeOptions(options) {
  if (Array.isArray(options)) {
    return options
      .map((option) => {
        if (isNonEmptyString(option)) return `- ${String(option).trim()}`;
        if (option && typeof option === 'object' && isNonEmptyString(option.label)) {
          const label = String(option.label).trim();
          return isNonEmptyString(option.detail)
            ? `- **${label}** — ${String(option.detail).trim()}`
            : `- **${label}**`;
        }
        return '';
      })
      .filter((line) => line !== '')
      .join('\n');
  }
  return isNonEmptyString(options) ? String(options).trim() : '';
}

function section(title, body) {
  return isNonEmptyString(body) ? `## ${title}\n\n${body.trim()}` : '';
}

function decisionBody(decision) {
  if (!decision || typeof decision !== 'object') return '';
  const facts = [];
  if (isNonEmptyString(decision.status)) facts.push(`- Status: ${decision.status.trim()}`);
  if (isNonEmptyString(decision.owner)) facts.push(`- Owner: ${decision.owner.trim()}`);
  if (isNonEmptyString(decision.selectedOption)) facts.push(`- Selected: ${decision.selectedOption.trim()}`);
  if (isNonEmptyString(decision.reversibility)) facts.push(`- Reversibility: ${decision.reversibility.trim()}`);
  if (isNonEmptyString(decision.deadline)) facts.push(`- Deadline: ${decision.deadline.trim()}`);
  const narrative = [decision.recommendation, decision.rationale, decision.note, decision.body, decision.markdown]
    .filter(isNonEmptyString)
    .map((value) => String(value).trim())
    .join('\n\n');
  const parts = [facts.join('\n'), narrative].filter((part) => part !== '');
  return parts.join('\n\n');
}

function buildMarkdown(brief, decision) {
  const parts = [`# ${brief.title.trim()}`];
  const summary = section('Summary', isNonEmptyString(brief.summary) ? String(brief.summary) : '');
  const question = section('Question', isNonEmptyString(brief.question) ? String(brief.question) : '');
  const evidence = section('Evidence', normalizeEvidence(brief.evidence));
  const options = section('Options', normalizeOptions(brief.options));
  const blocks = section(
    'What this decision blocks',
    isNonEmptyString(brief.blocks) ? String(brief.blocks)
      : (isNonEmptyString(brief.unblocks) ? String(brief.unblocks) : ''),
  );
  const owner = section('Owner decision', decisionBody(decision));
  for (const piece of [summary, question, evidence, options, blocks, owner]) {
    if (piece !== '') parts.push(piece);
  }
  return parts.join('\n\n');
}

const OFFLINE_STYLE = [
  ':root{color-scheme:light}',
  '*{box-sizing:border-box}',
  'body{margin:0;padding:2rem 1.25rem;font-family:system-ui,sans-serif;',
  'line-height:1.55;color:#1b1f24;background:#ffffff}',
  'main.operating-decision-brief{max-width:44rem;margin:0 auto}',
  'h1{font-size:1.6rem;margin:0 0 1rem;border-bottom:1px solid #e2e6ea;padding-bottom:.5rem}',
  'h2{font-size:1.15rem;margin:1.75rem 0 .5rem}',
  'h3{font-size:1rem;margin:1.25rem 0 .4rem}',
  'p{margin:.4rem 0}',
  'ul,ol{margin:.4rem 0 .4rem 1.25rem;padding:0}',
  'li{margin:.25rem 0}',
  'code{font-family:ui-monospace,monospace;background:#f2f4f6;padding:.1rem .3rem;border-radius:.25rem}',
  'strong{font-weight:650}',
].join('');

function renderDocument(title, bodyHtml) {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${OFFLINE_STYLE}</style>`,
    '</head>',
    '<body>',
    `<main class="operating-decision-brief">\n${bodyHtml}\n</main>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * Render an operating brief (and optional owner decision) into a single,
 * self-contained, offline artifact envelope validated against
 * `artifact-envelope@1.1.0`.
 *
 * @param {object} brief   Required. `{ title, question?, evidence?, options?,
 *   blocks?/unblocks?, summary?, id?, viewport?, colorScheme? }`. `evidence`
 *   may be a Markdown string or an array of strings; `options` may be a
 *   Markdown string or an array of `{ label, detail? }` (or strings).
 * @param {object|null} [decision]  Optional owner decision:
 *   `{ status?, owner?, selectedOption?, recommendation?, rationale?, note?,
 *   reversibility?, deadline?, body?, markdown? }`.
 * @returns {object} A validated `artifact-envelope@1.1.0` with one HTML artifact.
 */
export function createOperatingDecisionBriefArtifact(brief, decision = null) {
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) {
    fail('A decision brief requires a brief object.');
  }
  if (!isNonEmptyString(brief.title)) {
    fail('A decision brief requires a non-empty title.');
  }
  if (decision !== null && decision !== undefined
    && (typeof decision !== 'object' || Array.isArray(decision))) {
    fail('When provided, a decision must be an object.');
  }

  const markdown = buildMarkdown(brief, decision);
  const bodyHtml = renderMarkdown(markdown);
  const html = assertOffline(renderDocument(brief.title.trim(), bodyHtml));

  const colorScheme = brief.colorScheme === 'dark' ? 'dark' : 'light';
  const viewport = brief.viewport && typeof brief.viewport === 'object'
    ? { width: brief.viewport.width, height: brief.viewport.height }
    : { ...DEFAULT_VIEWPORT };

  const item = {
    id: sanitizeArtifactId(brief.id),
    kind: 'html',
    title: brief.title.trim(),
    sha256: digestArtifact(html),
    html,
    viewport,
    colorScheme,
  };

  const envelope = createArtifactEnvelope({
    artifacts: [item],
    viewer: { mode: 'single', activeArtifactId: item.id, presentation: 'document' },
  });

  // Validate the finished envelope against artifact-envelope@1.1.0 explicitly,
  // and re-assert the offline posture on the bundled artifact HTML.
  assertProtocolArtifact('artifact-envelope', envelope, { protocolVersion: '1.1.0' });
  assertOffline(envelope.artifacts[0].html);
  return envelope;
}
