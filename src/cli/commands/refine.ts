/**
 * `planr refine` command.
 *
 * AI reviews and suggests improvements for any existing artifact.
 * Shows suggestions and an improved version, then asks to apply.
 * With --cascade, automatically refines all children down the hierarchy.
 */

import { Command } from 'commander';
import type { OpenPlanrConfig, ArtifactType } from '../../models/types.js';
import type { AIProvider } from '../../ai/types.js';
import { loadConfig } from '../../services/config-service.js';
import {
  readArtifactRaw,
  readArtifact,
  updateArtifact,
  findArtifactTypeById,
  listArtifacts,
} from '../../services/artifact-service.js';
import { isAIConfigured, getAIProvider, generateJSON, accumulateUsage } from '../../services/ai-service.js';
import type { AIUsage } from '../../ai/types.js';
import { TOKEN_BUDGETS } from '../../ai/types.js';
import { buildRefinePrompt } from '../../ai/prompts/prompt-builder.js';
import { aiRefineResponseSchema } from '../../ai/schemas/ai-response-schemas.js';
import { toMarkdownWithFrontmatter } from '../../utils/markdown.js';
import { promptSelect } from '../../services/prompt-service.js';
import { logger } from '../../utils/logger.js';
import chalk from 'chalk';

const CHILD_MAP: Record<string, { childType: ArtifactType; label: string; parentField: string }> = {
  epic: { childType: 'feature', label: 'features', parentField: 'epicId' },
  feature: { childType: 'story', label: 'stories', parentField: 'featureId' },
  story: { childType: 'task', label: 'tasks', parentField: 'storyId' },
};

export function registerRefineCommand(program: Command) {
  program
    .command('refine')
    .description('AI-powered review and improvement of any artifact')
    .argument('<artifactId>', 'artifact ID (e.g., EPIC-001, FEAT-002, US-003)')
    .option('--cascade', 'refine all children down the hierarchy after this artifact')
    .action(async (artifactId: string, opts: { cascade?: boolean }) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      if (!isAIConfigured(config)) {
        logger.error('AI not configured. Run `planr config set-provider` to enable AI.');
        process.exit(1);
      }

      const type = findArtifactTypeById(artifactId);
      if (!type) {
        logger.error(`Cannot determine artifact type from ID: ${artifactId}`);
        logger.dim('Expected format: EPIC-001, FEAT-001, US-001, TASK-001');
        process.exit(1);
      }

      try {
        const provider = await getAIProvider(config);

        if (opts.cascade) {
          const totalUsage: AIUsage = { inputTokens: 0, outputTokens: 0 };
          const count = await refineCascade(projectDir, config, provider, type, artifactId, undefined, totalUsage);
          if (totalUsage.inputTokens > 0) {
            logger.dim(`\nCascade complete: ${count} artifact(s) refined (${totalUsage.inputTokens.toLocaleString()} in → ${totalUsage.outputTokens.toLocaleString()} out tokens total)`);
          }
        } else {
          await refineOne(projectDir, config, provider, type, artifactId);
          await suggestNextSteps(projectDir, config, type, artifactId);
        }
      } catch (err) {
        const { AIError } = await import('../../ai/errors.js');
        if (err instanceof AIError) {
          logger.error(err.userMessage);
        } else {
          throw err;
        }
      }
    });
}

/**
 * Refine a single artifact with view/apply/skip prompts.
 */
async function refineOne(
  projectDir: string,
  config: OpenPlanrConfig,
  provider: AIProvider,
  type: ArtifactType,
  artifactId: string,
  parentContext?: { type: string; content: string }
): Promise<void> {
  const rawContent = await readArtifactRaw(projectDir, config, type, artifactId);
  if (!rawContent) {
    logger.error(`Artifact ${artifactId} not found.`);
    return;
  }

  logger.heading(`Refine ${artifactId}`);

  const messages = buildRefinePrompt(rawContent, type, parentContext);
  const { result } = await generateJSON(provider, messages, aiRefineResponseSchema, { maxTokens: TOKEN_BUDGETS.refine });

  // Resolve improvedMarkdown — if AI returned JSON instead of markdown, reconstruct it
  let markdown = result.improvedMarkdown;
  const trimmed = markdown.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    logger.warn('AI returned JSON instead of markdown. Reconstructing from improved data...');
    const improved = result.improved as Record<string, unknown>;
    markdown = toMarkdownWithFrontmatter(
      improved,
      rawContent.split('---').slice(2).join('---').trim()
    );
  }

  // Display improvements summary
  console.log(chalk.dim('━'.repeat(50)));
  console.log(chalk.bold('  Improvements:'));
  for (const suggestion of result.suggestions) {
    console.log(chalk.yellow(`    • ${suggestion}`));
  }
  console.log(chalk.dim('━'.repeat(50)));

  const action = await promptSelect('Action:', [
    { name: 'Apply improved version', value: 'apply' },
    { name: 'View improved version', value: 'view' },
    { name: 'Skip (keep original)', value: 'skip' },
  ]);

  if (action === 'skip') {
    logger.info('Artifact unchanged.');
    return;
  }

  if (action === 'view') {
    console.log(chalk.dim('━'.repeat(50)));
    console.log(chalk.green(markdown));
    console.log(chalk.dim('━'.repeat(50)));

    const applyAfterView = await promptSelect('Apply this version?', [
      { name: 'Yes, apply', value: 'apply' },
      { name: 'No, keep original', value: 'skip' },
    ]);

    if (applyAfterView === 'skip') {
      logger.info('Artifact unchanged.');
      return;
    }
  }

  await updateArtifact(projectDir, config, type, artifactId, markdown);
  logger.success(`Applied improvements to ${artifactId}.`);
}

/**
 * Refine an artifact and cascade down the full hierarchy.
 * Epic → Features → Stories → Tasks
 */
async function refineCascade(
  projectDir: string,
  config: OpenPlanrConfig,
  provider: AIProvider,
  type: ArtifactType,
  artifactId: string,
  parentContext?: { type: string; content: string },
  totalUsage?: AIUsage
): Promise<number> {
  let count = 0;

  // Refine this artifact first
  await refineOne(projectDir, config, provider, type, artifactId, parentContext);
  count++;
  if (totalUsage) accumulateUsage(totalUsage, provider.getLastUsage());

  // Find and refine children
  const children = await findChildren(projectDir, config, type, artifactId);
  if (children.length === 0) return count;

  // Read the updated parent content to pass as context to children
  const updatedContent = await readArtifactRaw(projectDir, config, type, artifactId);
  const childParentContext = updatedContent
    ? { type, content: updatedContent }
    : undefined;

  const mapping = CHILD_MAP[type];
  logger.heading(`Cascading to ${children.length} ${mapping.label}...`);

  for (const childId of children) {
    count += await refineCascade(projectDir, config, provider, mapping.childType, childId, childParentContext, totalUsage);
  }

  return count;
}

/**
 * Find child artifact IDs linked to a parent.
 */
async function findChildren(
  projectDir: string,
  config: OpenPlanrConfig,
  parentType: ArtifactType,
  parentId: string
): Promise<string[]> {
  const mapping = CHILD_MAP[parentType];
  if (!mapping) return [];

  const allChildren = await listArtifacts(projectDir, config, mapping.childType);
  const linked: string[] = [];

  for (const child of allChildren) {
    const data = await readArtifact(projectDir, config, mapping.childType, child.id);
    if (data && data.data[mapping.parentField] === parentId) {
      linked.push(child.id);
    }
  }

  return linked;
}

/**
 * Show next step suggestions when not using --cascade.
 */
async function suggestNextSteps(
  projectDir: string,
  config: OpenPlanrConfig,
  type: ArtifactType,
  artifactId: string
): Promise<void> {
  const children = await findChildren(projectDir, config, type, artifactId);
  if (children.length === 0) return;

  const mapping = CHILD_MAP[type];

  console.log('');
  console.log(chalk.dim('━'.repeat(50)));
  console.log(chalk.bold('  Next steps'));
  console.log(chalk.dim(`  This ${type} has ${children.length} ${mapping.label} that may need re-alignment:`));
  console.log('');
  console.log(chalk.cyan(`    planr refine ${artifactId} --cascade`));
  console.log(chalk.dim('    Refines this artifact and all children down the hierarchy.'));
  console.log('');
  console.log(chalk.dim('  Or refine individually:'));
  for (const childId of children) {
    console.log(chalk.cyan(`    planr refine ${childId}`));
  }
  console.log('');
  console.log(chalk.dim(`  Run ${chalk.cyan('planr sync')} to check cross-references.`));
  console.log(chalk.dim('━'.repeat(50)));
}
