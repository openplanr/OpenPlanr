/**
 * `planr export` command.
 *
 * Generates consolidated reports in markdown, JSON, or HTML format.
 */

import path from 'node:path';
import type { Command } from 'commander';
import type { ArtifactFrontmatter, ArtifactType, OpenPlanrConfig } from '../../models/types.js';
import { listArtifacts, readArtifact } from '../../services/artifact-service.js';
import { loadConfig } from '../../services/config-service.js';
import { renderTemplate } from '../../services/template-service.js';
import { writeFile } from '../../utils/fs.js';
import { display, logger } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportArtifact {
  id: string;
  title: string;
  type: ArtifactType;
  status: string;
  data: ArtifactFrontmatter;
  body: string;
}

interface ExportEpic extends ExportArtifact {
  features: ExportFeature[];
}

interface ExportFeature extends ExportArtifact {
  stories: ExportStory[];
}

interface ExportStory extends ExportArtifact {
  tasks: ExportArtifact[];
}

interface ExportData {
  projectName: string;
  date: string;
  epics: ExportEpic[];
  orphanFeatures: ExportFeature[];
  orphanStories: ExportStory[];
  orphanTasks: ExportArtifact[];
  quickTasks: ExportArtifact[];
  /** Flat index for evidence-style links in export templates */
  evidence: Array<{ kind: string; label: string; detail?: string }>;
  counts: {
    epics: number;
    features: number;
    stories: number;
    tasks: number;
    quick: number;
  };
}

// ---------------------------------------------------------------------------
// Data collection helpers
// ---------------------------------------------------------------------------

/** Collect tasks linked to a story, marking them as used. */
function collectTasksForStory(
  storyId: string,
  taskMap: Map<string, ExportArtifact & { storyId?: string; featureId?: string }>,
  usedTaskIds: Set<string>,
): ExportArtifact[] {
  const tasks: ExportArtifact[] = [];
  for (const [tId, t] of taskMap) {
    if (t.storyId !== storyId) continue;
    usedTaskIds.add(tId);
    tasks.push(t);
  }
  return tasks;
}

/** Collect stories linked to a feature (with their tasks), marking them as used. */
function collectStoriesForFeature(
  featureId: string,
  storyMap: Map<string, ExportArtifact & { featureId?: string }>,
  taskMap: Map<string, ExportArtifact & { storyId?: string; featureId?: string }>,
  usedStoryIds: Set<string>,
  usedTaskIds: Set<string>,
): ExportStory[] {
  const stories: ExportStory[] = [];
  for (const [sId, s] of storyMap) {
    if (s.featureId !== featureId) continue;
    usedStoryIds.add(sId);
    const tasks = collectTasksForStory(sId, taskMap, usedTaskIds);
    stories.push({ ...s, type: 'story', tasks });
  }
  return stories;
}

// ---------------------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------------------

async function collectArtifacts(
  projectDir: string,
  config: OpenPlanrConfig,
  scopeEpicId?: string,
): Promise<ExportData> {
  const epicList = await listArtifacts(projectDir, config, 'epic');
  const featureList = await listArtifacts(projectDir, config, 'feature');
  const storyList = await listArtifacts(projectDir, config, 'story');
  const taskList = await listArtifacts(projectDir, config, 'task');
  const quickList = await listArtifacts(projectDir, config, 'quick');

  // Read all artifacts into lookup maps
  const featureMap = new Map<string, ExportArtifact & { epicId?: string }>();
  const storyMap = new Map<string, ExportArtifact & { featureId?: string }>();
  const taskMap = new Map<string, ExportArtifact & { storyId?: string; featureId?: string }>();

  for (const f of featureList) {
    const data = await readArtifact(projectDir, config, 'feature', f.id);
    if (data) {
      featureMap.set(f.id, {
        id: f.id,
        title: data.data.title as string,
        type: 'feature',
        status: (data.data.status as string) || 'pending',
        data: data.data,
        body: data.content,
        epicId: data.data.epicId as string | undefined,
      });
    }
  }

  for (const s of storyList) {
    const data = await readArtifact(projectDir, config, 'story', s.id);
    if (data) {
      storyMap.set(s.id, {
        id: s.id,
        title: data.data.title as string,
        type: 'story',
        status: (data.data.status as string) || 'pending',
        data: data.data,
        body: data.content,
        featureId: data.data.featureId as string | undefined,
      });
    }
  }

  for (const t of taskList) {
    const data = await readArtifact(projectDir, config, 'task', t.id);
    if (data) {
      taskMap.set(t.id, {
        id: t.id,
        title: data.data.title as string,
        type: 'task',
        status: (data.data.status as string) || 'pending',
        data: data.data,
        body: data.content,
        storyId: data.data.storyId as string | undefined,
        featureId: data.data.featureId as string | undefined,
      });
    }
  }

  // Build hierarchy
  const epics: ExportEpic[] = [];
  const usedFeatureIds = new Set<string>();
  const usedStoryIds = new Set<string>();
  const usedTaskIds = new Set<string>();

  for (const e of epicList) {
    if (scopeEpicId && e.id !== scopeEpicId) continue;

    const epicData = await readArtifact(projectDir, config, 'epic', e.id);
    if (!epicData) continue;

    const epicFeatures: ExportFeature[] = [];

    for (const [fId, f] of featureMap) {
      if (f.epicId !== e.id) continue;
      usedFeatureIds.add(fId);

      const featureStories = collectStoriesForFeature(
        fId,
        storyMap,
        taskMap,
        usedStoryIds,
        usedTaskIds,
      );

      // Tasks linked directly to feature (no story)
      for (const [tId, t] of taskMap) {
        if (t.featureId === fId && !t.storyId && !usedTaskIds.has(tId)) {
          usedTaskIds.add(tId);
          featureStories.push({
            ...t,
            type: 'task' as ArtifactType,
            tasks: [],
            featureId: fId,
          } as ExportStory);
        }
      }

      epicFeatures.push({ ...f, type: 'feature', stories: featureStories });
    }

    epics.push({
      id: e.id,
      title: epicData.data.title as string,
      type: 'epic',
      status: (epicData.data.status as string) || 'pending',
      data: epicData.data,
      body: epicData.content,
      features: epicFeatures,
    });
  }

  // Orphaned artifacts (not part of any epic hierarchy)
  const orphanFeatures: ExportFeature[] = [];
  if (!scopeEpicId) {
    for (const [fId, f] of featureMap) {
      if (usedFeatureIds.has(fId)) continue;
      const featureStories = collectStoriesForFeature(
        fId,
        storyMap,
        taskMap,
        usedStoryIds,
        usedTaskIds,
      );
      orphanFeatures.push({ ...f, type: 'feature', stories: featureStories });
    }
  }

  const orphanStories: ExportStory[] = [];
  if (!scopeEpicId) {
    for (const [sId, s] of storyMap) {
      if (usedStoryIds.has(sId)) continue;
      const tasks = collectTasksForStory(sId, taskMap, usedTaskIds);
      orphanStories.push({ ...s, type: 'story', tasks });
    }
  }

  const orphanTasks: ExportArtifact[] = [];
  if (!scopeEpicId) {
    for (const [tId, t] of taskMap) {
      if (usedTaskIds.has(tId)) continue;
      orphanTasks.push(t);
    }
  }

  // Quick tasks
  const quickTasks: ExportArtifact[] = [];
  if (!scopeEpicId) {
    for (const qt of quickList) {
      const data = await readArtifact(projectDir, config, 'quick', qt.id);
      if (data) {
        quickTasks.push({
          id: qt.id,
          title: data.data.title as string,
          type: 'quick',
          status: (data.data.status as string) || 'pending',
          data: data.data,
          body: data.content,
        });
      }
    }
  }

  const evidence: Array<{ kind: string; label: string; detail?: string }> = [];
  for (const [, s] of storyMap) {
    evidence.push({ kind: 'story', label: `${s.id}: ${s.title}`, detail: `Status: ${s.status}` });
  }
  for (const [, t] of taskMap) {
    evidence.push({ kind: 'task', label: `${t.id}: ${t.title}`, detail: `Status: ${t.status}` });
  }

  return {
    projectName: config.projectName,
    date: new Date().toISOString().split('T')[0],
    epics,
    orphanFeatures,
    orphanStories,
    orphanTasks,
    quickTasks,
    evidence,
    counts: {
      epics: epics.length,
      features: usedFeatureIds.size + orphanFeatures.length,
      stories: usedStoryIds.size + orphanStories.length,
      tasks: usedTaskIds.size + orphanTasks.length,
      quick: quickTasks.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Export formatters
// ---------------------------------------------------------------------------

async function exportMarkdown(
  data: ExportData,
  outputPath: string,
  overrideDir?: string,
): Promise<string> {
  const content = await renderTemplate(
    'export/planning-report.md.hbs',
    data as unknown as Record<string, unknown>, // Template data is inherently untyped
    overrideDir,
  );
  const filePath = outputPath.endsWith('.md') ? outputPath : path.join(outputPath, 'PLANNING.md');
  await writeFile(filePath, content);
  return filePath;
}

async function exportJSON(data: ExportData, outputPath: string): Promise<string> {
  const filePath = outputPath.endsWith('.json')
    ? outputPath
    : path.join(outputPath, 'planning.json');
  await writeFile(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

async function exportHTML(
  data: ExportData,
  outputPath: string,
  overrideDir?: string,
): Promise<string> {
  const content = await renderTemplate(
    'export/planning-report.html.hbs',
    data as unknown as Record<string, unknown>, // Template data is inherently untyped
    overrideDir,
  );
  const filePath = outputPath.endsWith('.html')
    ? outputPath
    : path.join(outputPath, 'planning.html');
  await writeFile(filePath, content);
  return filePath;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerExportCommand(program: Command) {
  program
    .command('export')
    .description('Export planning artifacts as markdown, JSON, or HTML report')
    .option('--format <format>', 'output format: markdown, json, html', 'markdown')
    .option('--scope <epicId>', 'only export artifacts under a specific epic')
    .option('--output <path>', 'output file or directory', '.')
    .action(async (opts: { format: string; scope?: string; output: string }) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const format = opts.format.toLowerCase();

      if (!['markdown', 'json', 'html'].includes(format)) {
        logger.error(`Unknown format: ${format}. Use markdown, json, or html.`);
        process.exit(1);
      }

      if (opts.scope) {
        if (!opts.scope.startsWith('EPIC')) {
          logger.error('--scope only supports epic IDs (e.g., EPIC-001)');
          process.exit(1);
        }
        const epic = await readArtifact(projectDir, config, 'epic', opts.scope);
        if (!epic) {
          logger.error(`Epic not found: ${opts.scope}`);
          process.exit(1);
        }
      }

      logger.heading('Export');
      const scopeLabel = opts.scope ? ` (scope: ${opts.scope})` : '';
      logger.dim(`Collecting artifacts${scopeLabel}...`);

      const data = await collectArtifacts(projectDir, config, opts.scope);

      const total =
        data.counts.epics +
        data.counts.features +
        data.counts.stories +
        data.counts.tasks +
        data.counts.quick;

      if (total === 0) {
        logger.warn('No artifacts found to export.');
        return;
      }

      const outputPath = path.resolve(projectDir, opts.output);
      let filePath: string;

      switch (format) {
        case 'json':
          filePath = await exportJSON(data, outputPath);
          break;
        case 'html':
          filePath = await exportHTML(data, outputPath, config.templateOverrides);
          break;
        default:
          // 'markdown' — validated above
          filePath = await exportMarkdown(data, outputPath, config.templateOverrides);
      }

      display.blank();
      logger.success(
        `Exported ${total} artifacts → ${path.relative(projectDir, filePath) || filePath}`,
      );
      logger.dim(
        `${data.counts.epics} epics, ${data.counts.features} features, ${data.counts.stories} stories, ${data.counts.tasks} tasks, ${data.counts.quick} quick`,
      );
    });
}
