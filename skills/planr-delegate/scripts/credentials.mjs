// Credential classification for delegated context. Findings never carry the matched value.
import { createHash } from 'node:crypto';

/** Recognizable credential formats; rejected everywhere, including tests and placeholders. */
export const CREDENTIAL_FORMAT =
  /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}/iu;

const CREDENTIAL_NAME =
  '(?:[A-Za-z_][A-Za-z0-9_-]*?)?(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|CLIENT[_-]?SECRET|PRIVATE[_-]?KEY|PASSWORD|TOKEN|SECRET(?:[_-]?KEY)?)';
const QUOTED_ASSIGNMENT = new RegExp(
  `(?:^|[^A-Za-z0-9_])(${CREDENTIAL_NAME})["']?\\s*[:=]\\s*(["'\`])((?:(?!\\2|\\$\\{)[^\\r\\n\\\\]|\\\\.){16,})\\2`,
  'giu',
);
const UNQUOTED_ASSIGNMENT = new RegExp(
  `^[ \\t]*(?:export[ \\t]+)?(${CREDENTIAL_NAME})[ \\t]*[:=][ \\t]*(?!process\\.env(?:\\.|\\[)|import\\.meta\\.env(?:\\.|\\[)|Deno\\.env\\.|os\\.environ|env\\.)([^\\s"'\`#()\\[\\]{}$]{16,})[ \\t]*(?:#[^\\r\\n]*)?\\r?$`,
  'gimu',
);
const PLACEHOLDER =
  /^(?:example(?:[-_].*)?|placeholder(?:[-_].*)?|your[-_].*|(?:change|replace)[-_]me(?:[-_].*)?|(?:dummy|fake|mock|test|never[-_]return)[-_](?:api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret|password|token|secret(?:[-_]?key)?))$/iu;
// A lowercase marker followed only by words and short numbers describes a test value.
const DESCRIBED_PLACEHOLDER =
  /^(?:dummy|fake|mock|test|fixture|synthetic|never[-_]return)(?:[-_. ](?:[a-z]+|\d{1,4}))+[-_.]?$/u;
const IDENTIFIER_WORD = /[A-Z]{2,}(?![a-z])\d{0,2}|[A-Z]?[a-z]+\d{0,2}|[A-Z]\d{0,2}|\d{1,2}/gu;

const CODE_EXTENSIONS = new Set(
  'c cc cjs cpp cs cts dart go groovy h hpp java js jsx kt kts lua m mjs mm mts php py rb rs scala svelte swift ts tsx vue'.split(
    ' ',
  ),
);
const CONFIG_EXTENSIONS = new Set(
  'bash cfg conf env fish hcl ini json json5 jsonc properties ps1 sh tf toml xml yaml yml zsh'.split(
    ' ',
  ),
);
const CONFIG_NAMES = new Set(['dockerfile', 'makefile', 'procfile']);

/** The syntax that decides whether an unquoted value is a literal: code, config, or free text. */
export function credentialSyntax(path) {
  if (typeof path !== 'string' || !path) return 'text';
  const name = path.split('/').at(-1).toLowerCase();
  if (CONFIG_NAMES.has(name) || name.startsWith('.env')) return 'config';
  const extension = name.includes('.') ? name.split('.').at(-1) : '';
  if (CODE_EXTENSIONS.has(extension)) return 'code';
  if (CONFIG_EXTENSIONS.has(extension)) return 'config';
  return 'text';
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function position(content, index) {
  const before = content.slice(0, index);
  return { line: before.split('\n').length, column: index - before.lastIndexOf('\n') };
}

// Reads like a code identifier: whole words, digits only at word ends, at most one one-letter word.
function codeIdentifier(value) {
  if (!/^[A-Za-z_$][\w$]*$/u.test(value) || value.length > 64) return false;
  let singleLetters = 0;
  for (const part of value.split(/[_$]+/u).filter(Boolean)) {
    const words = part.match(IDENTIFIER_WORD) ?? [];
    if (words.join('') !== part) return false;
    singleLetters += words.filter((word) => word.replace(/\d+$/u, '').length <= 1).length;
  }
  return singleLetters <= 1;
}

function memberPath(value) {
  const segments = value.replace(/!$/u, '').split(/[!?]?\./u);
  return segments.length > 1 && segments.every(codeIdentifier);
}

// An unquoted value is a literal unless its syntax makes it a reference, type or expression.
function unquotedLiteral(raw, syntax) {
  if (syntax === 'config') return true;
  const terminated = /[;,]$/u.test(raw);
  const value = terminated ? raw.slice(0, -1) : raw;
  if (memberPath(value)) return false;
  if (codeIdentifier(value) && (syntax === 'code' || terminated)) return false;
  return true;
}

function placeholder(value) {
  return PLACEHOLDER.test(value) || DESCRIBED_PLACEHOLDER.test(value);
}

/**
 * Classifies credential material in `bytes` from `origin` ({ path?, label?, syntax? }).
 * Findings report location, rule, classification, confidence and explanation, never values.
 */
export function classifyCredentials(bytes, origin = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8');
  const content = buffer.toString('utf8');
  const label = origin.label ?? origin.path ?? 'text';
  const syntax = origin.syntax ?? credentialSyntax(origin.path);
  const findings = [];
  const add = (rule, index, key, details) => {
    const { line, column } = position(content, index);
    findings.push({
      id: `cred_${sha256(`${label}\n${rule}\n${line}:${column}\n${key ?? ''}`).slice(0, 16)}`,
      rule,
      ...details,
      location: { ...(origin.path ? { path: origin.path } : {}), line, column },
      ...(key ? { key } : {}),
    });
  };
  for (const match of content.matchAll(new RegExp(CREDENTIAL_FORMAT.source, 'giu')))
    add('credential-format', match.index, null, {
      classification: 'credential',
      confidence: 'high',
      resolvable: false,
      explanation:
        'A recognizable credential or private key format cannot be delegated; remove it from the source.',
    });
  const literal = (key, index) =>
    add('credential-assignment', index, key, {
      classification: 'possible-credential',
      confidence: 'medium',
      resolvable: true,
      explanation: `${key} is assigned a literal that is neither a reference nor a recognized placeholder; resolve this finding only if the value is not a credential.`,
    });
  for (const match of content.matchAll(QUOTED_ASSIGNMENT))
    if (!placeholder(match[3])) literal(match[1], match.index + match[0].indexOf(match[1]));
  for (const match of content.matchAll(UNQUOTED_ASSIGNMENT))
    if (unquotedLiteral(match[2], syntax) && !placeholder(match[2].replace(/[;,]$/u, '')))
      literal(match[1], match.index + match[0].indexOf(match[1]));
  return { contentDigest: `sha256:${sha256(buffer)}`, syntax, findings };
}

/**
 * Splits findings into those an explicit resolution covers and the rest. A resolution names one
 * resolvable finding and the exact content digest it was recorded for; changed bytes invalidate it.
 */
export function resolveFindings(classification, resolutions = []) {
  const accepted = new Set(
    resolutions
      .filter((resolution) => resolution?.contentDigest === classification.contentDigest)
      .map((resolution) => resolution.id),
  );
  const applied = [];
  const remaining = [];
  for (const finding of classification.findings)
    (finding.resolvable && accepted.has(finding.id) ? applied : remaining).push(finding);
  return { applied, remaining };
}
