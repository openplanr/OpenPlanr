import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import type { ArtifactType, OpenPlanrConfig } from '../../models/types.js';
import {
  addChildReference,
  createArtifact,
  getArtifactDir,
  listArtifacts,
  readArtifact,
  readArtifactRaw,
  resolveArtifactFilename,
  updateArtifactFields,
} from '../../services/artifact-service.js';
import { loadConfig } from '../../services/config-service.js';
import { prepareSprintCreation } from '../../services/sprint-refinement-service.js';
import { renderTemplate } from '../../services/template-service.js';
import { writeFile } from '../../utils/fs.js';
import { display, logger } from '../../utils/logger.js';
import { parseMarkdown } from '../../utils/markdown.js';
import { CliBoundaryError } from '../error-boundary.js';
import { registerSprintRefinementCommands } from './sprint-refinement.js';

type PlanningType = Extract<
  ArtifactType,
  'epic' | 'feature' | 'story' | 'task' | 'quick' | 'backlog' | 'sprint'
>;

const templates: Record<PlanningType, string> = {
  epic: 'epics/epic.md.hbs',
  feature: 'features/feature.md.hbs',
  story: 'stories/user-story.md.hbs',
  task: 'tasks/task-list.md.hbs',
  quick: 'quick/quick-task.md.hbs',
  backlog: 'backlog/backlog-item.md.hbs',
  sprint: 'sprints/sprint.md.hbs',
};

function planningInputError(
  type: PlanningType,
  suffix: string,
  problem: string,
  recovery: string,
  cause?: unknown,
): CliBoundaryError {
  const prefix = type === 'quick' ? 'E_QUICK_INPUT' : 'E_PLANNING_INPUT';
  return new CliBoundaryError(`${prefix}_${suffix}`, problem, { cause, recovery });
}

function markdownInput(raw: string): Record<string, unknown> {
  const title =
    /^#\s+(.+)$/mu.exec(raw)?.[1]?.trim() ??
    raw
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ??
    '';
  return { title, description: raw.trim() };
}

async function readInputData(
  type: PlanningType,
  source?: string,
): Promise<Record<string, unknown>> {
  if (!source) return {};
  let bytes: string;
  try {
    bytes =
      source === '-'
        ? await new Promise<string>((resolveInput, reject) => {
            let value = '';
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', (chunk) => {
              value += chunk;
            });
            process.stdin.on('end', () => resolveInput(value));
            process.stdin.on('error', reject);
          })
        : await readFile(path.resolve(source), 'utf8');
  } catch (cause) {
    throw planningInputError(
      type,
      'FILE_UNREADABLE',
      `The ${type} input file could not be read.`,
      'Provide one readable regular file, or use - for bounded stdin.',
      cause,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch (cause) {
    if (type === 'quick') return markdownInput(bytes);
    throw planningInputError(
      type,
      'INVALID',
      'Planning artifact input must be one JSON object.',
      'Provide a bounded JSON object with at least a title.',
      cause,
    );
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw planningInputError(
      type,
      'INVALID',
      'Planning artifact input must be one JSON object.',
      'Provide a bounded JSON object with at least a title.',
    );
  }
  return parsed as Record<string, unknown>;
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string')
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  return [];
}

function taskRows(value: unknown, fallback: string) {
  const source = strings(value);
  return (source.length > 0 ? source : [fallback]).map((title, index) => ({
    id: `${index + 1}.0`,
    title,
    status: 'pending',
    subtasks: [],
  }));
}

async function assertParent(
  projectDir: string,
  config: OpenPlanrConfig,
  type: PlanningType,
  id?: string,
) {
  if (!id) throw new Error(`${type} creation requires its parent identifier.`);
  if (!(await readArtifact(projectDir, config, type, id)))
    throw new Error(`${type} ${id} was not found.`);
  return id;
}

async function creationData(
  type: PlanningType,
  projectDir: string,
  config: OpenPlanrConfig,
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const inputSource =
    typeof options.data === 'string'
      ? options.data
      : typeof options.file === 'string'
        ? options.file
        : undefined;
  const input = await readInputData(type, inputSource);
  const title = String(
    options.title ?? options.description ?? input.title ?? input.name ?? '',
  ).trim();
  if (!title) throw new Error(`planr ${type} create requires --title or JSON input with a title.`);
  const base = { ...input, title };

  if (type === 'epic')
    return {
      owner: config.author ?? 'unassigned',
      businessValue: '',
      targetUsers: '',
      problemStatement: '',
      solutionOverview: '',
      successCriteria: '',
      keyFeatures: [],
      dependencies: 'None',
      risks: 'None',
      featureIds: [],
      ...base,
    };
  if (type === 'feature') {
    const epicId = await assertParent(
      projectDir,
      config,
      'epic',
      String(options.epic ?? input.epicId ?? ''),
    );
    return {
      owner: config.author ?? 'unassigned',
      overview: '',
      functionalRequirements: [],
      dependencies: 'None',
      technicalConsiderations: 'None',
      risks: 'None',
      successMetrics: '',
      storyIds: [],
      ...base,
      epicId,
      epicFilename: await resolveArtifactFilename(projectDir, config, 'epic', epicId),
    };
  }
  if (type === 'story') {
    const featureId = await assertParent(
      projectDir,
      config,
      'feature',
      String(options.feature ?? input.featureId ?? ''),
    );
    return {
      role: 'user',
      goal: title,
      benefit: 'the intended outcome is achieved',
      ...base,
      featureId,
      featureFilename: await resolveArtifactFilename(projectDir, config, 'feature', featureId),
    };
  }
  if (type === 'task') {
    const storyId = String(options.story ?? input.storyId ?? '').trim() || undefined;
    const featureId = String(options.feature ?? input.featureId ?? '').trim() || undefined;
    if (Boolean(storyId) === Boolean(featureId))
      throw new Error('Task creation requires exactly one of --story or --feature.');
    if (storyId) await assertParent(projectDir, config, 'story', storyId);
    if (featureId) await assertParent(projectDir, config, 'feature', featureId);
    return {
      ...base,
      storyId,
      featureId,
      tasks: Array.isArray(input.tasks) ? input.tasks : taskRows(input.items, title),
      ...(storyId
        ? { storyFilename: await resolveArtifactFilename(projectDir, config, 'story', storyId) }
        : {}),
      ...(featureId
        ? {
            featureFilename: await resolveArtifactFilename(
              projectDir,
              config,
              'feature',
              featureId,
            ),
          }
        : {}),
    };
  }
  if (type === 'quick')
    return {
      ...base,
      epicId: options.epic ?? input.epicId,
      sourceDescription: input.description ?? title,
      tasks: Array.isArray(input.tasks) ? input.tasks : taskRows(input.items, title),
    };
  if (type === 'backlog')
    return {
      ...base,
      priority: options.priority ?? input.priority ?? 'medium',
      tags: strings(options.tag ?? input.tags),
      description: input.description ?? title,
      epicId: options.epic ?? input.epicId,
    };
  return prepareSprintCreation(
    projectDir,
    config,
    { ...base, goals: strings(input.goals), taskIds: strings(input.taskIds) },
    options.duration,
  );
}

async function create(type: PlanningType, program: Command, options: Record<string, unknown>) {
  const projectDir = program.opts().projectDir as string;
  const config = await loadConfig(projectDir);
  const data = await creationData(type, projectDir, config, options);
  const result = await createArtifact(projectDir, config, type, templates[type], data);

  if (type === 'feature')
    await addChildReference(
      projectDir,
      config,
      'epic',
      String(data.epicId),
      'feature',
      result.id,
      String(data.title),
    );
  if (type === 'story') {
    await addChildReference(
      projectDir,
      config,
      'feature',
      String(data.featureId),
      'story',
      result.id,
      String(data.title),
    );
    const storyDir = path.join(projectDir, getArtifactDir(config, 'story'));
    const gherkin = await renderTemplate(
      'stories/gherkin.feature.hbs',
      {
        id: result.id,
        title: data.title,
        role: data.role,
        goal: data.goal,
        benefit: data.benefit,
        scenarios: Array.isArray(data.scenarios) ? data.scenarios : [],
      },
      config.templateOverrides,
    );
    await writeFile(path.join(storyDir, `${result.id}-gherkin.feature`), gherkin);
  }
  if (type === 'task') {
    const parentType = data.storyId ? 'story' : 'feature';
    const parentId = String(data.storyId ?? data.featureId);
    await addChildReference(
      projectDir,
      config,
      parentType,
      parentId,
      'task',
      result.id,
      String(data.title),
    );
  }
  if (options.json) {
    display.line(
      JSON.stringify({
        ok: true,
        action: `${type}.created`,
        id: result.id,
        title: String(data.title),
        artifactPath: path.relative(projectDir, result.filePath).split(path.sep).join('/'),
      }),
    );
    return;
  }
  logger.success(`Created ${result.id}: ${String(data.title)}`);
  logger.dim(`  ${result.filePath}`);
}

function registerCommon(
  program: Command,
  type: PlanningType,
  configureCreate?: (command: Command) => Command,
): Command {
  const root = program.command(type).description(`Manage ${type} artifacts deterministically`);
  let createCommand = root
    .command(type === 'backlog' ? 'add' : 'create')
    .description(`Create a ${type} from flags or a JSON object`)
    .argument('[title...]', `${type} title or description`)
    .option('--title <title>', `${type} title`)
    .option('--data <path>', 'read deterministic JSON fields from a file, or - for stdin')
    .option('--file <path>', 'deprecated alias for --data')
    .option('--json', 'emit one machine-readable result');
  if (configureCreate) createCommand = configureCreate(createCommand);
  createCommand.action(async (...args: unknown[]) => {
    const command = args.at(-1) as Command;
    const options = command.opts<Record<string, unknown>>();
    const positional = args.at(0);
    if (Array.isArray(positional) && positional.length > 0 && !options.title) {
      options.title = positional.join(' ');
    }
    const inputSource = options.data ?? options.file;
    if (options.data && options.file) {
      throw planningInputError(
        type,
        'CONFLICT',
        `The ${type} command received both --data and --file.`,
        'Provide exactly one input source.',
      );
    }
    if (type === 'quick' && options.title && inputSource) {
      throw planningInputError(
        type,
        'CONFLICT',
        'Quick creation accepts either an explicit description or --file, not both.',
        'Provide a description, --file <path>, or --file - for bounded stdin.',
      );
    }
    if (type === 'quick' && !options.title && !inputSource) {
      throw new CliBoundaryError(
        'E_QUICK_INPUT_REQUIRED',
        'Quick creation requires an explicit description or --file.',
        {
          recovery: 'Provide a description, --file <path>, or --file - for bounded stdin.',
          missing: ['descriptionOrFile'],
        },
      );
    }
    if (type === 'backlog' && options.title && !options.description) {
      options.description = options.title;
    }
    await create(type, program, options);
  });

  root
    .command('list')
    .description(`List ${type} artifacts`)
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const rows = await listArtifacts(projectDir, await loadConfig(projectDir), type);
      for (const row of rows) display.line(`${row.id}\t${row.title}`);
      if (rows.length === 0) logger.info(`No ${type} artifacts found.`);
    });

  root
    .command('show')
    .argument('<id>')
    .description(`Print one ${type} artifact`)
    .action(async (id: string) => {
      const projectDir = program.opts().projectDir as string;
      const raw = await readArtifactRaw(projectDir, await loadConfig(projectDir), type, id);
      if (!raw) throw new Error(`${type} ${id} was not found.`);
      display.line(raw);
    });

  root
    .command('update')
    .argument('<id>')
    .description(`Update ${type} frontmatter fields`)
    .option('--status <status>')
    .option('--owner <owner>')
    .option('--title <title>')
    .action(async (id: string, options: { status?: string; owner?: string; title?: string }) => {
      const fields = Object.fromEntries(
        Object.entries(options).filter(([, value]) => value !== undefined),
      );
      if (Object.keys(fields).length === 0)
        throw new Error('Provide --status, --owner, or --title.');
      const projectDir = program.opts().projectDir as string;
      await updateArtifactFields(projectDir, await loadConfig(projectDir), type, id, fields);
      logger.success(`Updated ${id}.`);
    });
  return root;
}

export function registerEpicCommand(program: Command) {
  registerCommon(program, 'epic');
}
export function registerFeatureCommand(program: Command) {
  registerCommon(program, 'feature', (command) =>
    command.option('--epic <id>', 'parent epic ID; may also come from --data'),
  );
}
export function registerStoryCommand(program: Command) {
  registerCommon(program, 'story', (command) =>
    command.option('--feature <id>', 'parent feature ID; may also come from --data'),
  );
}
export function registerTaskCommand(program: Command) {
  registerCommon(program, 'task', (command) =>
    command.option('--story <id>').option('--feature <id>'),
  );
}
export function registerQuickCommand(program: Command) {
  registerCommon(program, 'quick', (command) => command.option('--epic <id>'));
}
export function registerBacklogCommand(program: Command) {
  registerCommon(program, 'backlog', (command) =>
    command
      .option('-p, --priority <priority>', 'critical, high, medium, or low', 'medium')
      .option('-t, --tag <tags...>')
      .option('--epic <id>'),
  );
}
export function registerSprintCommand(program: Command) {
  const root = registerCommon(program, 'sprint', (command) =>
    command.option('-d, --duration <duration>', 'sprint duration', '2w'),
  );
  registerSprintRefinementCommands(program, root, (source) => readInputData('sprint', source));
}

export function extractBacklogSpec(
  raw: string,
  blId: string,
  title: string,
  fallback: string,
): string {
  if (!raw?.trim()) return fallback || title;
  let body = parseMarkdown(raw.trim())
    .content.trim()
    .replace(/^#\s+.*\n+/u, '');
  body = body.replace(/\n*---\n+_Promote to agile hierarchy:[\s\S]*$/u, '').trim();
  return body
    ? `Promote backlog item ${blId} ("${title}") into a quick task list.\n\nBacklog spec:\n\n${body}`
    : fallback || title;
}
