import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const CAPSULE_SCHEMA_VERSION = '1.0.0';

const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 256,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
});
const SECRET_NAME =
  /^(?:\.env(?:\..*)?|\.envrc|\.netrc|\.git-credentials|\.npmrc|\.pypirc|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|credentials(?:\.[^.]+)?|service[-_]?account(?:\.[^.]+)?|.*\.(?:pem|p12|pfx|key|tfvars)(?:\.json)?)$/iu;
const SECRET_SEGMENT = /^(?:\.ssh|\.aws|\.gnupg|\.kube)$/iu;
const SECRET_VALUE =
  /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}\b|"private_key"\s*:\s*"-----BEGIN/iu;
const SECRET_ASSIGNMENT =
  /(?:^|[^A-Za-z0-9_])(?:[A-Za-z_][A-Za-z0-9_-]*?)?(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|CLIENT[_-]?SECRET|PRIVATE[_-]?KEY|PASSWORD|TOKEN|SECRET(?:[_-]?KEY)?)["']?\s*[:=]\s*(["'`])((?:(?!\1|\$\{)[^\r\n\\]|\\.){16,})\1/giu;
const SECRET_CONFIG_ASSIGNMENT =
  /^[ \t]*(?:export[ \t]+)?(?:[A-Za-z_][A-Za-z0-9_-]*?)?(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|CLIENT[_-]?SECRET|PRIVATE[_-]?KEY|PASSWORD|TOKEN|SECRET(?:[_-]?KEY)?)[ \t]*[:=][ \t]*(?!process\.env(?:\.|\[)|import\.meta\.env(?:\.|\[)|Deno\.env\.|os\.environ|env\.)([^\s"'`#()\[\]{}$]{16,})[ \t]*(?:#[^\r\n]*)?\r?$/gimu;
const CREDENTIAL_PLACEHOLDER =
  /^(?:example(?:[-_].*)?|placeholder(?:[-_].*)?|your[-_].*|(?:change|replace)[-_]me(?:[-_].*)?|(?:dummy|fake|mock|test|never[-_]return)[-_](?:api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret|password|token|secret(?:[-_]?key)?))$/iu;
const TASK_ID = /^(?:T|TASK|QT)-\d{3,}$/u;
const STORY_ID = /^US-\d{3,}$/u;
const SPEC_ID = /^SPEC-\d{3,}$/u;
const FEATURE_ID = /^FEAT-\d{3,}$/u;
const EPIC_ID = /^EPIC-\d{3,}$/u;

export class CapsuleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CapsuleError';
    this.code = code;
    this.details = details;
  }
}

function relativePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    value.includes('\\') ||
    isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value)
  ) {
    throw new CapsuleError(
      'E_CAPSULE_PATH',
      'A source path must be a repository-relative file path.',
    );
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new CapsuleError(
      'E_CAPSULE_PATH',
      'A source path contains an empty or traversing segment.',
    );
  }
  return parts.join('/');
}

function within(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function isSecretPath(path) {
  const parts = path.split('/');
  return parts.some((part) => SECRET_SEGMENT.test(part)) || SECRET_NAME.test(parts.at(-1));
}

export function containsSecret(bytes) {
  const content = bytes.toString('utf8');
  if (SECRET_VALUE.test(content)) return true;
  for (const match of content.matchAll(SECRET_ASSIGNMENT))
    if (!CREDENTIAL_PLACEHOLDER.test(match[2])) return true;
  for (const match of content.matchAll(SECRET_CONFIG_ASSIGNMENT))
    if (!CREDENTIAL_PLACEHOLDER.test(match[1])) return true;
  return false;
}

export function assertCredentialFreeText(
  value,
  { code = 'E_CAPSULE_SECRET', label = 'Input' } = {},
) {
  if (typeof value !== 'string')
    throw new CapsuleError('E_CAPSULE_INPUT', `${label} must be text.`);
  if (containsSecret(Buffer.from(value, 'utf8')))
    throw new CapsuleError(
      code,
      `${label} contains credential material; use native configuration or credential environment references instead.`,
    );
  return value;
}

function scalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'"))
    return trimmed.slice(1, -1).replace(/''/gu, "'");
  return trimmed.replace(/\s+#.*$/u, '').trim();
}

function metadata(bytes, path) {
  const text = bytes.toString('utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
  if (!match)
    throw new CapsuleError(
      'E_CAPSULE_FRONTMATTER',
      `Required planning artifact has no frontmatter: ${path}`,
      { path },
    );
  const lines = match[1].split(/\r?\n/u);
  const result = {};
  for (let index = 0; index < lines.length; index += 1) {
    const field = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/u.exec(lines[index]);
    if (!field) continue;
    const [, key, raw] = field;
    if (raw.trim().startsWith('[')) {
      try {
        result[key] = JSON.parse(raw.trim());
      } catch {
        const inline = raw.trim();
        if (!inline.endsWith(']'))
          throw new CapsuleError(
            'E_CAPSULE_FRONTMATTER',
            `Malformed inline list in ${path}: ${key}`,
            { path, key },
          );
        result[key] = inline.slice(1, -1).trim() ? inline.slice(1, -1).split(',').map(scalar) : [];
      }
      continue;
    }
    if (raw.trim()) {
      result[key] = scalar(raw);
      continue;
    }
    const values = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const item = /^\s{2,}-\s+(.+)$/u.exec(lines[cursor]);
      if (!item) break;
      const value = scalar(item[1]);
      if (typeof value === 'string') values.push(value);
      cursor += 1;
    }
    if (values.length) {
      result[key] = values;
      index = cursor - 1;
    }
  }
  return result;
}

async function entries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function planningDirectories(projectRoot, kind) {
  const planning = join(projectRoot, '.planr');
  const specs = (await entries(join(planning, 'specs')))
    .filter(
      (entry) => entry.isDirectory() && SPEC_ID.test(entry.name.split('-').slice(0, 2).join('-')),
    )
    .map((entry) => join(planning, 'specs', entry.name));
  if (kind === 'task')
    return [
      join(planning, 'tasks'),
      join(planning, 'quick'),
      ...specs.map((path) => join(path, 'tasks')),
    ];
  if (kind === 'story')
    return [join(planning, 'stories'), ...specs.map((path) => join(path, 'stories'))];
  if (kind === 'spec') return specs;
  if (kind === 'feature') return [join(planning, 'features')];
  if (kind === 'epic') return [join(planning, 'epics')];
  if (kind === 'adr') return [join(planning, 'adrs')];
  return [];
}

function artifactId(selector, kind) {
  const value = String(selector ?? '');
  const pattern = {
    task: TASK_ID,
    story: STORY_ID,
    spec: SPEC_ID,
    feature: FEATURE_ID,
    epic: EPIC_ID,
    adr: /^ADR-\d{3,}$/u,
  }[kind];
  if (!pattern?.test(value))
    throw new CapsuleError('E_CAPSULE_SELECTOR', `Invalid ${kind} selector: ${value}`, {
      selector: value,
    });
  return value;
}

export async function resolvePlanningArtifact(repositoryRoot, selector, kind = 'task') {
  const root = await realpath(repositoryRoot);
  const searched = await planningDirectories(root, kind);
  const byPath = String(selector).includes('/');
  if (byPath) relativePath(String(selector));
  const id = byPath
    ? basename(String(selector)).match(
        /^(?:T|TASK|QT|US|SPEC|FEAT|EPIC|ADR)-\d{3,}(?=-|\.md$)/u,
      )?.[0]
    : artifactId(selector, kind);
  if (!id) throw new CapsuleError('E_CAPSULE_SELECTOR', `Invalid ${kind} selector.`, { selector });
  artifactId(id, kind);
  const candidates = [];
  for (const directory of searched) {
    for (const entry of await entries(directory)) {
      if (
        !entry.isFile() ||
        !entry.name.endsWith('.md') ||
        (!entry.name.startsWith(`${id}-`) && entry.name !== `${id}.md`)
      )
        continue;
      const path = relative(root, join(directory, entry.name)).split(sep).join('/');
      if (!byPath || path === selector) candidates.push(path);
    }
  }
  if (candidates.length !== 1) {
    const code = candidates.length ? 'E_CAPSULE_AMBIGUOUS' : 'E_CAPSULE_NOT_FOUND';
    throw new CapsuleError(code, `${kind} selector ${id} resolved to ${candidates.length} files.`, {
      selector: id,
      searched: searched.map((path) => relative(root, path).split(sep).join('/')),
      candidates,
    });
  }
  return candidates[0];
}

function validatedLimits(limits = {}) {
  const value = { ...DEFAULT_LIMITS, ...limits };
  if (Object.values(value).some((number) => !Number.isSafeInteger(number) || number < 1)) {
    throw new CapsuleError('E_CAPSULE_LIMIT', 'Capsule limits must be positive integers.');
  }
  return value;
}

async function sourceRoots(repositoryRoot, readOnlyRepositories) {
  const project = await realpath(repositoryRoot);
  const roots = new Map([['project', { physical: project, planning: null }]]);
  try {
    roots.get('project').planning = await realpath(join(project, '.planr'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const source of readOnlyRepositories) {
    if (
      !source ||
      !/^[a-z][a-z0-9-]*$/u.test(source.repositoryKey) ||
      roots.has(source.repositoryKey)
    ) {
      throw new CapsuleError(
        'E_CAPSULE_SOURCE',
        'Read-only repository keys must be unique, lower-case identifiers distinct from project.',
      );
    }
    roots.set(source.repositoryKey, { physical: await realpath(source.root), planning: null });
  }
  return roots;
}

function requestedFile(value, fallbackRequired = true) {
  if (typeof value === 'string')
    return {
      repositoryKey: 'project',
      path: value,
      required: fallbackRequired,
      role: 'selected-source',
    };
  if (!value || typeof value !== 'object')
    throw new CapsuleError(
      'E_CAPSULE_SOURCE',
      'A selected source must be a path or file selection.',
    );
  if (value.role !== undefined && !/^[a-z][a-z0-9-]{0,63}$/u.test(value.role)) {
    throw new CapsuleError(
      'E_CAPSULE_SOURCE',
      'A selected source role must be a short lower-case identifier.',
    );
  }
  if (value.required !== undefined && typeof value.required !== 'boolean') {
    throw new CapsuleError('E_CAPSULE_SOURCE', 'A selected source required flag must be Boolean.');
  }
  return {
    repositoryKey: value.repositoryKey ?? 'project',
    path: value.path,
    required: value.required ?? fallbackRequired,
    role: value.role ?? 'selected-source',
  };
}

export async function buildContextCapsule({
  repositoryRoot,
  taskSelector,
  request,
  selectedFiles = [],
  optionalFiles = [],
  readOnlyRepositories = [],
  limits,
} = {}) {
  if (!repositoryRoot) throw new CapsuleError('E_CAPSULE_SOURCE', 'repositoryRoot is required.');
  if (request !== undefined && typeof request !== 'string')
    throw new CapsuleError('E_CAPSULE_INPUT', 'A direct request must be text.');
  if (Boolean(taskSelector) === Boolean(request?.trim())) {
    throw new CapsuleError(
      'E_CAPSULE_INPUT',
      'Provide exactly one task selector or direct request.',
    );
  }
  if (
    !Array.isArray(selectedFiles) ||
    !Array.isArray(optionalFiles) ||
    !Array.isArray(readOnlyRepositories)
  ) {
    throw new CapsuleError('E_CAPSULE_INPUT', 'Source selections must be arrays.');
  }
  for (const raw of selectedFiles) {
    if (!requestedFile(raw).required)
      throw new CapsuleError(
        'E_CAPSULE_REQUIRED',
        'Selected source files are required; use optionalFiles only for genuinely optional context.',
      );
  }
  const requiredSelections = new Set(
    selectedFiles.map((raw) => {
      const selected = requestedFile(raw);
      return `${selected.repositoryKey}:${relativePath(selected.path)}`;
    }),
  );
  for (const raw of optionalFiles) {
    const selected = requestedFile(raw, false);
    if (requiredSelections.has(`${selected.repositoryKey}:${relativePath(selected.path)}`))
      throw new CapsuleError(
        'E_CAPSULE_REQUIRED',
        'A required source cannot also be listed as optional.',
      );
  }
  const bounds = validatedLimits(limits);
  if (request && Buffer.byteLength(request, 'utf8') > bounds.maxFileBytes) {
    throw new CapsuleError('E_CAPSULE_LIMIT', 'The direct request exceeds the capsule text limit.');
  }
  if (request && containsSecret(Buffer.from(request, 'utf8'))) {
    throw new CapsuleError('E_CAPSULE_SECRET', 'The direct request contains credential material.');
  }
  const roots = await sourceRoots(repositoryRoot, readOnlyRepositories);
  const project = roots.get('project').physical;
  const files = [];
  const omissions = [];
  const seen = new Map();
  const omitted = new Set();
  let totalBytes = 0;

  async function add(selection) {
    const { repositoryKey, required, role } = selection;
    const path = relativePath(selection.path);
    const root = roots.get(repositoryKey);
    if (!root)
      throw new CapsuleError('E_CAPSULE_SOURCE', `Unknown read-only source: ${repositoryKey}`, {
        repositoryKey,
      });
    const key = `${repositoryKey}:${path}`;
    if (seen.has(key)) {
      const prior = files[seen.get(key)];
      if (required) prior.required = true;
      if (!prior.roles.includes(role)) prior.roles.push(role);
      return prior;
    }
    const optionalOmission = (reason) => {
      if (required) throw new CapsuleError(reason.code, reason.message, { repositoryKey, path });
      if (!omitted.has(key)) {
        omissions.push({ repositoryKey, path, role, reason: reason.code });
        omitted.add(key);
      }
      return null;
    };
    if (isSecretPath(path))
      return optionalOmission({
        code: 'E_CAPSULE_SECRET',
        message: `Secret-like source path cannot enter the capsule: ${path}`,
      });
    const logical = resolve(root.physical, path);
    const allowed =
      repositoryKey === 'project' && path.startsWith('.planr/') ? root.planning : root.physical;
    if (!allowed)
      return optionalOmission({
        code: 'E_CAPSULE_NOT_FOUND',
        message: `Required planning root is missing for ${path}`,
      });
    let physical;
    try {
      physical = await realpath(logical);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EACCES') {
        return optionalOmission({
          code: error.code === 'ENOENT' ? 'E_CAPSULE_NOT_FOUND' : 'E_CAPSULE_UNREADABLE',
          message: `Required source cannot be read: ${path}`,
        });
      }
      throw error;
    }
    if (!within(allowed, physical))
      return optionalOmission({
        code: 'E_CAPSULE_PATH',
        message: `Source escapes its allowed root: ${path}`,
      });
    if (isSecretPath(relative(allowed, physical).split(sep).join('/')))
      return optionalOmission({
        code: 'E_CAPSULE_SECRET',
        message: `Secret-like physical source cannot enter the capsule: ${path}`,
      });
    let file;
    try {
      file = await stat(physical);
    } catch (error) {
      if (error.code === 'EACCES' || error.code === 'ENOENT') {
        return optionalOmission({
          code: 'E_CAPSULE_UNREADABLE',
          message: `Required source cannot be read: ${path}`,
        });
      }
      throw error;
    }
    if (!file.isFile())
      return optionalOmission({
        code: 'E_CAPSULE_NOT_FILE',
        message: `Required source is not a regular file: ${path}`,
      });
    if (
      file.size > bounds.maxFileBytes ||
      files.length >= bounds.maxFiles ||
      totalBytes + file.size > bounds.maxTotalBytes
    ) {
      return optionalOmission({
        code: 'E_CAPSULE_LIMIT',
        message: `Required source exceeds capsule limits: ${path}`,
      });
    }
    let bytes;
    try {
      bytes = await readFile(physical);
    } catch (error) {
      if (error.code === 'EACCES' || error.code === 'ENOENT')
        return optionalOmission({
          code: 'E_CAPSULE_UNREADABLE',
          message: `Required source cannot be read: ${path}`,
        });
      throw error;
    }
    if (bytes.length > bounds.maxFileBytes || totalBytes + bytes.length > bounds.maxTotalBytes) {
      return optionalOmission({
        code: 'E_CAPSULE_LIMIT',
        message: `Required source exceeds capsule limits: ${path}`,
      });
    }
    if (containsSecret(bytes))
      return optionalOmission({
        code: 'E_CAPSULE_SECRET',
        message: `Credential material detected in source: ${path}`,
      });
    const copy = {
      repositoryKey,
      path,
      roles: [role],
      required: Boolean(required),
      bytes: bytes.length,
      contentBase64: bytes.toString('base64'),
    };
    seen.set(key, files.length);
    files.push(copy);
    totalBytes += bytes.length;
    return copy;
  }

  async function addDiscovered(path, role, declared = false) {
    let present = false;
    try {
      await lstat(resolve(project, relativePath(path)));
      present = true;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new CapsuleError(
          'E_CAPSULE_UNREADABLE',
          `Discovered context cannot be inspected: ${path}`,
          { path },
        );
      }
    }
    if (!present && !declared) return null;
    return add({ repositoryKey: 'project', path, required: declared || present, role });
  }

  async function requiredArtifact(selector, kind, role) {
    const path = await resolvePlanningArtifact(project, selector, kind);
    const copy = await add({ repositoryKey: 'project', path, required: true, role });
    const bytes = Buffer.from(copy.contentBase64, 'base64');
    const meta = metadata(bytes, path);
    const expectedId = String(selector).includes('/')
      ? basename(path).match(/^(?:T|TASK|QT|US|SPEC|FEAT|EPIC|ADR)-\d{3,}/u)?.[0]
      : selector;
    if (meta.id !== expectedId) {
      throw new CapsuleError(
        'E_CAPSULE_LINK',
        `Planning artifact ID does not match its selector: ${path}`,
        { selector, path },
      );
    }
    return { path, meta, bytes };
  }

  let task = null;
  let story = null;
  let spec = null;
  if (taskSelector) {
    task = await requiredArtifact(taskSelector, 'task', 'task');
    if (task.meta.storyId)
      story = await requiredArtifact(
        artifactId(task.meta.storyId, 'story'),
        'story',
        'parent-story',
      );
    const specId = task.meta.specId || story?.meta.specId;
    if (task.meta.specId && story?.meta.specId && task.meta.specId !== story.meta.specId) {
      throw new CapsuleError('E_CAPSULE_LINK', 'Task and story disagree on their specification.', {
        task: task.path,
        story: story.path,
      });
    }
    if (specId)
      spec = await requiredArtifact(artifactId(specId, 'spec'), 'spec', 'parent-specification');
    const featureId = task.meta.featureId || story?.meta.featureId;
    let feature = null;
    if (featureId)
      feature = await requiredArtifact(
        artifactId(featureId, 'feature'),
        'feature',
        'parent-feature',
      );
    if (feature?.meta.epicId)
      await requiredArtifact(artifactId(feature.meta.epicId, 'epic'), 'epic', 'parent-epic');
    if (story) {
      const gherkin = `${dirname(story.path)}/${story.meta.id}-gherkin.feature`;
      const declared = story.bytes.toString('utf8').includes(`${story.meta.id}-gherkin.feature`);
      await addDiscovered(gherkin, 'acceptance-gherkin', declared);
    }
    if (task.meta.dependsOn !== undefined && !Array.isArray(task.meta.dependsOn)) {
      throw new CapsuleError('E_CAPSULE_LINK', `Task dependencies must be a list: ${task.path}`, {
        path: task.path,
      });
    }
    if (Array.isArray(task.meta.dependsOn)) {
      for (const dependency of task.meta.dependsOn) {
        const prior = await requiredArtifact(
          artifactId(dependency, 'task'),
          'task',
          'declared-dependency',
        );
        if (
          prior.meta.producedInterfaces !== undefined &&
          !Array.isArray(prior.meta.producedInterfaces)
        ) {
          throw new CapsuleError(
            'E_CAPSULE_LINK',
            `Dependency interfaces must be a path list: ${prior.path}`,
            { path: prior.path },
          );
        }
        for (const path of prior.meta.producedInterfaces ?? []) {
          await add({
            repositoryKey: 'project',
            path,
            required: true,
            role: 'dependency-interface',
          });
        }
      }
    }
    if (spec?.meta.tech_dependencies !== undefined && !Array.isArray(spec.meta.tech_dependencies)) {
      throw new CapsuleError(
        'E_CAPSULE_LINK',
        `Specification dependencies must be a list: ${spec.path}`,
        { path: spec.path },
      );
    }
    if (Array.isArray(spec?.meta.tech_dependencies)) {
      for (const dependency of spec.meta.tech_dependencies) {
        if (SPEC_ID.test(dependency))
          await requiredArtifact(dependency, 'spec', 'specification-dependency');
        // Other tech_dependencies are informational technology names, not file references.
      }
    }
    const adrIds = new Set(
      [task, story, spec]
        .filter(Boolean)
        .flatMap((artifact) =>
          [...artifact.bytes.toString('utf8').matchAll(/\bADR-\d{3,}\b/gu)].map(
            (match) => match[0],
          ),
        ),
    );
    for (const id of adrIds) {
      const path = await resolvePlanningArtifact(project, id, 'adr');
      await add({ repositoryKey: 'project', path, required: true, role: 'architecture-decision' });
    }
  }

  for (const path of [
    'AGENTS.md',
    'CLAUDE.md',
    '.planr/rules.md',
    'input/tech/stack.md',
    'output/db/schema.json',
  ]) {
    await addDiscovered(
      path,
      path.includes('schema') ? 'database-context' : 'repository-instructions',
    );
  }
  if (spec) {
    const design = `${dirname(spec.path)}/design/design-spec.md`;
    await addDiscovered(design, 'design-context');
  }
  for (const raw of selectedFiles) await add(requestedFile(raw));
  const requirementsText = [
    request,
    task?.bytes?.toString('utf8'),
    story?.bytes?.toString('utf8'),
    spec?.bytes?.toString('utf8'),
  ]
    .filter(Boolean)
    .join('\n');
  for (const raw of optionalFiles) {
    const selection = requestedFile(raw, false);
    if (requirementsText.includes(selection.path))
      throw new CapsuleError(
        'E_CAPSULE_REQUIRED',
        `A source named in the request or planning requirements cannot be optional: ${selection.path}`,
        { path: selection.path },
      );
    await add(selection);
  }

  // Include instructions nearest to each selected project source without importing unrelated project files.
  for (const copy of [...files]) {
    if (copy.repositoryKey !== 'project' || copy.path.startsWith('.planr/')) continue;
    let directory = dirname(copy.path);
    while (directory !== '.') {
      for (const name of ['AGENTS.md', 'CLAUDE.md']) {
        await addDiscovered(`${directory}/${name}`, 'repository-instructions');
      }
      directory = dirname(directory);
    }
  }

  const inventory = files.map(({ repositoryKey, path, roles, required, bytes }) => ({
    repositoryKey,
    path,
    roles,
    required,
    bytes,
  }));
  const brief = task
    ? `Implement ${task.meta.id ?? taskSelector}: ${task.meta.title ?? basename(task.path)}. Read the complete copied task, parent artifacts, dependencies and selected sources in the inventory; the brief does not replace them.`
    : 'Implement the complete direct request in the request field. Read the copied repository context and selected sources in the inventory; this brief does not replace them.';
  return {
    kind: 'openplanr-delegation-context-capsule',
    schemaVersion: CAPSULE_SCHEMA_VERSION,
    mode: task ? 'task' : 'direct-request',
    selector: task?.meta.id ?? null,
    request: task ? null : request,
    brief,
    inventory,
    files,
    omissions,
    planning: {
      logicalPath: join(project, '.planr'),
      physicalPath: roots.get('project').planning,
      linked: Boolean(
        roots.get('project').planning && roots.get('project').planning !== join(project, '.planr'),
      ),
      updatePolicy: 'report-only',
    },
    sourceKeys: [...roots.keys()],
    readingOrder: [...inventory]
      .sort((a, b) => {
        const rank = (entry) =>
          !entry.required
            ? 3
            : entry.roles.includes('repository-instructions')
              ? 0
              : entry.roles.some((role) =>
                    [
                      'task',
                      'story',
                      'specification',
                      'acceptance-gherkin',
                      'architecture-decision',
                      'dependency',
                    ].includes(role),
                  )
                ? 1
                : 2;
        return rank(a) - rank(b);
      })
      .map(({ repositoryKey, path }) => `${repositoryKey}/${path}`),
  };
}

export function previewContextCapsule(capsule) {
  if (
    capsule?.kind !== 'openplanr-delegation-context-capsule' ||
    capsule.schemaVersion !== CAPSULE_SCHEMA_VERSION
  ) {
    throw new CapsuleError('E_CAPSULE_FORMAT', 'Unsupported context capsule.');
  }
  return {
    mode: capsule.mode,
    selector: capsule.selector,
    inventory: capsule.inventory,
    omissions: capsule.omissions,
    blockers: [],
    planning: capsule.planning ?? null,
    sourceKeys: capsule.sourceKeys,
  };
}

export async function writeContextCapsule(capsule, { directory, repositoryRoot }) {
  previewContextCapsule(capsule);
  if (!directory || !repositoryRoot)
    throw new CapsuleError(
      'E_CAPSULE_OUTPUT',
      'A private directory and repository root are required.',
    );
  const project = await realpath(repositoryRoot);
  const output = resolve(directory);
  if (within(project, output))
    throw new CapsuleError(
      'E_CAPSULE_OUTPUT',
      'A private capsule cannot be written inside the source repository.',
    );
  const parent = await realpath(dirname(output));
  if (within(project, parent))
    throw new CapsuleError(
      'E_CAPSULE_OUTPUT',
      'A private capsule cannot be written through a source-repository symlink.',
    );
  await mkdir(output, { mode: 0o700 });
  const physical = await realpath(output);
  if (within(project, physical))
    throw new CapsuleError(
      'E_CAPSULE_OUTPUT',
      'A private capsule cannot be written inside the source repository.',
    );
  const mirror = decodedMirror(capsule);
  const mirrorRoot = join(physical, 'readable');
  await mkdir(mirrorRoot, { mode: 0o700 });
  for (const entry of mirror) {
    const target = join(mirrorRoot, entry.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, entry.bytes, { flag: 'wx', mode: 0o600 });
  }
  capsule.mirror = {
    version: 1,
    files: mirror.map(({ path, bytes }) => ({
      path,
      bytes: bytes.length,
      digest: mirrorDigest(bytes),
    })),
  };
  const path = join(physical, 'capsule.json');
  await writeFile(path, `${JSON.stringify(capsule)}\n`, { flag: 'wx', mode: 0o600 });
  return path;
}

function mirrorDigest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function decodedMirror(capsule) {
  const files = capsule.files.map((file) => {
    if (!/^[a-z][a-z0-9-]*$/u.test(file.repositoryKey))
      throw new CapsuleError('E_CAPSULE_MIRROR', 'Invalid repository key in decoded context.');
    return {
      path: `${file.repositoryKey}/${relativePath(file.path)}`,
      bytes: Buffer.from(file.contentBase64, 'base64'),
    };
  });
  files.push({
    path: 'request.md',
    bytes: Buffer.from(`${capsule.brief}\n\n${capsule.request ?? ''}\n`, 'utf8'),
  });
  files.push({
    path: 'index.json',
    bytes: Buffer.from(
      `${JSON.stringify(
        {
          kind: 'openplanr-readable-delegation-context',
          version: 1,
          mode: capsule.mode,
          selector: capsule.selector,
          request: 'request.md',
          inventory: capsule.inventory.map((file) => ({
            ...file,
            readablePath: `${file.repositoryKey}/${file.path}`,
          })),
          omissions: capsule.omissions,
          ...(capsule.readingOrder ? { readingOrder: capsule.readingOrder } : {}),
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
  });
  return files;
}

// The serialized capsule covers this manifest; verify decoded files before any launch.
export async function validateContextMirror(capsulePath, capsule) {
  if (!capsule.mirror) return { status: 'not-present', directory: null };
  const expected = decodedMirror(capsule);
  const manifest = expected.map(({ path, bytes }) => ({
    path,
    bytes: bytes.length,
    digest: mirrorDigest(bytes),
  }));
  if (
    capsule.mirror.version !== 1 ||
    JSON.stringify(capsule.mirror.files) !== JSON.stringify(manifest)
  )
    throw new CapsuleError(
      'E_CAPSULE_MIRROR',
      'Decoded context manifest differs from its capsule.',
    );
  const root = join(dirname(capsulePath), 'readable');
  const observed = [];
  async function walk(directory, prefix = '') {
    const folder = await lstat(directory);
    if (
      !folder.isDirectory() ||
      (folder.mode & 0o077) !== 0 ||
      (process.getuid && folder.uid !== process.getuid())
    )
      throw new CapsuleError(
        'E_CAPSULE_MIRROR',
        'Decoded context directory is not private or changed.',
      );
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(join(directory, entry.name), `${path}/`);
      else if (entry.isFile()) {
        const location = join(directory, entry.name);
        const item = await lstat(location);
        if (
          !item.isFile() ||
          (item.mode & 0o077) !== 0 ||
          (process.getuid && item.uid !== process.getuid())
        )
          throw new CapsuleError('E_CAPSULE_MIRROR', 'Decoded context file is not private.', {
            path,
          });
        const bytes = await readFile(location);
        observed.push({ path, bytes: bytes.length, digest: mirrorDigest(bytes) });
      } else
        throw new CapsuleError(
          'E_CAPSULE_MIRROR',
          'Decoded context must contain only regular files.',
          { path },
        );
    }
  }
  try {
    await walk(root);
  } catch (error) {
    if (error instanceof CapsuleError) throw error;
    throw new CapsuleError('E_CAPSULE_MIRROR', 'Decoded context cannot be read.', {
      cause: error.code ?? 'unknown',
    });
  }
  const sorted = (values) => values.slice().sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(sorted(observed)) !== JSON.stringify(sorted(manifest)))
    throw new CapsuleError(
      'E_CAPSULE_MIRROR',
      'Decoded context was changed, omitted, or extended.',
    );
  return { status: 'verified', directory: root, indexPath: join(root, 'index.json') };
}
