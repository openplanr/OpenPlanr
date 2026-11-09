#!/usr/bin/env node
// @ts-check
// The one backlog item writer: the CLI imports it, and skills run it when no CLI is installed.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Holds one empty file per issued ID, so the ID of a removed artifact is never issued again. */
const ISSUED_IDS_DIR = '.issued-ids';
const CLOSED_STATUSES = new Set(['closed', 'done']);

/** @type {typeof import('./backlog-item.d.mts').CLI_INSTALL_COMMAND} */
export const CLI_INSTALL_COMMAND = 'npm install -g openplanr';
/** @type {typeof import('./backlog-item.d.mts').CLI_HINT} */
export const CLI_HINT = `Install the OpenPlanr CLI to manage these items: ${CLI_INSTALL_COMMAND}`;

/** @type {typeof import('./backlog-item.d.mts').reserveNextId} */
export async function reserveNextId(dir, prefix) {
  const issuedDir = join(dir, ISSUED_IDS_DIR);
  await mkdir(issuedDir, { recursive: true });
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}-(\\d{3,})`, 'u');
  let next = 1;
  for (const directory of [dir, issuedDir]) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const match = entry.isDirectory() ? null : pattern.exec(entry.name);
      if (match) next = Math.max(next, Number.parseInt(match[1], 10) + 1);
    }
  }
  for (; ; next++) {
    const id = `${prefix}-${String(next).padStart(3, '0')}`;
    try {
      await writeFile(join(issuedDir, id), '', { flag: 'wx' });
      return id;
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
    }
  }
}

/** @type {typeof import('./backlog-item.d.mts').slugify} */
export function slugify(text, maxLength = 80) {
  let slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > maxLength) {
    slug = slug.slice(0, maxLength);
    // Trim at the last whole-word boundary to avoid cut-off words.
    const lastDash = slug.lastIndexOf('-');
    if (lastDash > 0) slug = slug.slice(0, lastDash);
  }
  return slug;
}

/** @param {unknown} value */
function strings(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string')
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  return [];
}

/** @param {unknown} value */
function optionalText(value) {
  return value === undefined || value === null || value === '' ? undefined : value;
}

const PRIORITIES = Object.freeze(['critical', 'high', 'medium', 'low']);

/** Bad backlog input; the code lets the CLI report it as an input error, not a crash. */
class BacklogInputError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'BacklogInputError';
    this.code = 'E_BACKLOG_INVALID';
  }
}

const WHEN_PATTERN =
  /^(?:(?:next-unit|trigger|declined):\S(?:[^\r\n]*\S)?|sprint:(?:next|SPRINT-\d{3,}))(?![\s\S])/u;
const FILE_PATTERN =
  /^(?!\/)(?![A-Za-z]:)(?!.*\\)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)(?!.*:\d+(?::\d+|-\d+)?$)[^\r\n]+$/u;

/** @type {typeof import('./backlog-item.d.mts').parseWhen} */
export function parseWhen(value) {
  if (typeof value !== 'string' || !WHEN_PATTERN.test(value))
    throw new BacklogInputError(
      `Backlog when ${JSON.stringify(value)} is not valid; use next-unit:<ref>, sprint:<SPRINT-NNN or next>, trigger:<event>, or declined:<reason>. Do not store now.`,
    );
  const separator = value.indexOf(':');
  return {
    kind: /** @type {import('./backlog-item.d.mts').BacklogWhen['kind']} */ (
      value.slice(0, separator)
    ),
    value: value.slice(separator + 1),
  };
}

/** @param {unknown} value */
function normalizeFilePath(value) {
  return typeof value === 'string'
    ? value
        .trim()
        .replaceAll('\\', '/')
        .replace(/^(?:\.\/)+/u, '')
    : '';
}

/** @type {typeof import('./backlog-item.d.mts').normalizeBacklogFiles} */
export function normalizeBacklogFiles(value) {
  if (!Array.isArray(value))
    throw new BacklogInputError(
      `Backlog files ${JSON.stringify(value)} must be an array of repo-relative paths.`,
    );
  return [
    ...new Set(
      value.map((item) => {
        const normalized = normalizeFilePath(item);
        if (!FILE_PATTERN.test(normalized))
          throw new BacklogInputError(
            `Backlog files entry ${JSON.stringify(item)} must be a repo-relative path without .. segments, absolute paths, or line numbers.`,
          );
        return normalized;
      }),
    ),
  ];
}

/** @type {typeof import('./backlog-item.d.mts').backlogFields} */
export function backlogFields(input) {
  const title = String(input.title ?? input.name ?? '').trim();
  if (!title) throw new BacklogInputError('A backlog item needs a non-empty title.');
  const priority = String(input.priority ?? 'medium');
  if (!PRIORITIES.includes(priority))
    throw new BacklogInputError(
      `Backlog priority ${JSON.stringify(priority)} is not valid; use one of ${PRIORITIES.join(', ')}.`,
    );
  const criteria = optionalText(input.acceptanceCriteria);
  const notes = optionalText(input.notes);
  const epicId = optionalText(input.epicId);
  if (input.when !== undefined) parseWhen(input.when);
  const files = input.files === undefined ? undefined : normalizeBacklogFiles(input.files);
  if (input.unverified !== undefined && input.unverified !== true)
    throw new BacklogInputError(
      `Backlog unverified ${JSON.stringify(input.unverified)} must be true when present.`,
    );
  return {
    title,
    priority,
    tags: strings(input.tags),
    description: String(input.description ?? title),
    ...(criteria === undefined
      ? {}
      : { acceptanceCriteria: Array.isArray(criteria) ? criteria.map(String) : String(criteria) }),
    ...(notes === undefined ? {} : { notes: String(notes) }),
    ...(input.when === undefined ? {} : { when: String(input.when) }),
    ...(files === undefined ? {} : { files }),
    ...(input.unverified === undefined ? {} : { unverified: /** @type {const} */ (true) }),
    ...(epicId === undefined ? {} : { epicId: String(epicId) }),
  };
}

/** @type {typeof import('./backlog-item.d.mts').renderBacklogItem} */
export function renderBacklogItem(id, fields, date) {
  const quote = JSON.stringify;
  const lines = [
    '---',
    `id: ${quote(id)}`,
    `title: ${quote(fields.title)}`,
    `priority: ${quote(fields.priority)}`,
    `tags: [${fields.tags.map((tag) => quote(tag)).join(', ')}]`,
    'status: "open"',
    `created: ${quote(date)}`,
    `updated: ${quote(date)}`,
    ...(fields.when === undefined ? [] : [`when: ${quote(fields.when)}`]),
    ...(fields.files === undefined
      ? []
      : [`files: [${fields.files.map((file) => quote(file)).join(', ')}]`]),
    ...(fields.unverified === undefined ? [] : ['unverified: true']),
    ...(fields.epicId ? [`epicId: ${quote(fields.epicId)}`] : []),
    '---',
    '',
    `# ${id}: ${fields.title}`,
    '',
  ];
  /** @param {string} heading @param {string} body @param {boolean} [spaced] */
  const section = (heading, body, spaced = false) =>
    lines.push(`## ${heading}`, ...(spaced ? [''] : []), body, '');
  if (fields.tags.length > 0)
    section('Tags', fields.tags.map((tag) => `- ${tag}`).join('\n'), true);
  // A description with its own sections stands alone instead of nesting under another heading.
  if (/^## /u.test(fields.description)) lines.push(fields.description, '');
  else if (fields.description !== fields.title) section('Description', fields.description);
  if (fields.acceptanceCriteria !== undefined && fields.acceptanceCriteria.length > 0)
    section(
      'Acceptance Criteria',
      Array.isArray(fields.acceptanceCriteria)
        ? fields.acceptanceCriteria.map((criterion) => `- ${criterion}`).join('\n')
        : fields.acceptanceCriteria,
    );
  if (fields.notes) section('Notes', fields.notes);
  lines.push('---', `_Close when done: \`openplanr backlog update ${id} --status closed\`_`, '');
  return lines.join('\n');
}

/** @type {typeof import('./backlog-item.d.mts').writeBacklogItem} */
export async function writeBacklogItem(backlogDir, prefix, fields, date) {
  await mkdir(backlogDir, { recursive: true });
  const id = await reserveNextId(backlogDir, prefix);
  const filePath = join(backlogDir, `${id}-${slugify(fields.title)}.md`);
  await writeFile(filePath, renderBacklogItem(id, fields, date));
  return { id, filePath };
}

/** @param {string} projectDir */
async function projectConfig(projectDir) {
  const configPath = join(projectDir, '.planr', 'config.json');
  let raw;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT')
      throw new Error(
        `No OpenPlanr project at ${projectDir}: ${configPath} is missing. Run \`openplanr init\` or pass the project root.`,
      );
    throw error;
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${configPath} is not valid JSON: ${/** @type {Error} */ (error).message}`);
  }
  return { configPath, raw, config };
}

/** @param {string} projectDir */
async function projectBacklog(projectDir) {
  const { config } = await projectConfig(projectDir);
  const agile = String(config.outputPaths?.agile ?? '.planr').replaceAll('\\', '/');
  return {
    backlogDir: resolve(projectDir, agile, 'backlog'),
    prefix: String(config.idPrefix?.backlog ?? 'BL'),
    templateOverrides:
      typeof config.templateOverrides === 'string' ? config.templateOverrides : undefined,
  };
}

/** @param {string} projectDir @param {string} filePath */
const relativePath = (projectDir, filePath) => relative(projectDir, filePath).split(sep).join('/');

/** @type {typeof import('./backlog-item.d.mts').createBacklogItem} */
export async function createBacklogItem(
  projectDir,
  input,
  date = new Date().toISOString().split('T')[0],
) {
  const { backlogDir, prefix } = await projectBacklog(projectDir);
  const fields = backlogFields(input);
  const { id, filePath } = await writeBacklogItem(backlogDir, prefix, fields, date);
  return { id, title: fields.title, artifactPath: relativePath(projectDir, filePath) };
}

const NON_STRING_SCALAR =
  /^(?:null|true|false|~|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[+-]?0[xob][0-9a-f]+|[+-]?\.(?:inf|nan))$/iu;

/** @param {string} source @returns {string[]} */
function flowStrings(source) {
  const values = [];
  let rest = source.slice(1).trimStart();
  while (!rest.startsWith(']')) {
    const token = /^(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[^\s,[\]{}"'][^,[\]{}]*)/u.exec(rest)?.[0];
    if (!token) throw new Error('expected a quoted or plain string');
    const plain = token.trim();
    if (token.startsWith('"')) values.push(JSON.parse(token));
    else if (token.startsWith("'")) values.push(token.slice(1, -1).replaceAll("''", "'"));
    else {
      if (NON_STRING_SCALAR.test(plain) || /^[!&*]/u.test(plain) || /:\s|\s#/u.test(plain))
        throw new Error(`expected a string, received ${JSON.stringify(plain)}`);
      values.push(plain);
    }
    rest = rest.slice(token.length).trimStart();
    if (rest.startsWith(',')) rest = rest.slice(1).trimStart();
    else if (!rest.startsWith(']')) throw new Error('expected a comma or closing bracket');
  }
  if (!/^\](?:\s+#.*)?$/u.test(rest)) throw new Error('unexpected text after the closing bracket');
  return values;
}

/** @param {string} text */
function frontmatter(text) {
  const block = /^---\n([\s\S]*?)\n---/u.exec(text.replace(/\r\n/gu, '\n'))?.[1] ?? '';
  /** @type {Map<string, string>} */
  const fields = new Map();
  const duplicates = new Set();
  let key;
  for (const line of block.split('\n')) {
    const match = /^([^ \t:#]+):[ \t]*(.*)$/u.exec(line);
    if (match) {
      key = match[1];
      if (fields.has(key)) duplicates.add(key);
      fields.set(key, match[2].startsWith('#') ? '' : match[2]);
    } else if (key && line.trim() && !line.trimStart().startsWith('#')) {
      fields.set(key, `${fields.get(key)}\n${line}`);
    }
  }
  return { fields, duplicates };
}

/** @param {string} source */
function readString(source) {
  if (/^["']/u.test(source)) {
    const quoted = /^("(?:\\.|[^"\\])*"|'(?:''|[^'])*')(?:\s+#.*)?$/u.exec(source)?.[1];
    if (quoted === undefined) throw new Error('expected a quoted string');
    const values = flowStrings(`[${quoted}]`);
    if (values.length !== 1) throw new Error('expected one string');
    return values[0];
  }
  const value = source.replace(/\s+#.*$/u, '').trim();
  if (
    !value ||
    NON_STRING_SCALAR.test(value) ||
    /^[![\]{}&*|>@`"'%#]|^[?-]\s|:\s|[\r\n]/u.test(value)
  )
    throw new Error('expected a string');
  return value;
}

/** @param {string} source */
function readStrings(source) {
  if (source.startsWith('[')) return flowStrings(source);
  return source.split('\n').map((line) => {
    const match = /^\s*-\s+(.+)$/u.exec(line);
    if (!match) throw new Error('expected a flow array or block sequence of strings');
    return readString(match[1].trim());
  });
}

/** @param {string} source */
function readFiles(source) {
  const files = readStrings(source);
  if (files.some((file) => !FILE_PATTERN.test(file)) || new Set(files).size !== files.length)
    throw new Error(
      'expected distinct repo-relative paths without traversal, absolute paths, or line numbers',
    );
  return files;
}

/** @param {string} source */
function readDate(source) {
  const value = readString(source);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error('expected a calendar date in YYYY-MM-DD form');
  return value;
}

/** @param {string} text @param {string} path @param {import('./backlog-item.d.mts').BacklogWarning[]} warnings @param {{ id: string, title: string }} fallbacks */
function readBacklogFields(text, path, warnings, fallbacks) {
  const { fields, duplicates } = frontmatter(text);
  const needed = new Set(['id', 'title', 'status', 'when', 'files']);
  let invalid = false;
  /**
   * @template T
   * @param {string} field
   * @param {(source: string) => T} parse
   * @param {boolean} [optional]
   * @param {T} [fallback]
   */
  const read = (field, parse, optional = false, fallback = undefined) => {
    const source = fields.get(field)?.trim();
    try {
      if (duplicates.has(field)) throw new Error('duplicate frontmatter key');
      if (source === undefined) {
        if (optional) return undefined;
        throw new Error('required field is missing');
      }
      if ((field === 'when' || field === 'files') && (!source || source.startsWith('#')))
        return undefined;
      return parse(source);
    } catch (error) {
      const skipped = needed.has(field) && fallback === undefined;
      invalid ||= skipped;
      const value = source ?? 'missing';
      const reason = error instanceof Error ? error.message : String(error);
      warnings.push({
        path,
        field,
        value,
        message: `${path}: ${field} = ${JSON.stringify(value)}: ${reason}${skipped ? '; skipping item' : ''}.`,
      });
      return fallback;
    }
  };
  const id = read(
    'id',
    (source) => {
      const value = readString(source);
      if (!/^[A-Z]+-\d{3,}$/u.test(value))
        throw new Error('expected an artifact ID such as BL-001');
      return value;
    },
    false,
    fallbacks.id,
  );
  const nonEmptyString = (/** @type {string} */ source) => {
    const value = readString(source);
    if (!value.length) throw new Error('expected a non-empty string');
    return value;
  };
  const title = read(
    'title',
    nonEmptyString,
    false,
    fallbacks.title.trim() ? fallbacks.title : undefined,
  );
  const status = read('status', nonEmptyString, false, 'open');
  const when = read(
    'when',
    (source) => {
      const value = readString(source);
      if (!value.trim()) return undefined;
      parseWhen(value);
      return value;
    },
    true,
  );
  const files = read('files', readFiles, true);
  read('priority', (source) => {
    const value = readString(source);
    if (!PRIORITIES.includes(value)) throw new Error(`expected one of ${PRIORITIES.join(', ')}`);
    return value;
  });
  read('tags', readStrings);
  read('created', readDate);
  read('updated', readDate);
  read('epicId', readString, true);
  read(
    'unverified',
    (source) => {
      if (!/^true(?:\s+#.*)?$/iu.test(source)) throw new Error('expected true');
      return true;
    },
    true,
  );
  if (invalid || id === undefined || title === undefined || status === undefined) return undefined;
  return { id, title, status, when, files };
}

/** @param {string} body */
function evidenceFiles(body) {
  const paths = [
    ...body.matchAll(/(?:^|[\s`(['"])([^\s`()[\]<>"']+?):\d+(?::\d+|-\d+)?(?=$|[\s`),.;\]"'])/gu),
  ]
    .map((match) => normalizeFilePath(match[1]))
    .filter((file) => FILE_PATTERN.test(file));
  return [...new Set(paths)];
}

/** @type {typeof import('./backlog-item.d.mts').listBacklog} */
export async function listBacklog(projectDir, options = {}) {
  const requestedFiles =
    options.files === undefined ? undefined : normalizeBacklogFiles(options.files);
  const { backlogDir } = await projectBacklog(projectDir);
  let names;
  try {
    names = await readdir(backlogDir);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT')
      return { items: [], warnings: [] };
    throw error;
  }
  const items = [];
  /** @type {import('./backlog-item.d.mts').BacklogWarning[]} */
  const warnings = [];
  for (const name of names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const match = /^([A-Z]+-\d{3,})-.+\.md$/u.exec(name);
    if (!match) continue;
    const filePath = join(backlogDir, name);
    const text = await readFile(filePath, 'utf8');
    const path = relativePath(projectDir, filePath);
    const fields = readBacklogFields(text, path, warnings, {
      id: match[1],
      title: name.slice(match[1].length + 1, -3).replace(/-/g, ' '),
    });
    if (!fields) continue;
    const { id, title, status, when } = fields;
    if (options.open && CLOSED_STATUSES.has(status)) continue;
    if (options.noWhen && when !== undefined) continue;
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '');
    const files = fields.files === undefined ? evidenceFiles(body) : fields.files;
    if (requestedFiles && !requestedFiles.some((file) => files.includes(file))) continue;
    items.push({
      id,
      title,
      status,
      path,
      ...(when === undefined ? {} : { when }),
      files,
    });
  }
  return { items, warnings };
}

/** @type {typeof import('./backlog-item.d.mts').listOpenBacklog} */
export function listOpenBacklog(projectDir, options = {}) {
  return listBacklog(projectDir, { ...options, open: true });
}

/** @type {typeof import('./backlog-item.d.mts').takeCliHint} */
export async function takeCliHint(projectDir) {
  const { configPath, raw, config } = await projectConfig(projectDir);
  if (config.findings?.cliHintShown === true) return null;
  const next = { ...config, findings: { ...config.findings, cliHintShown: true } };
  const indent = /\n(\t| +)"/u.exec(raw)?.[1] ?? '  ';
  await writeFile(configPath, `${JSON.stringify(next, null, indent)}\n`);
  return CLI_HINT;
}

/** @param {string} source */
async function readInput(source) {
  const text =
    source === '-'
      ? await new Promise((done, fail) => {
          let value = '';
          process.stdin.setEncoding('utf8');
          process.stdin.on('data', (chunk) => {
            value += chunk;
          });
          process.stdin.on('end', () => done(value));
          process.stdin.on('error', fail);
        })
      : await readFile(resolve(source), 'utf8');
  const parsed = JSON.parse(String(text));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Backlog input must be one JSON object with at least a title.');
  return parsed;
}

const USAGE =
  'Usage: backlog-item.mjs add --project <dir> --data <file|->\n       backlog-item.mjs list --project <dir> --open [--files <paths...>] [--no-when]\n';

/** @param {string[]} argv */
async function main(argv) {
  const [command, ...rest] = argv;
  /** @type {Record<string, string | boolean | string[]>} */
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === '--open') options.open = true;
    else if (flag === '--no-when') options.noWhen = true;
    else if (flag === '--files') {
      const paths = [];
      while (index + 1 < rest.length && !rest[index + 1].startsWith('--'))
        paths.push(rest[++index]);
      if (paths.length === 0)
        throw new Error(`--files needs at least one repo-relative path.\n${USAGE}`);
      options.files = paths;
    } else if (flag === '--project' || flag === '--data')
      options[flag.slice(2)] = rest[++index] ?? '';
    else throw new Error(`Unknown argument: ${flag}\n${USAGE}`);
  }
  const projectDir = resolve(String(options.project ?? '.'));
  if (command === 'add') {
    if (typeof options.data !== 'string' || !options.data)
      throw new Error(`add needs --data.\n${USAGE}`);
    const { templateOverrides } = await projectBacklog(projectDir);
    const result = await createBacklogItem(projectDir, await readInput(options.data));
    const cliHint = await takeCliHint(projectDir);
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        action: 'backlog.created',
        ...result,
        ...(templateOverrides ? { templateOverrideIgnored: true } : {}),
        ...(cliHint ? { cliHint } : {}),
      })}\n`,
    );
    return;
  }
  if (command === 'list' && options.open) {
    process.stdout.write(
      `${JSON.stringify(await listOpenBacklog(projectDir, { files: Array.isArray(options.files) ? options.files : undefined, noWhen: options.noWhen === true }))}\n`,
    );
    return;
  }
  throw new Error(USAGE);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
