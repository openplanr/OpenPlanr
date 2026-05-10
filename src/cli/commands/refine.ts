/**
 * `planr refine` command.
 *
 * AI reviews and suggests improvements for any existing artifact.
 * Shows suggestions and an improved version, then asks to apply.
 * With --cascade, automatically refines all children down the hierarchy.
 */

import chalk from 'chalk';
import type { Command } from 'commander';
import { buildRefinePrompt } from '../../ai/prompts/prompt-builder.js';
import { aiRefineResponseSchema } from '../../ai/schemas/ai-response-schemas.js';
import type { AIProvider, AIUsage } from '../../ai/types.js';
import { TOKEN_BUDGETS } from '../../ai/types.js';
import type { ArtifactFrontmatter, ArtifactType, OpenPlanrConfig } from '../../models/types.js';
import {
  accumulateUsage,
  generateJSON,
  getAIProvider,
  isAIConfigured,
} from '../../services/ai-service.js';
import {
  findArtifactTypeById,
  listArtifacts,
  readArtifact,
  readArtifactRaw,
  updateArtifact,
} from '../../services/artifact-service.js';
import { validateArtifactBytes } from '../../services/artifact-validation.js';
import { loadConfig } from '../../services/config-service.js';
import { applyRefineDeltas } from '../../services/delta-apply-service.js';
import { promptSelect } from '../../services/prompt-service.js';
import { display, logger } from '../../utils/logger.js';
import { toMarkdownWithFrontmatter } from '../../utils/markdown.js';

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
          const count = await refineCascade(
            projectDir,
            config,
            provider,
            type,
            artifactId,
            undefined,
            totalUsage,
          );
          if (totalUsage.inputTokens > 0) {
            logger.dim(
              `\nCascade complete: ${count} artifact(s) refined (${totalUsage.inputTokens.toLocaleString()} in → ${totalUsage.outputTokens.toLocaleString()} out tokens total)`,
            );
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
  parentContext?: { type: string; content: string },
): Promise<void> {
  const rawContent = await readArtifactRaw(projectDir, config, type, artifactId);
  if (!rawContent) {
    logger.error(`Artifact ${artifactId} not found.`);
    return;
  }

  logger.heading(`Refine ${artifactId}`);

  const messages = buildRefinePrompt(rawContent, type, parentContext);
  const { result } = await generateJSON(provider, messages, aiRefineResponseSchema, {
    maxTokens: TOKEN_BUDGETS.refine,
  });

  // Resolve the AI response: prefer structured deltas, fall back to legacy improvedMarkdown
  const hasDelta =
    (result.frontmatterChanges && Object.keys(result.frontmatterChanges).length > 0) ||
    (result.bodyChanges && result.bodyChanges.length > 0);

  let markdown: string;
  if (hasDelta) {
    markdown = applyRefineDeltas(rawContent, result.frontmatterChanges, result.bodyChanges);
  } else if (result.improvedMarkdown) {
    logger.warn('AI returned legacy improvedMarkdown — validating before apply...');
    const validation = validateArtifactBytes(type, rawContent, result.improvedMarkdown);
    if (!validation.ok) {
      logger.error(`Refusing legacy improvedMarkdown: ${validation.reason}`);
      logger.dim('Falling back to JSON-reconstructed frontmatter...');
      const improved = result.improved as ArtifactFrontmatter;
      markdown = toMarkdownWithFrontmatter(
        improved,
        rawContent.split('---').slice(2).join('---').trim(),
      );
    } else {
      markdown = result.improvedMarkdown;
    }
  } else {
    logger.info('AI returned no changes.');
    return;
  }

  // Display improvements summary
  display.separator(50);
  display.heading('  Improvements:');
  for (const suggestion of result.suggestions) {
    display.line(chalk.yellow(`    • ${suggestion}`));
  }
  display.separator(50);

  const action = await promptSelect(
    'Action:',
    [
      { name: 'Apply improved version', value: 'apply' },
      { name: 'View changes', value: 'view' },
      { name: 'Skip (keep original)', value: 'skip' },
    ],
    'apply',
  );

  if (action === 'skip') {
    logger.info('Artifact unchanged.');
    return;
  }

  if (action === 'view') {
    display.separator(50);
    if (hasDelta) {
      if (result.frontmatterChanges && Object.keys(result.frontmatterChanges).length > 0) {
        display.line(chalk.cyan('Frontmatter changes:'));
        for (const [k, v] of Object.entries(result.frontmatterChanges)) {
          display.line(`  ${k}: ${String(v)}`);
        }
      }
      if (result.bodyChanges && result.bodyChanges.length > 0) {
        display.line(chalk.cyan('Body changes:'));
        for (const change of result.bodyChanges) {
          if (change.type === 'replaceSection')
            display.line(`  Replace section: ${change.heading}`);
          else display.line(`  Replace text: "${change.findExact?.slice(0, 50)}..."`);
        }
      }
    } else {
      display.line(chalk.green(markdown));
    }
    display.separator(50);

    const applyAfterView = await promptSelect(
      'Apply this version?',
      [
        { name: 'Yes, apply', value: 'apply' },
        { name: 'No, keep original', value: 'skip' },
      ],
      'apply',
    );

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
  totalUsage?: AIUsage,
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
  const childParentContext = updatedContent ? { type, content: updatedContent } : undefined;

  const mapping = CHILD_MAP[type];
  logger.heading(`Cascading to ${children.length} ${mapping.label}...`);

  for (const childId of children) {
    count += await refineCascade(
      projectDir,
      config,
      provider,
      mapping.childType,
      childId,
      childParentContext,
      totalUsage,
    );
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
  parentId: string,
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
  artifactId: string,
): Promise<void> {
  const children = await findChildren(projectDir, config, type, artifactId);
  if (children.length === 0) return;

  const mapping = CHILD_MAP[type];

  display.blank();
  display.separator(50);
  display.heading('  Next steps');
  display.line(
    chalk.dim(`  This ${type} has ${children.length} ${mapping.label} that may need re-alignment:`),
  );
  display.blank();
  display.line(chalk.cyan(`    planr refine ${artifactId} --cascade`));
  display.line(chalk.dim('    Refines this artifact and all children down the hierarchy.'));
  display.blank();
  display.line(chalk.dim('  Or refine individually:'));
  for (const childId of children) {
    display.line(chalk.cyan(`    planr refine ${childId}`));
  }
  display.blank();
  display.line(chalk.dim(`  Run ${chalk.cyan('planr sync')} to check cross-references.`));
  display.separator(50);
}
