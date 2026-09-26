import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildContextEnvelope, renderContextEnvelope } from './context-envelope.mjs';
import { resolveDesignPlanningLineage } from './design-lineage.mjs';
import { preparePlan, prepareShipContext } from './engine.mjs';
import { PipelineError } from './errors.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TASK_FILE = /^(?:T-|task-).*\.md$/iu;
const MAX_CONTEXT_FILES = 500;
const STACK_HOST_ROOTS = Object.freeze(['.claude', '.codex', '.cursor']);

/** Returns the trimmed body of one `## Heading` section, or '' when absent. */
function section(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'mu');
  return (pattern.exec(markdown)?.[1] ?? '').trim();
}

/**
 * Reads a Markdown bullet list, joining wrapped continuation lines.
 *
 * Acceptance criteria are routinely wrapped across lines; taking only the first line
 * truncates them at exactly the clause that carries the assertion.
 */
function bullets(body, limit = 60) {
  const entries = [];
  for (const line of body.split('\n')) {
    const start = /^\s*(?:[-*]|\d+\.)\s+(.*)$/u.exec(line);
    if (start) {
      entries.push(start[1].trim());
      continue;
    }
    const continuation = /^\s+(\S.*)$/u.exec(line);
    if (continuation && entries.length) entries[entries.length - 1] += ` ${continuation[1].trim()}`;
    else if (!line.trim()) continue;
    else if (entries.length) break;
  }
  return entries
    .filter((entry) => entry && entry.length > 1)
    .map((entry) => entry.replace(/\s+/gu, ' '))
    .slice(0, limit);
}

function firstParagraph(body) {
  for (const block of body.split(/\n{2,}/u)) {
    const text = block.trim().replace(/\s+/gu, ' ');
    if (text && !text.startsWith('#') && !text.startsWith('|')) return text;
  }
  return '';
}

function compact(value, max = 2_400) {
  const normalized = String(value ?? '')
    .replace(/^---[\s\S]*?---\s*/u, '')
    .replace(/```[^\n]*\n?/gu, '')
    .replace(/```/gu, '')
    .replace(/^#{1,6}\s+/gmu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function headingSection(markdown, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const lines = String(markdown).replace(/\r\n/gu, '\n').split('\n');
  for (let start = 0; start < lines.length; start++) {
    const match = /^(#{2,4})\s+(.+?)\s*$/u.exec(lines[start]);
    if (!match || !wanted.has(match[2].toLowerCase())) continue;
    const level = match[1].length;
    let end = start + 1;
    while (end < lines.length) {
      const next = /^(#{1,6})\s+/u.exec(lines[end]);
      if (next && next[1].length <= level) break;
      end += 1;
    }
    return lines
      .slice(start + 1, end)
      .join('\n')
      .trim();
  }
  return '';
}

function sectionEntries(markdown, names, limit = 30) {
  const body = headingSection(markdown, names);
  if (!body) return [];
  const listed = bullets(body, limit).filter((entry) => !/^_?(?:none|n\/a)_?$/iu.test(entry));
  if (listed.length) return listed;
  const paragraph = firstParagraph(body);
  return paragraph ? [paragraph] : [];
}

function unique(values, limit = 200) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function walkRegularFiles(root, output = []) {
  if (!root || !existsSync(root) || output.length >= MAX_CONTEXT_FILES) return output;
  const entries = readdirSync(root, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    if (output.length >= MAX_CONTEXT_FILES) break;
    const path = join(root, entry.name);
    if (entry.isDirectory()) walkRegularFiles(path, output);
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

function readOptional(path, readFile) {
  if (!path || !existsSync(path)) return null;
  try {
    return readFile(path, 'utf8');
  } catch {
    return null;
  }
}

function displayPath(projectRoot, path) {
  const value = relative(projectRoot, path).split('\\').join('/');
  return value || '.';
}

/** Reads one `key:` block of `- value` scalars from task frontmatter. */
function frontmatterList(frontmatter, key) {
  const inline = new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]\\s*$`, 'mu').exec(frontmatter)?.[1];
  if (inline !== undefined) {
    return inline
      .split(',')
      .map((entry) => entry.trim().replace(/^['"]|['"]$/gu, ''))
      .filter(Boolean);
  }
  const lines = frontmatter.split('\n');
  const start = lines.findIndex((line) => line.trimEnd() === `${key}:`);
  if (start < 0) return [];
  const values = [];
  for (const line of lines.slice(start + 1)) {
    const item = /^\s+-\s+"?([^"\n]+?)"?\s*$/u.exec(line);
    if (!item) break;
    values.push(item[1].trim());
  }
  return values;
}

function frontmatterScalar(markdown, key) {
  const frontmatter = markdown.split('---')[1] ?? '';
  return new RegExp(`^${key}:\\s*"?([^"\\n]+)"?\\s*$`, 'mu').exec(frontmatter)?.[1]?.trim() ?? '';
}

/** Reads the `preserve:` block of `{repositoryKey, path}` pairs. */
function frontmatterPreserve(frontmatter) {
  const lines = frontmatter.split('\n');
  const start = lines.findIndex((line) => line.trimEnd() === 'preserve:');
  if (start < 0) return [];
  const entries = [];
  let current;
  for (const line of lines.slice(start + 1)) {
    const repo = /^\s+-\s+repositoryKey:\s*"?([^"\n]+?)"?\s*$/u.exec(line);
    const path = /^\s+path:\s*"?([^"\n]+?)"?\s*$/u.exec(line);
    if (repo) current = { repositoryKey: repo[1] };
    else if (path && current) {
      entries.push({ ...current, path: path[1] });
      current = undefined;
    } else if (!/^\s/u.test(line)) break;
  }
  return entries;
}

function bodyPreserve(markdown) {
  return sectionEntries(markdown, ['Preserve'], 60)
    .map((entry) => {
      const quoted = /^`([^`]+)`/u.exec(entry)?.[1];
      const path = quoted ?? entry.split(/\s+(?:—|-)\s+/u)[0].trim();
      return { repositoryKey: 'project', path };
    })
    .filter(({ path }) => path && !/^_?(?:none|n\/a)_?$/iu.test(path));
}

function frontmatterTitle(markdown) {
  return /^title:\s*"?([^"\n]+)"?\s*$/mu.exec(markdown.split('---')[1] ?? '')?.[1]?.trim() ?? '';
}

function taskArtifact({ path, record = {}, projectRoot, readFile }) {
  const markdown = readFile(path, 'utf8');
  const frontmatter = markdown.split('---')[1] ?? '';
  const id =
    record.id ??
    (frontmatterScalar(markdown, 'id') || path.split('/').at(-1).replace(/\.md$/u, ''));
  const dependsOn = record.dependsOn ?? frontmatterList(frontmatter, 'dependsOn');
  const structuredPreserve = record.structuredPreserve ?? frontmatterPreserve(frontmatter);
  const legacySource =
    Array.isArray(record.legacyPreserve) && record.legacyPreserve.length
      ? record.legacyPreserve
      : bodyPreserve(markdown);
  const legacyPreserve = legacySource.map((entry) =>
    typeof entry === 'string' ? { repositoryKey: 'project', path: entry } : entry,
  );
  return {
    id,
    selector: record.selector ?? id,
    path,
    pathLabel: displayPath(projectRoot, path),
    title: frontmatterTitle(markdown) || id,
    storyId: record.storyId ?? frontmatterScalar(markdown, 'storyId'),
    type: record.type ?? (frontmatterScalar(markdown, 'type') || 'Tech'),
    dependsOn,
    dependencySelectors: record.dependencySelectors ?? dependsOn,
    reviewRisks: record.reviewRisks ?? [],
    browserSurfaces: record.browserSurfaces ?? [],
    acceptanceRefs: record.acceptanceRefs ?? [],
    preserve:
      record.structuredPreserveDeclared === true || structuredPreserve.length
        ? structuredPreserve
        : legacyPreserve,
    markdown,
  };
}

function scopeTaskArtifacts(tasks, mode) {
  if (mode !== 'default') return tasks;
  const scoped = tasks.map((task) => {
    const pathScope = task.pathLabel.includes('/tasks/')
      ? task.pathLabel.slice(0, task.pathLabel.indexOf('/tasks/')).split('/').at(-1)
      : null;
    const scope = task.storyId || pathScope;
    return { ...task, selector: scope ? `${scope}/${task.id}` : task.id, scope };
  });
  const selectors = new Set(scoped.map(({ selector }) => selector));
  return scoped.map((task) => ({
    ...task,
    dependencySelectors: task.dependsOn.map((dependency) =>
      selectors.has(dependency) || !task.scope ? dependency : `${task.scope}/${dependency}`,
    ),
  }));
}

function specDocument({ projectRoot, root, mode, slug, readFile, allowMissing = false }) {
  if (mode === 'default') {
    const path = join(projectRoot, 'input', 'specs', `spec-${slug}.md`);
    const markdown = readOptional(path, readFile);
    if (markdown !== null) return { path, markdown };
  } else if (typeof root === 'string' && existsSync(root)) {
    const entry = readdirSync(root)
      .filter((name) => /^SPEC-\d+.*\.md$/u.test(name))
      .sort()[0];
    if (entry) {
      const path = join(root, entry);
      return { path, markdown: readFile(path, 'utf8') };
    }
  }
  const error = new PipelineError(
    'E_SHIP_CONTEXT_UNREADABLE',
    `No specification document was readable for ${slug}.`,
    mode === 'default'
      ? `Confirm input/specs/spec-${slug}.md exists.`
      : 'Confirm the spec directory contains its SPEC markdown.',
  );
  if (!allowMissing) throw error;
  const path =
    mode === 'default'
      ? join(projectRoot, 'input', 'specs', `spec-${slug}.md`)
      : join(root, `SPEC-NNN-${slug}.md`);
  return {
    path,
    markdown: `# ${slug}\n\n## Context & Goal\n\nNo Planr specification document was available.`,
    diagnostic: {
      code: error.code,
      message: error.message,
      recovery: error.fix,
    },
  };
}

function storyContext({ root, tasks, projectRoot, readFile }) {
  const files = walkRegularFiles(root);
  const requirements = [];
  const acceptanceCriteria = [];
  const startingPoints = [];
  for (const storyId of unique(tasks.map(({ storyId }) => storyId))) {
    const storyPath = files.find(
      (path) =>
        path.endsWith('.md') &&
        !/-gherkin\.feature$/iu.test(path) &&
        frontmatterScalar(readFile(path, 'utf8'), 'id') === storyId,
    );
    if (storyPath) {
      const markdown = readFile(storyPath, 'utf8');
      const statement =
        firstParagraph(headingSection(markdown, ['User Story'])) ||
        firstParagraph(markdown.replace(/^---[\s\S]*?---\s*/u, '').replace(/^#.*$/mu, ''));
      if (statement) requirements.push(`${storyId}: ${compact(statement, 1_200)}`);
      acceptanceCriteria.push(
        ...sectionEntries(markdown, ['Acceptance Criteria', 'Done When'], 30).map(
          (entry) => `${storyId}: ${entry}`,
        ),
      );
      startingPoints.push(`Parent story ${storyId}: ${displayPath(projectRoot, storyPath)}`);
    }
    const gherkinPath = files.find((path) => path.endsWith(`/${storyId}-gherkin.feature`));
    if (gherkinPath) {
      const scenarios = [];
      let current = '';
      for (const line of readFile(gherkinPath, 'utf8').split('\n')) {
        const scenario = /^\s*Scenario(?: Outline)?:\s*(.+)$/iu.exec(line);
        const clause = /^\s*(Given|When|Then|And|But)\s+(.+)$/iu.exec(line);
        if (scenario) {
          if (current) scenarios.push(current);
          current = `Scenario ${scenario[1].trim()}`;
        } else if (clause && current) current += `; ${clause[1]} ${clause[2].trim()}`;
      }
      if (current) scenarios.push(current);
      acceptanceCriteria.push(
        ...scenarios.slice(0, 30).map((entry) => `${storyId}: ${compact(entry, 1_600)}`),
      );
      startingPoints.push(
        `Acceptance scenarios for ${storyId}: ${displayPath(projectRoot, gherkinPath)}`,
      );
    }
  }
  return { requirements, acceptanceCriteria, startingPoints };
}

function activeStackFiles(markdown) {
  const lines = String(markdown).replace(/\r\n/gu, '\n').split('\n');
  const start = lines.findIndex((line) => /^\s*ActiveStackFiles:\s*(?:\[\])?\s*$/u.test(line));
  if (start < 0 || /\[\]/u.test(lines[start])) return [];
  const paths = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^\s+-\s+(.+?)\s*$/u.exec(line);
    if (!match) {
      if (paths.length || /^\s*\w[^:]*:/u.test(line)) break;
      continue;
    }
    paths.push(
      match[1]
        .replace(/\s+#.*$/u, '')
        .trim()
        .replace(/^['"]|['"]$/gu, ''),
    );
  }
  return paths;
}

function logicalStackPath(path) {
  const normalized = String(path).split('\\').join('/').replace(/^\.\//u, '');
  const marker = normalized.indexOf('/stacks/');
  const logical =
    marker >= 0
      ? normalized.slice(marker + '/stacks/'.length)
      : normalized.replace(/^(?:stacks\/|\.?(?:claude|codex|cursor)\/stacks\/)/u, '');
  if (!logical || logical.startsWith('/') || logical.split('/').includes('..')) return null;
  return logical;
}

function stackHostRoot(runtime) {
  const normalized = String(runtime ?? '').toLowerCase();
  return (
    {
      claude: '.claude',
      'claude-code': '.claude',
      codex: '.codex',
      cursor: '.cursor',
    }[normalized] ?? null
  );
}

function declaredStackHostRoot(path) {
  const normalized = String(path).split('\\').join('/').replace(/^\.\//u, '');
  const match = /^(\.(?:claude|codex|cursor))\/stacks\//u.exec(normalized);
  return match?.[1] ?? null;
}

function projectDefaultStackHostRoot(projectRoot, readFile) {
  const config = readOptional(join(projectRoot, '.planr', 'config.json'), readFile);
  if (config === null) return null;
  try {
    return stackHostRoot(JSON.parse(config).defaultAgent);
  } catch {
    return null;
  }
}

function selectStackHostRoot({ projectRoot, declared, runtime, readFile }) {
  const selected = stackHostRoot(runtime) ?? projectDefaultStackHostRoot(projectRoot, readFile);
  if (selected) return selected;

  const declaredHosts = unique(declared.map(declaredStackHostRoot));
  if (declaredHosts.length === 1) return declaredHosts[0];
  if (declaredHosts.length > 1) return null;

  const logicalPaths = declared.map(logicalStackPath).filter(Boolean);
  const hostsWithOverrides = STACK_HOST_ROOTS.filter((hostRoot) =>
    logicalPaths.some((logical) => existsSync(join(projectRoot, hostRoot, 'stacks', logical))),
  );
  return hostsWithOverrides.length === 1 ? hostsWithOverrides[0] : null;
}

function stackContext({ projectRoot, readFile, runtime }) {
  const stackPath = join(projectRoot, 'input', 'tech', 'stack.md');
  const markdown = readOptional(stackPath, readFile);
  if (markdown === null) return { architecture: [], startingPoints: [] };
  const architecture = [
    `Technical stack (${displayPath(projectRoot, stackPath)}): ${compact(markdown)}`,
  ];
  const startingPoints = [`Technical stack: ${displayPath(projectRoot, stackPath)}`];
  const declaredFiles = activeStackFiles(markdown).slice(0, 24);
  const hostRoot = selectStackHostRoot({ projectRoot, declared: declaredFiles, runtime, readFile });
  for (const declared of declaredFiles) {
    const logical = logicalStackPath(declared);
    if (!logical) continue;
    const installed = join(packageRoot, 'stacks', logical);
    const installedBytes = readOptional(installed, readFile);
    if (installedBytes !== null) {
      architecture.push(`Installed stack conventions (${logical}): ${compact(installedBytes)}`);
      startingPoints.push(`Installed stack conventions: planr-pipeline/stacks/${logical}`);
    }

    if (!hostRoot) continue;
    const override = join(projectRoot, hostRoot, 'stacks', logical);
    const overrideBytes = readOptional(override, readFile);
    if (overrideBytes === null) continue;
    architecture.push(
      `Project stack override (${logical}, takes precedence): ${compact(overrideBytes)}`,
    );
    startingPoints.push(`Project stack override: ${displayPath(projectRoot, override)}`);
  }
  return { architecture, startingPoints };
}

function supplementalContext({ projectRoot, root, mode, readFile }) {
  const architecture = [];
  const startingPoints = [];
  const designPath =
    mode === 'spec-driven' ? join(root, 'design', 'design-spec.md') : join(root, 'design-spec.md');
  const design = readOptional(designPath, readFile);
  if (design !== null) {
    architecture.push(
      `Design context (${displayPath(projectRoot, designPath)}): ${compact(design)}`,
    );
    startingPoints.push(`Design context: ${displayPath(projectRoot, designPath)}`);
  }
  const schemaPath = join(projectRoot, 'output', 'db', 'schema.json');
  const schema = readOptional(schemaPath, readFile);
  if (schema !== null) {
    architecture.push(
      `Database schema (${displayPath(projectRoot, schemaPath)}): ${compact(schema, 3_600)}`,
    );
    startingPoints.push(`Database schema: ${displayPath(projectRoot, schemaPath)}`);
  }
  return { architecture, startingPoints };
}

function designLineageContext({ projectRoot, root, tasks, readFile }) {
  const path = join(root, 'design-lineage.json');
  const bytes = readOptional(path, readFile);
  if (bytes === null) return null;
  let resolved;
  try {
    resolved = resolveDesignPlanningLineage({
      root,
      lineage: JSON.parse(bytes),
      taskIds: tasks.map(({ id }) => id),
      readFile,
    });
  } catch (error) {
    return {
      status: 'stale',
      reason: 'invalid-lineage',
      requirements: [],
      sources: [],
      startingPoint: `Design lineage (${displayPath(projectRoot, path)}): stale — ${error.message}`,
    };
  }
  return {
    ...resolved,
    startingPoint: `Design lineage (${displayPath(projectRoot, path)}): ${resolved.status} — ${resolved.reason}.`,
  };
}

/**
 * Maps planning artifacts and repository conventions into bounded working context.
 */
function buildFromArtifacts({
  markdown,
  specPath,
  feature,
  tasks,
  repositories,
  diagnostics = [],
  projectRoot,
  root,
  mode,
  runtime,
  readFile,
  lineageContext = null,
}) {
  const summary = frontmatterTitle(markdown) || String(feature);
  const userValue =
    firstParagraph(section(markdown, 'Context & Goal')) ||
    firstParagraph(section(markdown, 'Audience')) ||
    'Recorded in the specification.';

  const specificationRequirements = [...markdown.matchAll(/^###\s+(FR-[\w.-]+\s+—\s+.+)$/gmu)].map(
    (match) => match[1].trim(),
  );

  const requirements = [...specificationRequirements];
  const acceptanceCriteria = bullets(section(markdown, 'Acceptance Criteria'));
  const architecture = bullets(section(markdown, 'Constraints'));
  const startingPoints = [`Specification: ${displayPath(projectRoot, specPath)}`];
  startingPoints.push(
    ...diagnostics.map(
      ({ code, message, recovery }) =>
        `Context diagnostic ${code}: ${message}${recovery ? ` ${recovery}` : ''}`,
    ),
  );

  for (const task of tasks) {
    const taskLabel = task.selector ?? task.id;
    startingPoints.push(`Task ${taskLabel} (${task.type}): ${task.pathLabel}`);
    const rationale = frontmatterScalar(task.markdown, 'rationale');
    if (rationale) requirements.push(`${taskLabel} rationale: ${compact(rationale, 1_200)}`);
    const objective = firstParagraph(headingSection(task.markdown, ['Objective']));
    if (objective) requirements.push(`${taskLabel} objective: ${compact(objective, 1_600)}`);
    for (const entry of sectionEntries(task.markdown, ['Implementation', 'Technical Spec'], 30)) {
      requirements.push(`${taskLabel} implementation: ${entry}`);
    }
    for (const entry of sectionEntries(task.markdown, ['Create'], 30))
      requirements.push(`${taskLabel} create: ${entry}`);
    for (const entry of sectionEntries(task.markdown, ['Modify'], 30))
      requirements.push(`${taskLabel} modify: ${entry}`);
    for (const entry of sectionEntries(task.markdown, ['Verification', 'Test Requirements'], 30)) {
      acceptanceCriteria.push(`${taskLabel}: ${entry}`);
    }
    for (const entry of sectionEntries(task.markdown, ['Done When', 'Definition of Done'], 30)) {
      acceptanceCriteria.push(`${taskLabel}: ${entry}`);
    }
  }

  const stories = storyContext({ root, tasks, projectRoot, readFile });
  requirements.push(...stories.requirements);
  acceptanceCriteria.push(...stories.acceptanceCriteria);
  startingPoints.push(...stories.startingPoints);

  const stack = stackContext({ projectRoot, readFile, runtime });
  architecture.push(...stack.architecture);
  startingPoints.push(...stack.startingPoints);

  const supplemental = supplementalContext({ projectRoot, root, mode, readFile });
  architecture.push(...supplemental.architecture);
  startingPoints.push(...supplemental.startingPoints);

  if (lineageContext) {
    startingPoints.push(lineageContext.startingPoint);
    if (lineageContext.status === 'current') {
      for (const requirement of lineageContext.requirements) {
        requirements.push(`Design ${requirement.id}: ${requirement.statement}`);
        acceptanceCriteria.push(
          ...requirement.verification.map((entry) => `Design ${requirement.id}: ${entry}`),
        );
      }
      for (const source of lineageContext.sources) {
        architecture.push(`Design source ${source.id} (${source.kind}): ${source.path}`);
      }
    } else {
      architecture.push(
        `Design lineage is ${lineageContext.status}: ${lineageContext.reason}. Treat it as evidence, not current approved scope.`,
      );
    }
  }

  const doNotChange = [
    ...new Set(
      tasks.flatMap((task) =>
        (task.preserve ?? []).map(
          ({ repositoryKey, path }) =>
            `${repositoryKey}: ${path.length > 1 ? path.replace(/\/+$/u, '') : path}`,
        ),
      ),
    ),
  ];

  const dependencies = tasks
    .filter((task) => (task.dependsOn ?? []).length)
    .map((task) => ({
      task: task.selector ?? task.id,
      requires: [...(task.dependencySelectors ?? task.dependsOn)],
    }));

  if (tasks.length)
    startingPoints.unshift(
      `Tasks in scope: ${tasks.map((task) => task.selector ?? task.id).join(', ')}.`,
    );

  return buildContextEnvelope({
    objective: { summary: summary.slice(0, 400), userValue },
    requirements: unique(requirements).length
      ? unique(requirements)
      : [`Implement the requested scope for ${summary}.`],
    acceptanceCriteria: unique(acceptanceCriteria).length
      ? unique(acceptanceCriteria)
      : ['Satisfy the acceptance criteria recorded in the specification.'],
    architecture: unique(architecture),
    risks: bullets(section(markdown, 'Failure Modes')),
    boundaries: { repositories, doNotChange },
    dependencies,
    startingPoints: unique(startingPoints),
    externalActions: sectionEntries(markdown, ['External Actions'], 30),
  });
}

/** Builds the working context for one feature from its SHIP preparation. */
export function buildShipContext({
  projectRoot,
  feature,
  taskId,
  runtime,
  readFile = readFileSync,
} = {}) {
  const prepared = prepareShipContext({ projectRoot, feature, taskId });
  const selected = new Set(
    (prepared.unresolvedTasks ?? []).map(({ id, selector }) => selector ?? id),
  );
  const records = (prepared.allTasks ?? []).filter(({ id, selector }) =>
    selected.has(selector ?? id),
  );
  const tasks = records.map((record) =>
    taskArtifact({ path: record.path, record, projectRoot, readFile }),
  );
  const spec = specDocument({
    projectRoot,
    root: prepared.root,
    mode: prepared.mode,
    slug: prepared.slug ?? feature,
    readFile,
    allowMissing: true,
  });
  const diagnostics = [
    ...(prepared.diagnostics ?? []),
    ...(spec.diagnostic ? [spec.diagnostic] : []),
  ];
  const lineageContext = designLineageContext({
    projectRoot,
    root: prepared.root,
    tasks,
    readFile,
  });
  return buildFromArtifacts({
    markdown: spec.markdown,
    specPath: spec.path,
    feature: prepared.slug ?? feature,
    tasks,
    projectRoot,
    root: prepared.root,
    mode: prepared.mode,
    runtime,
    readFile,
    diagnostics,
    lineageContext,
    repositories: (prepared.repositoryDescriptors ?? []).map(({ repositoryKey, path }) => ({
      name: repositoryKey,
      role: `checked out at ${path}`,
    })),
  });
}

/**
 * Builds the working context for PLAN inspection.
 *
 * Reads the authored task files directly, so this works before the SHIP boundary and
 * shows exactly what a runtime would later receive.
 */
export function buildPlanContext({ projectRoot, feature, runtime, readFile = readFileSync } = {}) {
  const prepared = preparePlan({
    projectRoot,
    feature,
    scaffold: false,
    createStackTemplate: false,
  });
  const root = prepared.mode === 'spec-driven' ? prepared.specDir : prepared.featureDir;
  const taskPaths = walkRegularFiles(root).filter(
    (path) => TASK_FILE.test(path.split('/').at(-1)) && !/error-report/iu.test(path),
  );
  const tasks = scopeTaskArtifacts(
    taskPaths.map((path) => taskArtifact({ path, projectRoot, readFile })),
    prepared.mode,
  );
  const spec = specDocument({
    projectRoot,
    root,
    mode: prepared.mode,
    slug: prepared.slug ?? feature,
    readFile,
  });

  // Ownership comes from the project's declared repositories, the same source SHIP uses.
  // Deriving it from preserve entries instead would hide a repository the plan writes to
  // but happens to protect nothing inside.
  let declared = [];
  try {
    const config = JSON.parse(readFile(join(projectRoot, '.planr', 'config.json'), 'utf8'));
    declared = config.shipClosure?.repositories ?? [];
  } catch {
    declared = [];
  }
  const repositories = declared.length
    ? declared.map(({ repositoryKey, path }) => ({
        name: repositoryKey,
        role: `checked out at ${path}`,
      }))
    : [
        ...new Set(
          tasks.flatMap((task) => task.preserve.map(({ repositoryKey }) => repositoryKey)),
        ),
      ].map((name) => ({ name, role: 'in scope for this plan' }));

  return buildFromArtifacts({
    markdown: spec.markdown,
    specPath: spec.path,
    feature: prepared.slug ?? feature,
    tasks,
    projectRoot,
    root,
    mode: prepared.mode,
    runtime,
    readFile,
    repositories,
  });
}

/** Renders the SHIP working context as host-neutral Markdown. */
export function renderShipContext(options) {
  return renderContextEnvelope(buildShipContext(options));
}

/** Renders the PLAN review context as host-neutral Markdown. */
export function renderPlanContext(options) {
  return renderContextEnvelope(buildPlanContext(options));
}
