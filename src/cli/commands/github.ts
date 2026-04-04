/**
 * `planr github` command.
 *
 * Push planning artifacts to GitHub Issues and sync status bi-directionally.
 */

import chalk from 'chalk';
import type { Command } from 'commander';
import type { ArtifactType, OpenPlanrConfig } from '../../models/types.js';
import {
  findArtifactTypeById,
  listArtifacts,
  readArtifact,
  readArtifactRaw,
  updateArtifact,
} from '../../services/artifact-service.js';
import { loadConfig } from '../../services/config-service.js';
import {
  buildIssueBody,
  cleanTitle,
  createIssue,
  ensureLabel,
  ensureMilestone,
  getIssue,
  getLabelForType,
  issueStateToStatus,
  statusToIssueState,
  updateIssue,
  verifyGitHubRepo,
} from '../../services/github-service.js';
import { promptSelect } from '../../services/prompt-service.js';
import { display, logger } from '../../utils/logger.js';
import { parseMarkdown, toMarkdownWithFrontmatter } from '../../utils/markdown.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Inject or update a `githubIssue` field in raw artifact frontmatter. */
function setFrontmatterField(raw: string, field: string, value: string | number): string {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fieldRegex = new RegExp(`^${escaped}:.*\\n`, 'm');
  if (fieldRegex.test(raw)) {
    return raw.replace(fieldRegex, `${field}: ${value}\n`);
  }
  // Insert before closing ---
  const closingIdx = raw.indexOf('\n---', raw.indexOf('---') + 3);
  if (closingIdx !== -1) {
    return `${raw.slice(0, closingIdx)}\n${field}: ${value}${raw.slice(closingIdx)}`;
  }
  return raw;
}

/** Push a single artifact to GitHub as an issue. */
async function pushSingleArtifact(
  projectDir: string,
  config: OpenPlanrConfig,
  artifactId: string,
  opts: { milestone?: string },
): Promise<{ issueNumber: number; issueUrl: string; action: 'created' | 'updated' } | null> {
  const type = findArtifactTypeById(artifactId);
  if (!type) {
    logger.error(`Cannot determine artifact type from ID: ${artifactId}`);
    return null;
  }

  const artifact = await readArtifact(projectDir, config, type, artifactId);
  if (!artifact) {
    logger.error(`Artifact not found: ${artifactId}`);
    return null;
  }

  const raw = await readArtifactRaw(projectDir, config, type, artifactId);
  if (!raw) return null;

  const title = cleanTitle(artifactId, artifact.data.title as string);
  const body = buildIssueBody(raw, artifactId, type, artifact.data);

  // Ensure label exists
  const label = getLabelForType(type);
  if (label) await ensureLabel(label);

  const labels = label ? [label] : [];
  const existingIssueNumber = artifact.data.githubIssue as number | undefined;

  let issueNumber: number;
  let issueUrl: string;
  let action: 'created' | 'updated';

  if (existingIssueNumber) {
    // Try to update existing issue — fall back to create if deleted on GitHub
    try {
      const currentIssue = await getIssue(existingIssueNumber);
      await updateIssue(existingIssueNumber, { title, body });

      const status = (artifact.data.status as string) || 'pending';
      const targetState = statusToIssueState(status);
      if (currentIssue.state !== targetState) {
        await updateIssue(existingIssueNumber, { state: targetState });
      }

      issueNumber = existingIssueNumber;
      issueUrl = currentIssue.url;
      action = 'updated';
    } catch (err) {
      logger.debug('Failed to update existing GitHub issue, creating new one', err);
      // Issue was deleted on GitHub — create a fresh one
      const result = await createIssue(title, body, labels, opts.milestone);
      issueNumber = result.number;
      issueUrl = result.url;
      action = 'created';

      const updatedRaw = setFrontmatterField(raw, 'githubIssue', issueNumber);
      await updateArtifact(projectDir, config, type, artifactId, updatedRaw);
    }
  } else {
    // Create new issue
    const result = await createIssue(title, body, labels, opts.milestone);
    issueNumber = result.number;
    issueUrl = result.url;
    action = 'created';

    // Store issue number in artifact frontmatter
    const updatedRaw = setFrontmatterField(raw, 'githubIssue', issueNumber);
    await updateArtifact(projectDir, config, type, artifactId, updatedRaw);
  }

  return { issueNumber, issueUrl, action };
}

/** Collect all artifact IDs under an epic. */
async function collectEpicArtifacts(
  projectDir: string,
  config: OpenPlanrConfig,
  epicId: string,
): Promise<string[]> {
  const ids: string[] = [epicId];

  const features = await listArtifacts(projectDir, config, 'feature');
  const stories = await listArtifacts(projectDir, config, 'story');
  const tasks = await listArtifacts(projectDir, config, 'task');

  const epicFeatureIds = new Set<string>();
  for (const f of features) {
    const data = await readArtifact(projectDir, config, 'feature', f.id);
    if (data?.data.epicId === epicId) {
      epicFeatureIds.add(f.id);
      ids.push(f.id);
    }
  }

  const epicStoryIds = new Set<string>();
  for (const s of stories) {
    const data = await readArtifact(projectDir, config, 'story', s.id);
    if (data?.data.featureId && epicFeatureIds.has(data.data.featureId as string)) {
      epicStoryIds.add(s.id);
      ids.push(s.id);
    }
  }

  for (const t of tasks) {
    const data = await readArtifact(projectDir, config, 'task', t.id);
    const parentStory = data?.data.storyId as string | undefined;
    const parentFeature = data?.data.featureId as string | undefined;
    if (
      (parentStory && epicStoryIds.has(parentStory)) ||
      (parentFeature && epicFeatureIds.has(parentFeature))
    ) {
      ids.push(t.id);
    }
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerGitHubCommand(program: Command) {
  const github = program
    .command('github')
    .description('Sync planning artifacts with GitHub Issues');

  // --- planr github push ---
  github
    .command('push')
    .description('Push artifacts to GitHub Issues')
    .argument('[artifactId]', 'artifact ID to push (e.g., TASK-001)')
    .option('--epic <epicId>', 'push all artifacts under an epic')
    .option('--all', 'push all artifacts across all types')
    .action(async (artifactId: string | undefined, opts: { epic?: string; all?: boolean }) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      // Verify GitHub repo
      let repoInfo: { owner: string; repo: string };
      try {
        repoInfo = await verifyGitHubRepo();
      } catch (e) {
        logger.error((e as Error).message);
        process.exit(1);
      }

      logger.heading(`GitHub Push — ${repoInfo.owner}/${repoInfo.repo}`);
      display.blank();

      let artifactIds: string[] = [];

      if (opts.all) {
        // Push everything
        const types: ArtifactType[] = ['epic', 'feature', 'story', 'task', 'quick'];
        for (const type of types) {
          const artifacts = await listArtifacts(projectDir, config, type);
          for (const a of artifacts) artifactIds.push(a.id);
        }
      } else if (opts.epic) {
        // Push all under epic, create milestone
        const epic = await readArtifact(projectDir, config, 'epic', opts.epic);
        if (!epic) {
          logger.error(`Epic not found: ${opts.epic}`);
          process.exit(1);
        }

        const milestoneTitle = `${opts.epic}: ${epic.data.title as string}`;
        try {
          await ensureMilestone(milestoneTitle);
          logger.success(`Milestone: ${milestoneTitle}`);
        } catch (err) {
          logger.debug('Failed to create milestone', err);
          logger.warn('Could not create milestone, pushing without it');
        }

        artifactIds = await collectEpicArtifacts(projectDir, config, opts.epic);
      } else if (artifactId) {
        artifactIds = [artifactId];
      } else {
        logger.error('Provide an artifact ID, --epic, or --all');
        logger.dim('Usage: planr github push TASK-001');
        logger.dim('       planr github push --epic EPIC-001');
        logger.dim('       planr github push --all');
        process.exit(1);
      }

      if (artifactIds.length === 0) {
        logger.warn('No artifacts found to push');
        return;
      }

      logger.dim(`Pushing ${artifactIds.length} artifact${artifactIds.length !== 1 ? 's' : ''}...`);
      display.blank();

      let created = 0;
      let updated = 0;
      const milestoneTitle = opts.epic
        ? `${opts.epic}: ${(await readArtifact(projectDir, config, 'epic', opts.epic))?.data.title as string}`
        : undefined;

      for (const id of artifactIds) {
        try {
          const result = await pushSingleArtifact(projectDir, config, id, {
            milestone: milestoneTitle,
          });
          if (result) {
            const icon = result.action === 'created' ? chalk.green('+') : chalk.yellow('~');
            display.line(`  ${icon} ${id} → #${result.issueNumber} (${result.action})`);
            if (result.action === 'created') created++;
            else updated++;
          }
        } catch (e) {
          logger.error(`  Failed to push ${id}: ${(e as Error).message}`);
        }
      }

      display.blank();
      logger.success(`Done: ${created} created, ${updated} updated`);
    });

  // --- planr github sync ---
  github
    .command('sync')
    .description('Sync artifact status with GitHub Issues (bi-directional)')
    .option(
      '--direction <dir>',
      'sync direction: pull (GitHub→local), push (local→GitHub), or both',
      'both',
    )
    .action(async (opts: { direction: string }) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      let repoInfo: { owner: string; repo: string };
      try {
        repoInfo = await verifyGitHubRepo();
      } catch (e) {
        logger.error((e as Error).message);
        process.exit(1);
      }

      logger.heading(`GitHub Sync — ${repoInfo.owner}/${repoInfo.repo}`);
      display.blank();

      // Find all artifacts with githubIssue field
      const types: ArtifactType[] = ['epic', 'feature', 'story', 'task', 'quick'];
      const linkedArtifacts: Array<{
        id: string;
        type: ArtifactType;
        issueNumber: number;
        status: string;
      }> = [];

      for (const type of types) {
        const artifacts = await listArtifacts(projectDir, config, type);
        for (const a of artifacts) {
          const data = await readArtifact(projectDir, config, type, a.id);
          if (data?.data.githubIssue) {
            linkedArtifacts.push({
              id: a.id,
              type,
              issueNumber: data.data.githubIssue as number,
              status: (data.data.status as string) || 'pending',
            });
          }
        }
      }

      if (linkedArtifacts.length === 0) {
        logger.warn('No artifacts linked to GitHub Issues. Run `planr github push` first.');
        return;
      }

      logger.dim(
        `Found ${linkedArtifacts.length} linked artifact${linkedArtifacts.length !== 1 ? 's' : ''}`,
      );
      display.blank();

      let synced = 0;
      const conflicts: Array<{
        id: string;
        localStatus: string;
        remoteState: string;
        issueNumber: number;
      }> = [];

      for (const artifact of linkedArtifacts) {
        try {
          const issue = await getIssue(artifact.issueNumber);
          const remoteStatus = issueStateToStatus(issue.state);
          const localStatus = artifact.status;

          if (remoteStatus === localStatus) {
            // Already in sync
            continue;
          }

          if (opts.direction === 'pull') {
            // GitHub → local
            await updateLocalStatus(projectDir, config, artifact.type, artifact.id, remoteStatus);
            display.line(
              `  ${chalk.blue('←')} ${artifact.id}: ${chalk.dim(localStatus)} → ${chalk.green(remoteStatus)} (from #${artifact.issueNumber})`,
            );
            synced++;
          } else if (opts.direction === 'push') {
            // Local → GitHub
            const targetState = statusToIssueState(localStatus);
            if (issue.state !== targetState) {
              await updateIssue(artifact.issueNumber, { state: targetState });
            }
            display.line(
              `  ${chalk.yellow('→')} ${artifact.id}: #${artifact.issueNumber} ${chalk.dim(issue.state)} → ${chalk.green(targetState)}`,
            );
            synced++;
          } else {
            // Both — detect conflicts
            conflicts.push({
              id: artifact.id,
              localStatus,
              remoteState: issue.state,
              issueNumber: artifact.issueNumber,
            });
          }
        } catch (e) {
          logger.error(`  Failed to sync ${artifact.id}: ${(e as Error).message}`);
        }
      }

      // Handle conflicts for bi-directional sync
      if (conflicts.length > 0) {
        display.blank();
        logger.heading('Conflicts detected');
        display.blank();

        for (const conflict of conflicts) {
          const remoteStatus = issueStateToStatus(conflict.remoteState);
          display.line(
            `  ${chalk.red('!')} ${conflict.id} — local: ${chalk.yellow(conflict.localStatus)}, GitHub #${conflict.issueNumber}: ${chalk.cyan(conflict.remoteState)} (${remoteStatus})`,
          );

          const action = await promptSelect<string>(`  Resolve ${conflict.id}:`, [
            {
              name: `Use GitHub status (${remoteStatus})`,
              value: 'pull',
            },
            {
              name: `Use local status (${conflict.localStatus})`,
              value: 'push',
            },
            { name: 'Skip', value: 'skip' },
          ]);

          if (action === 'pull') {
            await updateLocalStatus(
              projectDir,
              config,
              findArtifactTypeById(conflict.id) || 'task',
              conflict.id,
              remoteStatus,
            );
            display.line(`    ${chalk.blue('←')} Updated local to ${remoteStatus}`);
            synced++;
          } else if (action === 'push') {
            const targetState = statusToIssueState(conflict.localStatus);
            await updateIssue(conflict.issueNumber, { state: targetState });
            display.line(`    ${chalk.yellow('→')} Updated GitHub to ${targetState}`);
            synced++;
          } else {
            display.line(`    ${chalk.dim('Skipped')}`);
          }
        }
      }

      display.blank();
      if (synced > 0) {
        logger.success(`Synced ${synced} artifact${synced !== 1 ? 's' : ''}`);
      } else {
        logger.success('All artifacts are in sync');
      }
    });

  // --- planr github status ---
  github
    .command('status')
    .description('Show sync status of all linked artifacts')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      try {
        await verifyGitHubRepo();
      } catch (e) {
        logger.error((e as Error).message);
        process.exit(1);
      }

      logger.heading('GitHub Sync Status');
      display.blank();

      const types: ArtifactType[] = ['epic', 'feature', 'story', 'task', 'quick'];
      let linked = 0;
      let unlinked = 0;

      display.line(
        `  ${chalk.dim('Artifact'.padEnd(14))} ${chalk.dim('Status'.padEnd(14))} ${chalk.dim('Issue'.padEnd(10))} ${chalk.dim('State')}`,
      );
      display.tableSeparator(50);

      for (const type of types) {
        const artifacts = await listArtifacts(projectDir, config, type);
        for (const a of artifacts) {
          const data = await readArtifact(projectDir, config, type, a.id);
          const status = (data?.data.status as string) || 'pending';
          const issueNumber = data?.data.githubIssue as number | undefined;

          if (issueNumber) {
            let issueState = '';
            try {
              const issue = await getIssue(issueNumber);
              issueState = issue.state;
            } catch (err) {
              logger.debug('Failed to fetch GitHub issue state', err);
              issueState = 'error';
            }

            const inSync =
              issueStateToStatus(issueState) === status ||
              statusToIssueState(status) === issueState;
            const syncIcon = inSync ? chalk.green('✓') : chalk.red('✗');

            display.line(
              `  ${a.id.padEnd(14)} ${status.padEnd(14)} #${String(issueNumber).padEnd(8)} ${issueState} ${syncIcon}`,
            );
            linked++;
          } else {
            display.line(
              `  ${a.id.padEnd(14)} ${status.padEnd(14)} ${chalk.dim('—'.padEnd(10))} ${chalk.dim('not linked')}`,
            );
            unlinked++;
          }
        }
      }

      display.tableSeparator(50);
      display.blank();
      display.line(`  Linked: ${linked}, Unlinked: ${unlinked}`);
    });
}

// ---------------------------------------------------------------------------
// Local status update
// ---------------------------------------------------------------------------

async function updateLocalStatus(
  projectDir: string,
  config: OpenPlanrConfig,
  type: ArtifactType,
  id: string,
  newStatus: string,
): Promise<void> {
  const raw = await readArtifactRaw(projectDir, config, type, id);
  if (!raw) return;

  const { data, content } = parseMarkdown(raw);
  data.status = newStatus;
  data.updated = new Date().toISOString().split('T')[0];
  const updated = toMarkdownWithFrontmatter(data, content);
  await updateArtifact(projectDir, config, type, id, updated);
}
