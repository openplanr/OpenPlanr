import { SkillRuntimeError } from '../errors.mjs';
import { sha256Bytes } from './source-map.mjs';

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n\n([\s\S]+)$/u;
const TOKEN = /\{\{([A-Z][A-Z0-9_]*)\}\}/gu;

// LF normalization for markdown composition and rendering ONLY. This transform
// reshapes bytes and must never feed a custody digest.
export function canonicalText(value) {
  return String(value).replace(/\r\n/gu, '\n');
}

const WINDOWS_DRIVE = /^[A-Za-z]:/u;

/**
 * Compiler-boundary path guard. Rejects an absolute (POSIX `/...` or Windows
 * `C:\...`), backslashed, or `..`-escaping path before it is handed to any
 * `readSource` callback, independent of whatever `readSource` implementation is
 * plugged in. Defence in depth alongside the authoring loader and the schema.
 */
export function assertSafeSourcePath(path, label = 'source path') {
  if (typeof path !== 'string' || path.length === 0) {
    throw new SkillRuntimeError('E_SKILL_SOURCE_PATH_INVALID', `${label} must be a non-empty repository-relative path.`, { path });
  }
  if (path.includes('\0') || path.includes('\\') || path.startsWith('/') || WINDOWS_DRIVE.test(path)) {
    throw new SkillRuntimeError('E_SKILL_SOURCE_PATH_INVALID', `${label} ${path} must be repository-relative, not absolute.`, { path });
  }
  const segments = path.split('/');
  if (segments.includes('..')) {
    throw new SkillRuntimeError('E_SKILL_SOURCE_PATH_ESCAPE', `${label} ${path} may not traverse out of the skill directory with '..'.`, { path });
  }
  if (segments.some((segment) => segment.length === 0 || segment === '.')) {
    throw new SkillRuntimeError('E_SKILL_SOURCE_PATH_INVALID', `${label} ${path} must use canonical repository-relative segments.`, { path });
  }
  return path;
}

// The one custody hash: sha256 over the exact literal bytes, never normalized.
export { sha256Bytes as sha256 };

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed); } catch { return trimmed.slice(1, -1); }
  }
  return trimmed;
}

export function parseMarkdownAsset(bytes, { expectedName } = {}) {
  const source = canonicalText(bytes);
  const match = source.match(FRONTMATTER);
  if (!match) throw new SkillRuntimeError('E_MARKDOWN_FRONTMATTER_INVALID', 'Markdown asset requires one closed YAML frontmatter block.');
  const fields = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    fields[line.slice(0, separator).trim()] = unquote(line.slice(separator + 1));
  }
  if (!fields.name || !fields.description || (expectedName && fields.name !== expectedName)) {
    throw new SkillRuntimeError('E_MARKDOWN_IDENTITY_INVALID', `Markdown identity must match ${expectedName ?? 'its declared name'}.`, { expectedName, actualName: fields.name });
  }
  if (!match[2].endsWith('\n')) throw new SkillRuntimeError('E_MARKDOWN_NEWLINE_INVALID', `Markdown asset ${fields.name} must end with a newline.`);
  return Object.freeze({ source, frontmatter: match[1], lines, fields, body: match[2] });
}

export function renderTemplate(template, values) {
  const used = new Set();
  const rendered = canonicalText(template).replace(TOKEN, (token, key) => {
    if (!Object.hasOwn(values, key)) throw new SkillRuntimeError('E_TEMPLATE_VALUE_MISSING', `No value was supplied for ${token}.`);
    used.add(key);
    return String(values[key]);
  });
  const unresolved = [...rendered.matchAll(TOKEN)].map((match) => match[0]);
  if (unresolved.length > 0) throw new SkillRuntimeError('E_TEMPLATE_TOKEN_UNRESOLVED', 'Rendered asset has unresolved template tokens.', { unresolved });
  const unused = Object.keys(values).filter((key) => !used.has(key));
  if (unused.length > 0) throw new SkillRuntimeError('E_TEMPLATE_VALUE_UNUSED', 'Template values were supplied but not consumed.', { unused });
  return rendered;
}

export function renderCodexSkill(bytes, id) {
  const parsed = parseMarkdownAsset(bytes, { expectedName: id });
  const frontmatter = parsed.lines.filter((line) => !line.startsWith('allowed-tools:')).join('\n');
  return `---\n${frontmatter}\n---\n\n${parsed.body}`;
}

function quoteYamlCharacter(character) {
  return JSON.stringify(character)
    .slice(1, -1)
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

/**
 * Serialize a string as a YAML-safe scalar while preserving established plain
 * scalars byte-for-byte. Fragment provenance lets the source map distinguish
 * authored characters from compiler-introduced quotes and escape sequences.
 */
export function serializeYamlScalarFragments(value) {
  const text = String(value);
  const fragments = [{ text: '"', generated: true }];
  for (const character of text) {
    const encoded = quoteYamlCharacter(character);
    const generated = encoded !== character;
    const previous = fragments.at(-1);
    if (previous.generated === generated) previous.text += encoded;
    else fragments.push({ text: encoded, generated });
  }
  fragments.push({ text: '"', generated: true });
  return Object.freeze(fragments.map((fragment) => Object.freeze(fragment)));
}

export function serializeYamlScalar(value) {
  return serializeYamlScalarFragments(value).map((fragment) => fragment.text).join('');
}

export function renderCursorSkill(bytes, id, template, { quoteDescription = false } = {}) {
  const parsed = parseMarkdownAsset(bytes, { expectedName: id });
  return renderTemplate(template, {
    DESCRIPTION: quoteDescription
      ? serializeYamlScalar(parsed.fields.description)
      : parsed.fields.description,
    BODY: parsed.body.trimEnd(),
  });
}

const HOST_SUBSTITUTIONS = Object.freeze({
  pipeline: Object.freeze({
    AGENTS_ROOT: 'agents',
    PIPELINE_PACKAGE_ROOT: 'the installed planr-pipeline package root',
    PROJECT_STACKS_ROOT: 'the active host project stack directory',
    WORKFLOW_PREFIX: 'planr-',
  }),
  'claude-code': Object.freeze({
    AGENTS_ROOT: 'agents',
    PIPELINE_PACKAGE_ROOT: '${CLAUDE_PLUGIN_ROOT}',
    PROJECT_STACKS_ROOT: '.claude/stacks',
    WORKFLOW_PREFIX: '/planr-pipeline:',
  }),
  codex: Object.freeze({
    AGENTS_ROOT: 'agents',
    PIPELINE_PACKAGE_ROOT: 'the installed `planr-pipeline` package root',
    PROJECT_STACKS_ROOT: '.codex/stacks',
    WORKFLOW_PREFIX: '$planr-',
  }),
  cursor: Object.freeze({
    AGENTS_ROOT: 'agents',
    PIPELINE_PACKAGE_ROOT: 'the installed `planr-pipeline` package root',
    PROJECT_STACKS_ROOT: '.cursor/stacks',
    WORKFLOW_PREFIX: 'planr-',
  }),
});

export { HOST_SUBSTITUTIONS };

export function renderHostTokens(bytes, host) {
  const values = HOST_SUBSTITUTIONS[host];
  if (!values) throw new SkillRuntimeError('E_HOST_INVALID', `Unknown adapter host ${host}.`);
  const requested = [...canonicalText(bytes).matchAll(TOKEN)].map((match) => match[1]);
  const selected = Object.fromEntries([...new Set(requested)].map((key) => {
    if (!Object.hasOwn(values, key)) throw new SkillRuntimeError('E_TEMPLATE_VALUE_MISSING', `No host value was supplied for {{${key}}}.`);
    return [key, values[key]];
  }));
  return requested.length === 0 ? canonicalText(bytes) : renderTemplate(bytes, selected);
}

export function renderRoleAsset(bytes, role, host, { aliasTemplate, cursorTemplate }) {
  const parsed = parseMarkdownAsset(bytes, { expectedName: role.id });
  const body = renderHostTokens(parsed.body, host).trimEnd();
  if (host === 'claude-code') {
    const toolsLine = parsed.lines.find((line) => line.startsWith('tools:')) ?? '';
    return renderTemplate(aliasTemplate, {
      ROLE_ALIAS: role.alias,
      ROLE_ID: role.id,
      ROLE_SOURCE: role.source,
      ROLE_BODY: body,
      TOOLS_LINE: toolsLine,
    });
  }
  if (host === 'cursor') return `---\nname: ${role.id}\ndescription: ${parsed.fields.description}\n---\n\n<!-- Generated from ${role.source}. Legacy alias: ${role.alias}. -->\n\n${body}\n`;
  return `---\nname: ${role.id}\ndescription: ${parsed.fields.description}\n---\n\n<!-- Generated from ${role.source}. Legacy alias: ${role.alias}. -->\n\n${body}\n`;
}

const HOST_MARKERS = Object.freeze({
  'claude-code': Object.freeze([
    ['Codex project path', /\.codex\//u],
    ['Codex skill invocation', /\$planr-[a-z0-9-]+/u],
    ['Cursor project path', /\.cursor\//u],
  ]),
  codex: Object.freeze([
    ['Claude plugin path', /\$\{CLAUDE_PLUGIN_ROOT\}|\.claude\//u],
    ['Claude command invocation', /\/planr-pipeline:/u],
    ['Cursor project path', /\.cursor\//u],
  ]),
  cursor: Object.freeze([
    ['Claude plugin path', /\$\{CLAUDE_PLUGIN_ROOT\}|\.claude\//u],
    ['Claude command invocation', /\/planr-pipeline:/u],
    ['Codex project path', /\.codex\//u],
    ['Codex skill invocation', /\$planr-[a-z0-9-]+/u],
  ]),
  pipeline: Object.freeze([
    ['Claude plugin path', /\$\{CLAUDE_PLUGIN_ROOT\}|\.claude\//u],
    ['Claude command invocation', /\/planr-pipeline:/u],
    ['Codex project path', /\.codex\//u],
    ['Codex skill invocation', /\$planr-[a-z0-9-]+/u],
    ['Cursor project path', /\.cursor\//u],
  ]),
});

const TOOL_INVOCATION = /\b(Bash|Read|Write|Edit|Glob|Grep)\(([^)\n]*)\)/gu;
const NETWORK_COMMAND = /(?:\bBash\([^\n)]*\b(?:curl|wget|ssh|scp|sftp|nc)\b[^\n)]*\)|`(?:curl|wget|ssh|scp|sftp|nc)\b[^`]*`|^\s*\$?\s*(?:curl|wget|ssh|scp|sftp|nc)\b)/imu;
const PLANR_OPERATION = /\b(?:planr|openplanr|opr)\s+([a-z][a-z0-9-]*)\b/gu;

function normalizeToolName(tool) {
  const name = String(tool).match(/^[A-Za-z]+/u)?.[0] ?? '';
  if (['Read', 'Glob', 'Grep'].includes(name) || name === 'read') return 'read';
  if (['Write', 'Edit'].includes(name) || name === 'edit') return 'edit';
  if (name === 'Bash' || name === 'shell') return 'shell';
  return name;
}

function toolAllowed(invocation, allowedTools) {
  const [name, args = ''] = invocation.match(/^([A-Za-z]+)(?:\((.*)\))?$/u)?.slice(1) ?? [];
  const normalized = normalizeToolName(name);
  for (const allowed of allowedTools) {
    if (allowed === invocation || allowed === name || allowed === normalized) return true;
    if (normalizeToolName(allowed) !== normalized) continue;
    const scope = String(allowed).match(/^Bash\((.+):\*\)$/u)?.[1];
    const command = args.trim();
    if (scope && (command === scope || command.startsWith(`${scope} `))) return true;
  }
  return false;
}

function declaredFrontmatterTools(bytes) {
  const line = String(bytes).match(/^allowed-tools:\s*(.+)$/mu)?.[1];
  if (!line) return [];
  const value = unquote(line);
  return value.split(/,\s*/u).map((entry) => entry.trim()).filter(Boolean);
}

/**
 * Validate the rendered host boundary. Passing `authority` enables composed-v1
 * checks for undeclared tools, runtime operations, and network requirements;
 * markdown-v1 callers retain their frozen compatibility behavior.
 */
export function assertPortableAsset(path, bytes, host, authority) {
  const rules = [
    ['absolute user path', /(?:\/Users\/|\/home\/|[A-Za-z]:\\)/u],
    ['unresolved template token', /\{\{[A-Z][A-Z0-9_]*\}\}/u],
    ['vendor model selection', /(?:claude-(?:sonnet|opus)|gpt-[0-9]|gemini-[0-9])/iu],
  ];
  // markdown-v1 is a frozen compatibility surface. Preserve its historical
  // cross-reference prose while retaining the pre-existing non-Claude guard.
  if (!authority && host !== 'claude-code') {
    rules.push(['Claude plugin path', /\$\{CLAUDE_PLUGIN_ROOT\}|\.claude\//u]);
    rules.push(['Claude command invocation', /\/planr-pipeline:/u]);
  }
  if (authority) rules.push(...(HOST_MARKERS[host] ?? []));
  const hit = rules.find(([, pattern]) => pattern.test(bytes));
  if (hit) throw new SkillRuntimeError('E_GENERATED_ASSET_NOT_PORTABLE', `${path} contains ${hit[0]}.`, { path, host, violation: hit[0] });

  if (authority) {
    const allowedTools = authority.allowedTools ?? [];
    const invocations = [
      ...declaredFrontmatterTools(bytes),
      ...[...String(bytes).matchAll(TOOL_INVOCATION)].map((match) => `${match[1]}(${match[2]})`),
    ];
    for (const invocation of [...new Set(invocations)]) {
      if (!toolAllowed(invocation, allowedTools)) {
        throw new SkillRuntimeError(
          'E_GENERATED_ASSET_TOOL_UNDECLARED',
          `${path} invokes ${invocation}, which is outside the selected host profile's tool ceiling.`,
          { path, host, tool: invocation, allowedTools, repair: `Remove ${invocation} or declare an authority-compatible tool in the selected host profile.` },
        );
      }
    }

    if (authority.externalDataAccess === 'none' && NETWORK_COMMAND.test(bytes)) {
      throw new SkillRuntimeError(
        'E_GENERATED_ASSET_NETWORK_UNDECLARED',
        `${path} requires network access but the selected host profile allows none.`,
        { path, host, repair: 'Remove the network requirement or select a profile whose authority permits read-only external access.' },
      );
    }

    for (const match of String(bytes).matchAll(PLANR_OPERATION)) {
      const operation = match[1];
      if (!(authority.allowedOperations ?? []).includes(operation)) {
        throw new SkillRuntimeError(
          'E_GENERATED_ASSET_OPERATION_UNDECLARED',
          `${path} invokes runtime operation ${operation}, which the selected host profile does not declare.`,
          { path, host, operation, allowedOperations: authority.allowedOperations ?? [], repair: `Remove the ${operation} invocation or declare it in the selected host profile's allowedOperations.` },
        );
      }
    }
  }
  return bytes;
}
