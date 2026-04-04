/**
 * `planr sync` command.
 *
 * Validates and repairs cross-references across all artifacts:
 *   - Removes links to non-existent artifacts
 *   - Adds missing links (e.g., feature references epic but epic doesn't list it)
 *   - Deduplicates link lists
 *   - Reports all fixes
 */

import chalk from 'chalk';
import type { Command } from 'commander';
import type { ArtifactType, OpenPlanrConfig } from '../../models/types.js';
import {
  listArtifacts,
  readArtifact,
  readArtifactRaw,
  resolveArtifactFilename,
  updateArtifact,
} from '../../services/artifact-service.js';
import { loadConfig } from '../../services/config-service.js';
import { display, logger } from '../../utils/logger.js';

export function registerSyncCommand(program: Command) {
  program
    .command('sync')
    .description('Validate and fix cross-references across all artifacts')
    .option('--dry-run', 'show what would change without writing files')
    .action(async (opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const dryRun = !!opts.dryRun;

      if (dryRun) {
        logger.heading('Sync (dry run)');
      } else {
        logger.heading('Sync');
      }

      let totalFixes = 0;

      logger.debug('Starting cross-reference validation...');

      // 1. Sync epics → features
      totalFixes += await syncParentChildLinks(projectDir, config, {
        parentType: 'epic',
        childType: 'feature',
        childForeignKey: 'epicId',
        sectionHeading: '## Features',
        dryRun,
      });

      // 2. Sync features → stories
      totalFixes += await syncParentChildLinks(projectDir, config, {
        parentType: 'feature',
        childType: 'story',
        childForeignKey: 'featureId',
        sectionHeading: '## User Stories',
        dryRun,
      });

      // 3. Sync stories → tasks
      totalFixes += await syncParentChildLinks(projectDir, config, {
        parentType: 'story',
        childType: 'task',
        childForeignKey: 'storyId',
        sectionHeading: '## Tasks',
        dryRun,
      });

      if (totalFixes === 0) {
        logger.success('All cross-references are valid. Nothing to fix.');
      } else if (dryRun) {
        logger.info(`Found ${totalFixes} issue(s). Run without --dry-run to apply fixes.`);
      } else {
        logger.success(`Fixed ${totalFixes} cross-reference issue(s).`);
      }
    });
}

interface SyncOptions {
  parentType: ArtifactType;
  childType: ArtifactType;
  childForeignKey: string;
  sectionHeading: string;
  dryRun: boolean;
}

async function syncParentChildLinks(
  projectDir: string,
  config: OpenPlanrConfig,
  opts: SyncOptions,
): Promise<number> {
  const parents = await listArtifacts(projectDir, config, opts.parentType);
  const children = await listArtifacts(projectDir, config, opts.childType);
  let fixes = 0;

  // Build map: parentId → set of actual child IDs that reference this parent
  const actualChildrenByParent = new Map<string, Set<string>>();
  const childTitleMap = new Map<string, string>();

  // For story→task sync: tasks may reference featureId instead of storyId.
  // In that case, the task belongs to ALL stories under that feature.
  let storiesByFeature: Map<string, string[]> | undefined;
  if (opts.parentType === 'story' && opts.childType === 'task') {
    storiesByFeature = new Map();
    for (const parent of parents) {
      const data = await readArtifact(projectDir, config, 'story', parent.id);
      const featureId = data?.data.featureId as string | undefined;
      if (featureId) {
        if (!storiesByFeature.has(featureId)) {
          storiesByFeature.set(featureId, []);
        }
        storiesByFeature.get(featureId)?.push(parent.id);
      }
    }
  }

  for (const child of children) {
    const data = await readArtifact(projectDir, config, opts.childType, child.id);
    if (!data) continue;

    childTitleMap.set(child.id, (data.data.title as string) || child.title);

    const parentId = data.data[opts.childForeignKey] as string | undefined;

    if (parentId) {
      // Direct reference: task.storyId → story
      if (!actualChildrenByParent.has(parentId)) {
        actualChildrenByParent.set(parentId, new Set());
      }
      actualChildrenByParent.get(parentId)?.add(child.id);
    }

    // Handle feature-level tasks: task has featureId but no storyId
    // These tasks belong to all stories under that feature
    if (!parentId && storiesByFeature && opts.childType === 'task') {
      const featureId = data.data.featureId as string | undefined;
      if (featureId) {
        const storyIds = storiesByFeature.get(featureId) || [];
        for (const storyId of storyIds) {
          if (!actualChildrenByParent.has(storyId)) {
            actualChildrenByParent.set(storyId, new Set());
          }
          actualChildrenByParent.get(storyId)?.add(child.id);
        }
      }
    }
  }

  // For each parent, rebuild the child links section
  for (const parent of parents) {
    const parentRaw = await readArtifactRaw(projectDir, config, opts.parentType, parent.id);
    if (!parentRaw) continue;

    const actualChildren = actualChildrenByParent.get(parent.id) || new Set<string>();

    // Extract currently linked child IDs from the markdown
    const linkedIds = extractLinkedIds(parentRaw, opts.sectionHeading);

    // Set of child IDs that actually exist as files on disk
    const existingChildIds = new Set(children.map((c) => c.id));

    // Stale = linked in markdown but the artifact file doesn't exist on disk
    const staleIds = linkedIds.filter((id) => !existingChildIds.has(id));
    // Missing = references this parent via foreign key but isn't linked in markdown
    const missingIds = [...actualChildren].filter((id) => !linkedIds.includes(id));
    const hasDuplicates = new Set(linkedIds).size !== linkedIds.length;

    if (staleIds.length === 0 && missingIds.length === 0 && !hasDuplicates) {
      continue; // No issues
    }

    // Report issues
    for (const id of staleIds) {
      const label = opts.dryRun ? chalk.yellow('would remove') : chalk.red('removed');
      display.line(`  ${label} stale link ${id} from ${parent.id}`);
      fixes++;
    }
    for (const id of missingIds) {
      const label = opts.dryRun ? chalk.yellow('would add') : chalk.green('added');
      display.line(`  ${label} missing link ${id} to ${parent.id}`);
      fixes++;
    }
    if (hasDuplicates) {
      const label = opts.dryRun ? chalk.yellow('would deduplicate') : chalk.blue('deduplicated');
      display.line(`  ${label} links in ${parent.id}`);
      fixes++;
    }

    if (opts.dryRun) continue;

    // Rebuild: keep existing valid links (exist on disk) + add missing, deduplicate
    const validExisting = linkedIds.filter((id) => existingChildIds.has(id));
    const allIds = new Set([...validExisting, ...missingIds]);
    const correctIds = [...allIds].sort();
    const newSection = await buildLinksSection(
      projectDir,
      config,
      opts.childType,
      correctIds,
      childTitleMap,
      opts.parentType,
      parent.id,
    );

    const updated = replaceSection(parentRaw, opts.sectionHeading, newSection);
    await updateArtifact(projectDir, config, opts.parentType, parent.id, updated);
  }

  return fixes;
}

/**
 * Extract artifact IDs from markdown link lines like `- [FEAT-001: Title](...)`.
 */
function extractLinkedIds(markdown: string, sectionHeading: string): string[] {
  const sectionIdx = markdown.indexOf(sectionHeading);
  if (sectionIdx === -1) return [];

  const afterSection = markdown.slice(sectionIdx + sectionHeading.length);
  const lines = afterSection.split('\n');
  const ids: string[] = [];

  for (const line of lines) {
    if (line.startsWith('##') && line !== sectionHeading) break; // next section
    const match = line.match(/^\s*-\s*\[([A-Z]+-\d{3})/);
    if (match) ids.push(match[1]);
  }

  return ids;
}

/**
 * Build markdown link lines for a list of child IDs.
 */
async function buildLinksSection(
  projectDir: string,
  config: OpenPlanrConfig,
  childType: ArtifactType,
  childIds: string[],
  titleMap: Map<string, string>,
  parentType: ArtifactType,
  parentId: string,
): Promise<string> {
  if (childIds.length === 0) {
    const dirMap: Record<string, string> = {
      feature: 'feature',
      story: 'story',
      task: 'task',
    };
    const cmd = dirMap[childType] || childType;
    const parentFlag = `--${parentType === 'story' ? 'story' : parentType}`;
    return `_No ${childType}s created yet. Run \`planr ${cmd} create ${parentFlag} ${parentId}\` to create ${childType}s._`;
  }

  const relDir: Record<string, string> = {
    feature: 'features',
    story: 'stories',
    task: 'tasks',
  };
  const dir = relDir[childType] || childType;

  const lines: string[] = [];
  for (const id of childIds) {
    const filename = await resolveArtifactFilename(projectDir, config, childType, id);
    const title = titleMap.get(id) || id;
    lines.push(`- [${id}: ${title}](../${dir}/${filename}.md)`);
  }
  return lines.join('\n');
}

/**
 * Replace everything between a section heading and the next heading (or end).
 */
function replaceSection(markdown: string, sectionHeading: string, newContent: string): string {
  const sectionIdx = markdown.indexOf(sectionHeading);
  if (sectionIdx === -1) return markdown;

  const before = markdown.slice(0, sectionIdx + sectionHeading.length);
  const afterSection = markdown.slice(sectionIdx + sectionHeading.length);

  // Find the next ## heading or end of file
  const nextHeadingMatch = afterSection.match(/\n(##\s)/);
  let after = '';
  if (nextHeadingMatch && nextHeadingMatch.index !== undefined) {
    after = afterSection.slice(nextHeadingMatch.index);
  }

  return `${before}\n${newContent}\n${after}`;
}
