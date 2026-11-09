import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { validateJson } from '../../lib/json-schema.mjs';
import { validatePlanningAcceptanceCoverage } from '../../lib/planning-contracts.mjs';
import type { OpenPlanrConfig } from '../models/types.js';
import { messageOf } from '../utils/error-message.js';
import { fileExists, readFile } from '../utils/fs.js';
import { parseMarkdown } from '../utils/markdown.js';
import { supportedProtocolSchemas } from './protocol-schemas.js';
import { getSpecsRootDir, markdownSection, resolveSpecDir } from './spec-service.js';

export type PlanRule =
  | 'frontmatter'
  | 'id-mismatch'
  | 'duplicate-id'
  | 'reference'
  | 'coverage'
  | 'verification'
  | 'empty';

export interface PlanViolation {
  file: string;
  rule: PlanRule;
  message: string;
}

export interface PlanValidationReport {
  specId: string;
  stories: number;
  tasks: number;
  violations: PlanViolation[];
}

type Kind = 'story' | 'task';

interface PlanFile {
  kind: Kind;
  id: string;
  file: string;
  data: Record<string, unknown> | null;
  content: string;
  parseError: string | null;
  specDir: string;
}

const FILE_PATTERN: Record<Kind, RegExp> = {
  story: /^(US-\d{3,})-.+\.md$/u,
  task: /^(T-\d{3,})-.+\.md$/u,
};
const KIND_DIR: Record<Kind, string> = { story: 'stories', task: 'tasks' };

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

async function readPlanFiles(specDir: string, kind: Kind): Promise<PlanFile[]> {
  const dir = path.join(specDir, KIND_DIR[kind]);
  if (!(await fileExists(dir))) return [];
  const names = (await readdir(dir)).sort();
  const files: PlanFile[] = [];
  for (const name of names) {
    const id = FILE_PATTERN[kind].exec(name)?.[1];
    if (!id) continue;
    const file = path.join(dir, name);
    const raw = await readFile(file);
    try {
      const parsed = parseMarkdown(raw);
      files.push({
        kind,
        id,
        file,
        data: parsed.data,
        content: parsed.content,
        parseError: null,
        specDir,
      });
    } catch (error) {
      files.push({
        kind,
        id,
        file,
        data: null,
        content: raw,
        parseError: messageOf(error),
        specDir,
      });
    }
  }
  return files;
}

async function readProjectPlanFiles(specsRoot: string): Promise<PlanFile[]> {
  if (!(await fileExists(specsRoot))) return [];
  const entries = await readdir(specsRoot, { withFileTypes: true });
  const files: PlanFile[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !/^SPEC-\d{3,}-/u.test(entry.name)) continue;
    const specDir = path.join(specsRoot, entry.name);
    files.push(
      ...(await readPlanFiles(specDir, 'story')),
      ...(await readPlanFiles(specDir, 'task')),
    );
  }
  return files;
}

function frontmatterViolations(entry: PlanFile, specId: string): PlanViolation[] {
  const violation = (rule: PlanRule, message: string): PlanViolation => ({
    file: entry.file,
    rule,
    message,
  });
  if (entry.data === null)
    return [violation('frontmatter', `Frontmatter is not valid YAML: ${entry.parseError}`)];
  const data = entry.data;
  const out: PlanViolation[] = [];
  if (data.id !== entry.id)
    out.push(
      violation(
        'id-mismatch',
        `Frontmatter id is ${String(data.id)}; the filename says ${entry.id}.`,
      ),
    );
  if (typeof data.specId === 'string' && data.specId !== specId)
    out.push(violation('frontmatter', `specId is ${data.specId}; the file is in ${specId}.`));
  const schemas = supportedProtocolSchemas(entry.kind);
  const schema =
    typeof data.schemaVersion === 'string' ? schemas.get(data.schemaVersion) : undefined;
  if (schema === undefined) {
    const versions = [...schemas.keys()].sort().join(', ');
    out.push(
      violation(
        'frontmatter',
        `schemaVersion ${JSON.stringify(data.schemaVersion ?? null)} is unsupported; supported versions: ${versions}.`,
      ),
    );
    return out;
  }
  for (const issue of validateJson(data, schema)) {
    out.push(violation('frontmatter', `${issue.path} ${issue.rule}: ${issue.detail}`));
  }
  return out;
}

function duplicateViolations(all: PlanFile[], specDir: string): PlanViolation[] {
  const byId = new Map<string, PlanFile[]>();
  for (const entry of all) byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry]);
  const out: PlanViolation[] = [];
  for (const [id, entries] of byId) {
    if (entries.length < 2) continue;
    for (const entry of entries.filter((candidate) => candidate.specDir === specDir)) {
      const others = entries.filter((other) => other !== entry).map((other) => other.file);
      out.push({
        file: entry.file,
        rule: 'duplicate-id',
        message: `${id} is also used by ${others.join(', ')}.`,
      });
    }
  }
  return out;
}

function coverageViolations(stories: PlanFile[], tasks: PlanFile[]): PlanViolation[] {
  const storyInputs = stories.flatMap((story) =>
    story.data
      ? [{ id: story.id, acceptanceCriteria: records(story.data.acceptanceCriteria) }]
      : [],
  );
  const taskInputs = tasks.flatMap((task) =>
    task.data
      ? [
          {
            id: task.id,
            storyId: task.data.storyId,
            acceptanceRefs: Array.isArray(task.data.acceptanceRefs) ? task.data.acceptanceRefs : [],
            testRequirements: markdownSection(task.content, 'Test Requirements') ?? '',
          },
        ]
      : [],
  );
  const fileOf = new Map([...stories, ...tasks].map((entry) => [entry.id, entry.file]));
  return validatePlanningAcceptanceCoverage(storyInputs, taskInputs).map((issue) => {
    const owner = issue.path.split('.')[0];
    const rule: PlanRule =
      issue.rule === 'unique'
        ? 'duplicate-id'
        : issue.rule === 'verification' || issue.rule === 'reference'
          ? issue.rule
          : 'coverage';
    return {
      file: fileOf.get(owner) ?? owner,
      rule,
      message: `${issue.path}: ${issue.detail}`,
    };
  });
}

/**
 * Check one spec's stories and tasks: frontmatter, project-global IDs and acceptance coverage.
 * Returns null when no spec directory matches the id. Writes nothing.
 */
export async function validateSpecPlan(
  projectDir: string,
  config: OpenPlanrConfig,
  specId: string,
): Promise<PlanValidationReport | null> {
  const resolved = await resolveSpecDir(projectDir, config, specId);
  if (!resolved) return null;
  const all = await readProjectPlanFiles(getSpecsRootDir(projectDir, config));
  const local = all.filter((entry) => entry.specDir === resolved.dir);
  const stories = local.filter((entry) => entry.kind === 'story');
  const tasks = local.filter((entry) => entry.kind === 'task');

  const violations: PlanViolation[] = [];
  if (stories.length === 0)
    violations.push({
      file: path.join(resolved.dir, 'stories'),
      rule: 'empty',
      message: `${specId} has no stories to validate.`,
    });
  for (const entry of local) violations.push(...frontmatterViolations(entry, specId));
  violations.push(...duplicateViolations(all, resolved.dir));

  const storyIds = new Set(stories.map((story) => story.id));
  for (const task of tasks) {
    const storyId = task.data?.storyId;
    if (typeof storyId === 'string' && !storyIds.has(storyId))
      violations.push({
        file: task.file,
        rule: 'reference',
        message: `${task.id} names story ${storyId}, which is not in ${specId}.`,
      });
  }
  violations.push(...coverageViolations(stories, tasks));
  return { specId, stories: stories.length, tasks: tasks.length, violations };
}
