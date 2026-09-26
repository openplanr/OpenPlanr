// Comment extraction and the planning-identifier rules for handwritten JavaScript,
// TypeScript and CSS. String, template and regex literals are skipped so that ids the
// product itself generates or parses (a task id in a test's fixture data) never count.

export const SCRIPT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
]);
export const STYLE_EXTENSIONS = new Set(['.css']);

export const RULES = [
  {
    id: 'planning-id',
    message:
      'planning identifier; say what the code guarantees and leave the id to the commit and the spec',
    pattern: /\b(?:SPEC|US|BL|QT|ADR|NFR|FR|BR|AC)-\d{1,4}\b|\bT-\d{1,4}\b/gu,
  },
  {
    id: 'requirement-id',
    message: 'requirement or acceptance-criteria shorthand; describe the rule instead',
    pattern: /(?<!#)\b(?:FR|BR|AC|NFR)\d{1,3}\b/gu,
  },
  {
    id: 'hard-rule',
    message: 'numbered hard rule; the number resolves only in the specification',
    pattern: /\bhard rules?[\s*]+\d+\b/giu,
  },
];

// A `/` after one of these tokens begins a regex literal rather than a division.
const REGEX_AFTER_KEYWORD = new Set([
  'return',
  'typeof',
  'instanceof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'yield',
  'await',
]);

const isWordCharacter = (character) => /[\w$]/u.test(character);

function regexFollows(lastToken) {
  if (lastToken === '') return true;
  if (/^[\w$]+$/u.test(lastToken)) return REGEX_AFTER_KEYWORD.has(lastToken);
  return !/^[)\]}'"`]$/u.test(lastToken);
}

/** Every comment in a JavaScript or TypeScript source, with the 1-based line it starts on. */
export function extractScriptComments(source) {
  const comments = [];
  const length = source.length;
  let index = source.startsWith('#!') ? Math.max(source.indexOf('\n'), 0) : 0;
  let line = 1;
  let lastToken = '';
  let inTemplate = false;
  const templateBraceDepths = [];

  const countLines = (text) => {
    for (const character of text) if (character === '\n') line += 1;
  };

  // Quoted strings cannot span lines, so a stray quote (JSX text) hides at most one line.
  const skipQuoted = (quote) => {
    index += 1;
    while (index < length) {
      const character = source[index];
      if (character === '\\') {
        if (source[index + 1] === '\n') line += 1;
        index += 2;
        continue;
      }
      if (character === '\n') return;
      index += 1;
      if (character === quote) return;
    }
  };

  const skipRegex = () => {
    index += 1;
    let inClass = false;
    while (index < length) {
      const character = source[index];
      if (character === '\\') {
        index += 2;
        continue;
      }
      if (character === '\n') return;
      index += 1;
      if (character === '[') inClass = true;
      else if (character === ']') inClass = false;
      else if (character === '/' && !inClass) break;
    }
    while (index < length && isWordCharacter(source[index])) index += 1;
  };

  while (index < length) {
    const character = source[index];
    const next = source[index + 1];

    if (inTemplate) {
      if (character === '\\') {
        if (next === '\n') line += 1;
        index += 2;
      } else if (character === '`') {
        inTemplate = false;
        lastToken = '`';
        index += 1;
      } else if (character === '$' && next === '{') {
        templateBraceDepths.push(0);
        inTemplate = false;
        lastToken = '{';
        index += 2;
      } else {
        if (character === '\n') line += 1;
        index += 1;
      }
      continue;
    }

    if (character === '\n') {
      line += 1;
      index += 1;
      continue;
    }
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? length : end;
      comments.push({ line, text: source.slice(index, stop) });
      index = stop;
      continue;
    }
    if (character === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? length : end + 2;
      const text = source.slice(index, stop);
      comments.push({ line, text });
      countLines(text);
      index = stop;
      continue;
    }
    if (character === "'" || character === '"') {
      skipQuoted(character);
      lastToken = character;
      continue;
    }
    if (character === '`') {
      inTemplate = true;
      index += 1;
      continue;
    }
    if (templateBraceDepths.length > 0 && (character === '{' || character === '}')) {
      const top = templateBraceDepths.length - 1;
      if (character === '{') templateBraceDepths[top] += 1;
      else if (templateBraceDepths[top] === 0) {
        templateBraceDepths.pop();
        inTemplate = true;
        index += 1;
        continue;
      } else templateBraceDepths[top] -= 1;
      lastToken = character;
      index += 1;
      continue;
    }
    if (character === '/' && lastToken === '<') {
      // A JSX closing tag; skip to its end so its text is neither a regex nor a comment.
      const end = source.indexOf('>', index);
      const newline = source.indexOf('\n', index);
      const stop = [end, newline].filter((position) => position !== -1);
      index = stop.length === 0 ? length : Math.min(...stop) + 1;
      if (index - 1 === newline) line += 1;
      lastToken = '>';
      continue;
    }
    if (character === '/' && regexFollows(lastToken)) {
      skipRegex();
      lastToken = '/';
      continue;
    }
    if (isWordCharacter(character)) {
      let end = index + 1;
      while (end < length && isWordCharacter(source[end])) end += 1;
      lastToken = source.slice(index, end);
      index = end;
      continue;
    }
    lastToken = character;
    index += 1;
  }
  return comments;
}

/** Every block comment in a stylesheet, with the 1-based line it starts on. */
export function extractStyleComments(source) {
  const comments = [];
  const length = source.length;
  let index = 0;
  let line = 1;
  while (index < length) {
    const character = source[index];
    if (character === '\n') {
      line += 1;
      index += 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? length : end + 2;
      const text = source.slice(index, stop);
      comments.push({ line, text });
      for (const inner of text) if (inner === '\n') line += 1;
      index = stop;
      continue;
    }
    if (character === "'" || character === '"') {
      index += 1;
      while (index < length && source[index] !== character && source[index] !== '\n') {
        index += source[index] === '\\' ? 2 : 1;
      }
      index += 1;
      continue;
    }
    index += 1;
  }
  return comments;
}

export function extractComments(source, extension) {
  if (STYLE_EXTENSIONS.has(extension)) return extractStyleComments(source);
  return extractScriptComments(source);
}

/**
 * Rule violations inside the comments of one file, in line order.
 * A match may span wrapped comment lines; it is reported on the line where it starts.
 */
export function findCommentIdentifiers(file, source, extension, rules = RULES) {
  const findings = [];
  for (const comment of extractComments(source, extension)) {
    for (const rule of rules) {
      for (const match of comment.text.matchAll(rule.pattern)) {
        const wrappedLines = comment.text.slice(0, match.index).split('\n').length - 1;
        findings.push({
          file,
          line: comment.line + wrappedLines,
          rule: rule.id,
          match: match[0].replace(/[\s*]+/gu, ' '),
          message: rule.message,
        });
      }
    }
  }
  return findings.sort((first, second) => first.line - second.line);
}
