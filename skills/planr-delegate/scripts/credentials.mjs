// Credential classification for delegated context. Findings never carry the matched value.
import { createHash } from 'node:crypto';

/**
 * Recognizable credential formats; rejected everywhere, including tests and placeholders.
 * Case-sensitive: each prefix has a fixed case, and an `sk-` body needs an uppercase letter or digit.
 */
export const CREDENTIAL_FORMAT =
  /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY(?: BLOCK)?-----|"private_key"\s*:\s*"-----BEGIN|(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}\b|(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}(?![A-Za-z0-9])|(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}\b|(?<![A-Za-z0-9])sk-(?:proj-)?(?=[A-Za-z0-9_-]*[A-Z0-9])[A-Za-z0-9_-]{24,}\b|(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{20,}/u;

// `word` is the credential word findings report as `key`; the rest of a name may hold a value.
const CREDENTIAL_NAME =
  '(?<name>(?:[A-Za-z_][A-Za-z0-9_-]*?)?(?<word>API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|CLIENT[_-]?SECRET|PRIVATE[_-]?KEY|PASSWORD|TOKEN|SECRET(?:[_-]?KEY)?))';
const QUOTED_ASSIGNMENT = new RegExp(
  `(?:^|[^A-Za-z0-9_])${CREDENTIAL_NAME}["']?\\s*[:=]\\s*(?<quote>["'\`])(?<value>(?:(?!\\k<quote>|\\$\\{)[^\\r\\n\\\\]|\\\\.){16,})\\k<quote>`,
  'giu',
);
const UNQUOTED_ASSIGNMENT = new RegExp(
  `^[ \\t]*(?<exported>export[ \\t]+)?${CREDENTIAL_NAME}(?<before>[ \\t]*)(?<operator>[:=])(?<after>[ \\t]*)(?!process\\.env(?:\\.|\\[)|import\\.meta\\.env(?:\\.|\\[)|Deno\\.env\\.|os\\.environ|env\\.)(?<value>[^\\s"'\`#()\\[\\]{}$]{16,})[ \\t]*(?:#[^\\r\\n]*)?\\r?$`,
  'gimu',
);
const PLACEHOLDER =
  /^(?:example(?:[-_].*)?|placeholder(?:[-_].*)?|your[-_].*|(?:change|replace)[-_]me(?:[-_].*)?|(?:dummy|fake|mock|test|never[-_]return)[-_](?:api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret|password|token|secret(?:[-_]?key)?))$/iu;
// A lowercase marker followed only by words and short numbers, one of them a credential noun.
const DESCRIBED_PLACEHOLDER =
  /^(?:dummy|fake|mock|test|fixture|synthetic|never[-_]return)(?:[-_. ](?:[a-z]+|\d{1,4}))+[-_.]?$/u;
const CREDENTIAL_NOUN = /[-_. ](?:secret|key|token|password|credential)s?(?=[-_. ]|$)/u;
const SHELL_NAME = /^[A-Z][A-Z0-9_]*$/u;
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
// Multi-line strings in code read like text, so an unterminated identifier stays a literal.
function unquotedLiteral(raw, operator, syntax) {
  if (syntax === 'config' || (syntax === 'text' && operator === '=')) return true;
  const terminated = /[;,]$/u.test(raw);
  const value = terminated ? raw.slice(0, -1) : raw;
  if (memberPath(value)) return !(terminated || syntax === 'code');
  return !(terminated && codeIdentifier(value));
}

// `export NAME=` and an uppercase `NAME=value` without spaces are shell or env lines in any file.
function shellAssignment({ exported, name, before, operator, after }) {
  return Boolean(exported) || (operator === '=' && !before && !after && SHELL_NAME.test(name));
}

function placeholder(value) {
  return (
    PLACEHOLDER.test(value) || (DESCRIBED_PLACEHOLDER.test(value) && CREDENTIAL_NOUN.test(value))
  );
}

/**
 * Classifies credential material in `bytes` from `origin` ({ path?, label?, syntax?, resolvable? }).
 * Findings report location, rule, classification, confidence and explanation, never values.
 * `resolvable: false` marks text that no resolution can admit, such as a correction.
 */
export function classifyCredentials(bytes, origin = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8');
  const content = buffer.toString('utf8');
  const label = origin.label ?? origin.path ?? 'text';
  const syntax = origin.syntax ?? credentialSyntax(origin.path);
  const resolvable = origin.resolvable !== false;
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
  for (const match of content.matchAll(new RegExp(CREDENTIAL_FORMAT.source, 'gu')))
    add('credential-format', match.index, null, {
      classification: 'credential',
      confidence: 'high',
      resolvable: false,
      explanation:
        'A recognizable credential or private key format cannot be delegated; remove it from the source.',
    });
  const literal = ({ index, 0: text, groups: { name, word } }) =>
    add('credential-assignment', index + text.indexOf(name), word, {
      classification: 'possible-credential',
      confidence: 'medium',
      resolvable,
      explanation: `${word} is assigned a literal that is neither a reference nor a recognized placeholder; ${resolvable ? 'resolve this finding only if the value is not a credential' : 'remove the value or replace it with a reference'}.`,
    });
  for (const match of content.matchAll(QUOTED_ASSIGNMENT))
    if (!placeholder(match.groups.value)) literal(match);
  for (const match of content.matchAll(UNQUOTED_ASSIGNMENT)) {
    const { operator, value } = match.groups;
    const lineSyntax = shellAssignment(match.groups) ? 'config' : syntax;
    if (unquotedLiteral(value, operator, lineSyntax) && !placeholder(value.replace(/[;,]$/u, '')))
      literal(match);
  }
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
