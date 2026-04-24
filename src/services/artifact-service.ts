import path from 'node:path';
import type { ArtifactFrontmatter, ArtifactType, OpenPlanrConfig } from '../models/types.js';
import { ensureDir, listFiles, readFile, writeFile } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import { parseMarkdown } from '../utils/markdown.js';
import { slugify } from '../utils/slugify.js';
import { atomicWriteFile } from './atomic-write-service.js';
import { getNextId } from './id-service.js';
import { renderTemplate } from './template-service.js';

const ARTIFACT_DIR_MAP: Record<string, string> = {
  epic: 'epics',
  feature: 'features',
  story: 'stories',
  task: 'tasks',
  quick: 'quick',
  backlog: 'backlog',
  sprint: 'sprints',
  adr: 'adrs',
  checklist: 'checklists',
};

/** Return the directory path for a given artifact type relative to the agile output root. */
export function getArtifactDir(config: OpenPlanrConfig, type: ArtifactType): string {
  return path.join(config.outputPaths.agile, ARTIFACT_DIR_MAP[type] || type);
}

/** Create a new artifact file from a Handlebars template, assigning the next available ID. */
export async function createArtifact(
  projectDir: string,
  config: OpenPlanrConfig,
  type: ArtifactType,
  templateFile: string,
  data: Record<string, unknown>, // Pre-creation template data; id is generated below
): Promise<{ id: string; filePath: string }> {
  const dir = path.join(projectDir, getArtifactDir(config, type));
  await ensureDir(dir);

  const prefixKey = type as keyof typeof config.idPrefix;
  const prefix = config.idPrefix[prefixKey] || type.toUpperCase();
  const id = await getNextId(dir, prefix);
  const title = (data.title as string) || 'untitled';
  const slug = slugify(title);
  const filename = `${id}-${slug}.md`;
  const filePath = path.join(dir, filename);

  const content = await renderTemplate(
    templateFile,
    {
      ...data,
      id,
      date: new Date().toISOString().split('T')[0],
      projectName: config.projectName,
    },
    config.templateOverrides,
  );

  await writeFile(filePath, content);
  logger.debug(`Created ${type} artifact: ${id} → ${filePath}`);
  return { id, filePath };
}

/** List all artifacts of a given type, returning their ID, title, and filename. */
export async function listArtifacts(
  projectDir: string,
  config: OpenPlanrConfig,
  type: ArtifactType,
): Promise<Array<{ id: string; title: string; filename: string }>> {
  const dir = path.join(projectDir, getArtifactDir(config, type));
  const files = await listFiles(dir, /\.md$/);
  const results: Array<{ id: string; title: string; filename: string }> = [];

  for (const filename of files.sort()) {
    const match = filename.match(/^([A-Z]+-\d{3})-(.+)\.md$/);
    if (match) {
      results.push({
        id: match[1],
        title: match[2].replace(/-/g, ' '),
        filename,
      });
    }
  }
  return results;
}

/**
 * Per-process set of file paths for which we've already emitted a parse
 * warning. Batch commands (push / status / sync) call `readArtifact` twice
 * for the same file (once during plan-build, once during the real pass) and
 * shouldn't log the same warning twice.
 */
const parseWarningsEmitted = new Set<string>();

/**
 * Read and parse an artifact's frontmatter and markdown body by ID.
 *
 * Returns `null` in two cases — both treated identically by callers:
 *   1. The file doesn't exist.
 *   2. The file exists but its frontmatter can't be parsed (malformed YAML,
 *      duplicate keys, stray `---` markers, etc.). A clear warning is emitted
 *      so the operator knows which file is broken and why; batch commands
 *      (`planr linear push`, `status`, `sync`) continue past the skip
 *      instead of aborting the whole run. The warning is deduped per file
 *      so re-reading the same broken file doesn't log twice.
 */
export async function readArtifact(
  projectDir: string,
  config: OpenPlanrConfig,
  type: ArtifactType,
  id: string,
): Promise<{ data: ArtifactFrontmatter; content: string; filePath: string } | null> {
  const dir = path.join(projectDir, getArtifactDir(config, type));
  const files = await listFiles(dir, new RegExp(`^${id}-.*\\.md$`));
  if (files.length === 0) return null;

  const filePath = path.join(dir, files[0]);
  logger.debug(`Reading ${type} artifact: ${id} ← ${filePath}`);
  const raw = await readFile(filePath);
  try {
    const parsed = parseMarkdown(raw);
    return { ...parsed, filePath };
  } catch (err) {
    if (!parseWarningsEmitted.has(filePath)) {
      parseWarningsEmitted.add(filePath);
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(
        `Skipping ${type} ${id}: frontmatter parse error.\n  ${filePath}\n  ${reason}\n  Fix the frontmatter (usually a duplicate key or stray \`---\` marker) and re-run.`,
      );
    }
    return null;
  }
}

/**
 * Read the full raw content of an artifact file (frontmatter + body).
 * Useful for passing the complete artifact text to AI prompts.
 */
export async function readArtifactRaw(
  projectDir: string,
  config: OpenPlanrConfig,
  type: ArtifactType,
  id: string,
): Promise<string | null> {
  const dir = path.join(projectDir, getArtifactDir(config, type));
  const files = await listFiles(dir, new RegExp(`^${id}-.*\\.md$`));
  if (files.length === 0) return null;

  return readFile(path.join(dir, files[0]));
}

/**
 * Overwrite an existing artifact file in place.
 */
export async function updateArtifact(
  projectDir: string,
  config: OpenPlanrConfig,
  type: ArtifactType,
  id: string,
  content: string,
): Promise<void> {
  const dir = path.join(projectDir, getArtifactDir(config, type));
  const files = await listFiles(dir, new RegExp(`^${id}-.*\\.md$`));
  if (files.length === 0) throw new Error(`Artifact ${id} not found.`);

  const filePath = path.join(dir, files[0]);
  await atomicWriteFile(filePath, content);
}

/**
 * Escape a value for safe YAML frontmatter output.
 * Wraps in double quotes and escapes embedded double-quotes and backslashes.
 */
function yamlEscape(value: unknown): string {
  const str = String(value);
  const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Update specific frontmatter fields on an artifact.
 * Operates only within the YAML frontmatter region (between --- delimiters).
 * Inserts missing fields before the closing --- if they don't exist.
 * Automatically sets the `updated` field to today's date.
 */
export async function updateArtifactFields(
  projectDir: string,
  config: OpenPlanrConfig,
  type: ArtifactType,
  id: string,
  fields: Partial<Record<string, unknown>>,
): Promise<void> {
  const raw = await readArtifactRaw(projectDir, config, type, id);
  if (!raw) throw new Error(`Artifact ${id} not found.`);

  const today = new Date().toISOString().split('T')[0];
  // When a caller changes `status`, invalidate the Linear-status sync
  // baseline so the next `planr linear sync` recognizes the local change
  // and pushes it up (or flags as a conflict if Linear also changed).
  // The sync itself opts out by passing its own `linearStatusReconciled`
  // value — we honor that over the auto-clear.
  const shouldInvalidateBaseline = 'status' in fields && !('linearStatusReconciled' in fields);
  const allFields: Partial<Record<string, unknown>> = {
    ...fields,
    updated: today,
    ...(shouldInvalidateBaseline ? { linearStatusReconciled: '' } : {}),
  };

  // Split into frontmatter and body to avoid modifying markdown content
  const openIdx = raw.indexOf('---');
  const closeIdx = raw.indexOf('\n---', openIdx + 3);
  if (openIdx === -1 || closeIdx === -1) {
    throw new Error(`Artifact ${id} has no valid frontmatter.`);
  }

  let frontmatter = raw.slice(openIdx, closeIdx);
  const body = raw.slice(closeIdx);

  for (const [key, value] of Object.entries(allFields)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedKey}:\\s*.*$`, 'm');
    const replacement = `${key}: ${yamlEscape(value)}`;

    if (pattern.test(frontmatter)) {
      // Function form bypasses regex replacement specials (`$1`, `$&`, `` $` ``,
      // `$'`, `$$`) in the replacement string. Needed because `yamlEscape`
      // only escapes `\` and `"`; a value containing `$1` would otherwise be
      // interpreted as a backreference and silently corrupt the frontmatter.
      frontmatter = frontmatter.replace(pattern, () => replacement);
    } else {
      // Insert missing field before the closing ---
      frontmatter += `\n${replacement}`;
    }
  }

  const updated = frontmatter + body;
  await updateArtifact(projectDir, config, type, id, updated);
}

/**
 * Resolve an artifact ID to its actual filename (without path).
 * Returns the filename like "EPIC-002-markdown-to-kanban-board.md"
 * or falls back to "ID.md" if the file can't be found.
 */
export async function resolveArtifactFilename(
  projectDir: string,
  config: OpenPlanrConfig,
  type: ArtifactType,
  id: string,
): Promise<string> {
  const dir = path.join(projectDir, getArtifactDir(config, type));
  // Match files starting with the ID followed by a slug: "EPIC-001-my-title.md"
  // The regex anchors to ^ to avoid matching "EPIC-0011-..." when looking for "EPIC-001"
  const files = await listFiles(dir, new RegExp(`^${id}-.*\\.md$`));
  if (files.length > 0) return files[0].replace(/\.md$/, '');
  return id;
}

/**
 * Add a child reference link to a parent artifact's markdown file.
 *
 * Replaces the "No X created yet" placeholder with a link list,
 * or appends to existing links in the appropriate section.
 *
 * @param childId    e.g. "FEAT-002"
 * @param childTitle e.g. "Markdown Task Parser Engine"
 * @param childType  e.g. "feature"
 */
export async function addChildReference(
  projectDir: string,
  config: OpenPlanrConfig,
  parentType: ArtifactType,
  parentId: string,
  childType: ArtifactType,
  childId: string,
  childTitle: string,
): Promise<void> {
  const parentRaw = await readArtifactRaw(projectDir, config, parentType, parentId);
  if (!parentRaw) return;

  const childFilename = await resolveArtifactFilename(projectDir, config, childType, childId);
  const relDir = ARTIFACT_DIR_MAP[childType] || childType;
  const link = `- [${childId}: ${childTitle}](../${relDir}/${childFilename}.md)`;

  // Pattern to match placeholder lines like "_No X created yet..._" or "_Run `planr ...` to generate..._"
  const placeholderPattern = /^_(?:No .+ created yet\.|Run .+ to (?:generate|create)).+_$/m;

  let updated: string;
  if (placeholderPattern.test(parentRaw)) {
    // Replace placeholder with the first child link
    updated = parentRaw.replace(placeholderPattern, link);
  } else {
    // Append after the last existing child link in the same section
    // Find the section heading for children (## Features, ## User Stories, ## Tasks)
    const sectionMap: Record<string, string> = {
      feature: '## Features',
      story: '## User Stories',
      task: '## Tasks',
    };
    const sectionHeading = sectionMap[childType];
    if (!sectionHeading) return;

    const sectionIdx = parentRaw.indexOf(sectionHeading);
    if (sectionIdx === -1) return;

    // Find the end of the child links block (last line starting with "- [")
    const afterSection = parentRaw.slice(sectionIdx);
    const lines = afterSection.split('\n');
    let lastLinkLineIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].startsWith('- [')) {
        lastLinkLineIdx = i;
      } else if (lines[i].startsWith('#') || (lastLinkLineIdx > -1 && lines[i].trim() !== '')) {
        break;
      }
    }

    if (lastLinkLineIdx > -1) {
      // Insert after the last link line
      lines.splice(lastLinkLineIdx + 1, 0, link);
      updated = parentRaw.slice(0, sectionIdx) + lines.join('\n');
    } else {
      // No links found after heading, add after the heading line
      lines.splice(1, 0, link);
      updated = parentRaw.slice(0, sectionIdx) + lines.join('\n');
    }
  }

  await updateArtifact(projectDir, config, parentType, parentId, updated);
}

/**
 * Determine artifact type from an ID prefix.
 */
export function findArtifactTypeById(id: string): ArtifactType | null {
  const prefix = id.split('-')[0];
  const map: Record<string, ArtifactType> = {
    EPIC: 'epic',
    FEAT: 'feature',
    US: 'story',
    TASK: 'task',
    QT: 'quick',
    BL: 'backlog',
    SPRINT: 'sprint',
    ADR: 'adr',
  };
  return map[prefix] || null;
}

/**
 * Read the parent chain for an artifact (story → feature → epic).
 */
export async function getParentChain(
  projectDir: string,
  config: OpenPlanrConfig,
  type: ArtifactType,
  id: string,
): Promise<{
  epic?: { data: ArtifactFrontmatter; content: string };
  feature?: { data: ArtifactFrontmatter; content: string };
  story?: { data: ArtifactFrontmatter; content: string };
}> {
  const result: {
    epic?: { data: ArtifactFrontmatter; content: string };
    feature?: { data: ArtifactFrontmatter; content: string };
    story?: { data: ArtifactFrontmatter; content: string };
  } = {};

  const artifact = await readArtifact(projectDir, config, type, id);
  if (!artifact) return result;

  if (type === 'task') {
    const storyId = artifact.data.storyId as string | undefined;
    if (storyId) {
      const story = await readArtifact(projectDir, config, 'story', storyId);
      if (story) {
        result.story = { data: story.data, content: story.content };
        const featureId = story.data.featureId as string | undefined;
        if (featureId) {
          const feature = await readArtifact(projectDir, config, 'feature', featureId);
          if (feature) {
            result.feature = { data: feature.data, content: feature.content };
            const epicId = feature.data.epicId as string | undefined;
            if (epicId) {
              const epic = await readArtifact(projectDir, config, 'epic', epicId);
              if (epic) result.epic = { data: epic.data, content: epic.content };
            }
          }
        }
      }
    }
  } else if (type === 'story') {
    const featureId = artifact.data.featureId as string | undefined;
    if (featureId) {
      const feature = await readArtifact(projectDir, config, 'feature', featureId);
      if (feature) {
        result.feature = { data: feature.data, content: feature.content };
        const epicId = feature.data.epicId as string | undefined;
        if (epicId) {
          const epic = await readArtifact(projectDir, config, 'epic', epicId);
          if (epic) result.epic = { data: epic.data, content: epic.content };
        }
      }
    }
  } else if (type === 'feature') {
    const epicId = artifact.data.epicId as string | undefined;
    if (epicId) {
      const epic = await readArtifact(projectDir, config, 'epic', epicId);
      if (epic) result.epic = { data: epic.data, content: epic.content };
    }
  }

  return result;
}
