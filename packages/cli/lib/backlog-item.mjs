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
  return {
    title,
    priority,
    tags: strings(input.tags),
    description: String(input.description ?? title),
    ...(criteria === undefined
      ? {}
      : { acceptanceCriteria: Array.isArray(criteria) ? criteria.map(String) : String(criteria) }),
    ...(notes === undefined ? {} : { notes: String(notes) }),
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

/**
 * Top-level scalar frontmatter fields; double-quoted values are read as JSON strings.
 * @param {string} text
 * @param {string} filePath
 */
function frontmatter(text, filePath) {
  const block = /^---\n([\s\S]*?)\n---/u.exec(text.replace(/\r\n/gu, '\n'))?.[1] ?? '';
  /** @type {Record<string, string>} */
  const fields = {};
  for (const line of block.split('\n')) {
    const match = /^(\w+):\s*(.*)$/u.exec(line);
    if (!match) continue;
    const value = match[2].trim();
    if (!value.startsWith('"')) {
      fields[match[1]] = value.replace(/^'(.*)'$/u, '$1');
      continue;
    }
    try {
      fields[match[1]] = String(JSON.parse(value));
    } catch (error) {
      throw new Error(
        `${filePath}: frontmatter field "${match[1]}" is not a valid quoted string: ${/** @type {Error} */ (error).message}`,
      );
    }
  }
  return fields;
}

/** @type {typeof import('./backlog-item.d.mts').listOpenBacklog} */
export async function listOpenBacklog(projectDir) {
  const { backlogDir } = await projectBacklog(projectDir);
  let names;
  try {
    names = await readdir(backlogDir);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return [];
    throw error;
  }
  const items = [];
  for (const name of names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const match = /^([A-Z]+-\d{3,})-.+\.md$/u.exec(name);
    if (!match) continue;
    const filePath = join(backlogDir, name);
    const fields = frontmatter(await readFile(filePath, 'utf8'), filePath);
    const status = fields.status ?? 'open';
    if (CLOSED_STATUSES.has(status)) continue;
    items.push({
      id: fields.id ?? match[1],
      title: fields.title ?? name.slice(match[1].length + 1, -3).replace(/-/g, ' '),
      status,
      path: relativePath(projectDir, filePath),
    });
  }
  return items;
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
  'Usage: backlog-item.mjs add --project <dir> --data <file|->\n       backlog-item.mjs list --project <dir> --open\n';

/** @param {string[]} argv */
async function main(argv) {
  const [command, ...rest] = argv;
  /** @type {Record<string, string | boolean>} */
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === '--open') options.open = true;
    else if (flag === '--project' || flag === '--data')
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
    process.stdout.write(`${JSON.stringify({ items: await listOpenBacklog(projectDir) })}\n`);
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
