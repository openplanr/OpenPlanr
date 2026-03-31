import chalk from 'chalk';
import type { Command } from 'commander';
import { buildEstimatePrompt } from '../../ai/prompts/prompt-builder.js';
import type { AIEstimateResponse } from '../../ai/schemas/ai-response-schemas.js';
import { aiEstimateResponseSchema } from '../../ai/schemas/ai-response-schemas.js';
import { TOKEN_BUDGETS } from '../../ai/types.js';
import type { ArtifactType, OpenPlanrConfig } from '../../models/types.js';
import { generateStreamingJSON, getAIProvider } from '../../services/ai-service.js';
import {
  findArtifactTypeById,
  listArtifacts,
  readArtifact,
  readArtifactRaw,
  updateArtifact,
} from '../../services/artifact-service.js';
import { loadConfig } from '../../services/config-service.js';
import { promptSelect } from '../../services/prompt-service.js';
import { createSpinner, logger } from '../../utils/logger.js';
import { parseMarkdown } from '../../utils/markdown.js';

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function complexityColor(complexity: string): string {
  if (complexity === 'low') return chalk.green(complexity);
  if (complexity === 'medium') return chalk.yellow(complexity);
  return chalk.red(complexity);
}

function displayEstimate(id: string, estimate: AIEstimateResponse): void {
  console.log('');
  console.log(chalk.bold(`  ${id} — Effort Estimate`));
  console.log(`  ${'─'.repeat(40)}`);
  console.log(`  Story Points:  ${chalk.bold(String(estimate.storyPoints))}`);
  console.log(`  Hours:         ${estimate.estimatedHours}h`);
  console.log(`  Complexity:    ${complexityColor(estimate.complexity)}`);
  console.log('');
  console.log(`  ${chalk.dim('Risk Factors:')}`);
  for (const risk of estimate.riskFactors) {
    console.log(`    • ${risk}`);
  }
  console.log('');
  console.log(`  ${chalk.dim('Reasoning:')}`);
  console.log(`    ${estimate.reasoning}`);
  if (estimate.assumptions.length > 0) {
    console.log('');
    console.log(`  ${chalk.dim('Assumptions:')}`);
    for (const a of estimate.assumptions) {
      console.log(`    • ${a}`);
    }
  }
  console.log('');
}

function displayRollupTable(estimates: Array<{ id: string; estimate: AIEstimateResponse }>): void {
  console.log('');
  console.log(chalk.bold('  Rollup Summary'));
  console.log(`  ${'─'.repeat(55)}`);
  console.log(
    `  ${chalk.dim('ID'.padEnd(12))} ${chalk.dim('Points'.padEnd(8))} ${chalk.dim('Hours'.padEnd(8))} ${chalk.dim('Complexity')}`,
  );
  console.log(`  ${'─'.repeat(55)}`);

  let totalPoints = 0;
  let totalHours = 0;
  let maxComplexity: 'low' | 'medium' | 'high' = 'low';
  const complexityOrder = { low: 0, medium: 1, high: 2 };

  for (const { id, estimate } of estimates) {
    totalPoints += estimate.storyPoints;
    totalHours += estimate.estimatedHours;
    if (complexityOrder[estimate.complexity] > complexityOrder[maxComplexity]) {
      maxComplexity = estimate.complexity;
    }
    console.log(
      `  ${id.padEnd(12)} ${String(estimate.storyPoints).padEnd(8)} ${(`${estimate.estimatedHours}h`).padEnd(8)} ${complexityColor(estimate.complexity)}`,
    );
  }

  console.log(`  ${'─'.repeat(55)}`);
  console.log(
    `  ${chalk.bold('TOTAL'.padEnd(12))} ${chalk.bold(String(totalPoints).padEnd(8))} ${chalk.bold(`${totalHours}h`.padEnd(8))} ${complexityColor(maxComplexity)}`,
  );
  console.log('');
}

// ---------------------------------------------------------------------------
// Markdown persistence
// ---------------------------------------------------------------------------

function buildEstimateSection(estimate: AIEstimateResponse): string {
  const lines: string[] = [];
  lines.push('## Estimate');
  lines.push(`- **Story Points:** ${estimate.storyPoints}`);
  lines.push(`- **Hours:** ${estimate.estimatedHours}h`);
  lines.push(`- **Complexity:** ${estimate.complexity}`);
  lines.push('');
  lines.push('### Risk Factors');
  for (const risk of estimate.riskFactors) {
    lines.push(`- ${risk}`);
  }
  lines.push('');
  lines.push('### Reasoning');
  lines.push(estimate.reasoning);
  if (estimate.assumptions.length > 0) {
    lines.push('');
    lines.push('### Assumptions');
    for (const a of estimate.assumptions) {
      lines.push(`- ${a}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Save helper
// ---------------------------------------------------------------------------

async function saveEstimateToArtifact(
  raw: string,
  result: AIEstimateResponse,
  projectDir: string,
  config: OpenPlanrConfig,
  type: ArtifactType,
  artifactId: string,
): Promise<void> {
  let updated = raw;

  // --- Inject estimate fields into frontmatter (preserving original formatting) ---
  // Remove old estimate fields if present, then add fresh ones before closing ---
  updated = updated.replace(/^estimatedEffort:.*\n/m, '');
  updated = updated.replace(/^estimatedPoints:.*\n/m, '');
  updated = updated.replace(/^estimatedHours:.*\n/m, '');
  updated = updated.replace(/^complexity:.*\n/m, '');

  const estimateFields = [
    `estimatedPoints: ${result.storyPoints}`,
    `estimatedHours: ${result.estimatedHours}`,
    `complexity: "${result.complexity}"`,
  ].join('\n');

  // Insert before the closing --- of frontmatter (second occurrence)
  const closingIdx = updated.indexOf('\n---', updated.indexOf('---') + 3);
  if (closingIdx !== -1) {
    updated = `${updated.slice(0, closingIdx)}\n${estimateFields}${updated.slice(closingIdx)}`;
  }

  // --- Append or replace ## Estimate section in body ---
  const estimateSection = buildEstimateSection(result);
  const sectionRegex = /\n## Estimate\n[\s\S]*?(?=\n## |\n*$)/;

  if (sectionRegex.test(updated)) {
    updated = updated.replace(sectionRegex, `\n${estimateSection}`);
  } else {
    updated = `${updated.trimEnd()}\n\n${estimateSection}\n`;
  }

  await updateArtifact(projectDir, config, type, artifactId, updated);
  logger.success(`Saved estimate to ${artifactId}`);
}

// ---------------------------------------------------------------------------
// Core estimation
// ---------------------------------------------------------------------------

async function estimateSingle(
  projectDir: string,
  config: OpenPlanrConfig,
  artifactId: string,
  opts: { save?: boolean; silent?: boolean },
): Promise<AIEstimateResponse | null> {
  const type = findArtifactTypeById(artifactId);
  if (!type) {
    logger.error(`Cannot determine artifact type from ID: ${artifactId}`);
    logger.dim('Expected format: EPIC-001, FEAT-001, US-001, TASK-001, QT-001');
    return null;
  }

  const raw = await readArtifactRaw(projectDir, config, type, artifactId);
  if (!raw) {
    logger.error(`Artifact not found: ${artifactId}`);
    return null;
  }

  // Build codebase context (best-effort)
  let codebaseContext: string | undefined;
  try {
    const { buildCodebaseContext, extractKeywords, formatCodebaseContext } = await import(
      '../../ai/codebase/index.js'
    );
    const keywords = extractKeywords(raw);
    const ctx = await buildCodebaseContext(projectDir, keywords);
    codebaseContext = formatCodebaseContext(ctx);
  } catch {
    // Codebase scanning is best-effort
  }

  const provider = await getAIProvider(config);
  const messages = buildEstimatePrompt(raw, type, codebaseContext);

  const spinner = createSpinner(`Estimating ${artifactId}...`);

  const { result } = await generateStreamingJSON(provider, messages, aiEstimateResponseSchema, {
    maxTokens: TOKEN_BUDGETS.estimate,
  });

  spinner.stop();
  displayEstimate(artifactId, result);

  // Interactive action prompt (skip in non-interactive / epic rollup mode)
  if (!opts.save && !opts.silent) {
    const action = await promptSelect<string>('Action:', [
      { name: 'Save estimate to artifact', value: 'save' },
      { name: 'Re-estimate', value: 'retry' },
      { name: 'Discard', value: 'discard' },
    ]);

    if (action === 'retry') {
      return estimateSingle(projectDir, config, artifactId, opts);
    }
    if (action === 'discard') {
      logger.info('Estimate discarded.');
      return result;
    }
    // action === 'save' → fall through
    opts.save = true;
  }

  if (opts.save) {
    saveEstimateToArtifact(raw, result, projectDir, config, type, artifactId);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Epic rollup
// ---------------------------------------------------------------------------

async function estimateEpicRollup(
  projectDir: string,
  config: OpenPlanrConfig,
  epicId: string,
  opts: { save?: boolean },
): Promise<void> {
  // Verify epic exists
  const epicRaw = await readArtifactRaw(projectDir, config, 'epic', epicId);
  if (!epicRaw) {
    logger.error(`Epic not found: ${epicId}`);
    process.exit(1);
  }

  logger.heading(`Estimating all artifacts under ${epicId}`);

  // Build hierarchy: epic → features → stories → tasks
  const features = await listArtifacts(projectDir, config, 'feature');
  const stories = await listArtifacts(projectDir, config, 'story');
  const tasks = await listArtifacts(projectDir, config, 'task');

  // Find features under this epic
  const epicFeatureIds = new Set<string>();
  for (const f of features) {
    const data = await readArtifact(projectDir, config, 'feature', f.id);
    if (data?.data.epicId === epicId) epicFeatureIds.add(f.id);
  }

  // Find stories under those features
  const epicStoryIds = new Set<string>();
  for (const s of stories) {
    const data = await readArtifact(projectDir, config, 'story', s.id);
    if (data?.data.featureId && epicFeatureIds.has(data.data.featureId as string)) {
      epicStoryIds.add(s.id);
    }
  }

  // Find tasks under those stories (or directly under features)
  const leafTasks: Array<{ id: string; type: ArtifactType }> = [];
  for (const t of tasks) {
    const data = await readArtifact(projectDir, config, 'task', t.id);
    const parentStory = data?.data.storyId as string | undefined;
    const parentFeature = data?.data.featureId as string | undefined;
    if (
      (parentStory && epicStoryIds.has(parentStory)) ||
      (parentFeature && epicFeatureIds.has(parentFeature))
    ) {
      leafTasks.push({ id: t.id, type: 'task' });
    }
  }

  if (leafTasks.length === 0) {
    // Fall back to estimating features/stories if no tasks exist
    if (epicFeatureIds.size > 0) {
      for (const fId of epicFeatureIds) leafTasks.push({ id: fId, type: 'feature' });
    } else {
      logger.warn(`No artifacts found under ${epicId}`);
      return;
    }
  }

  logger.dim(`Found ${leafTasks.length} artifact${leafTasks.length !== 1 ? 's' : ''} to estimate`);
  console.log('');

  const results: Array<{ id: string; estimate: AIEstimateResponse }> = [];

  for (let i = 0; i < leafTasks.length; i++) {
    const { id } = leafTasks[i];
    logger.dim(`  [${i + 1}/${leafTasks.length}] Estimating ${id}...`);
    const estimate = await estimateSingle(projectDir, config, id, {
      save: opts.save,
      silent: true,
    });
    if (estimate) {
      results.push({ id, estimate });
    }
  }

  if (results.length > 1) {
    displayRollupTable(results);
  }
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

async function calibrate(projectDir: string, config: OpenPlanrConfig): Promise<void> {
  logger.heading('Estimate Calibration Report');
  console.log('');

  const types: ArtifactType[] = ['task', 'quick'];
  const calibrationData: Array<{
    id: string;
    type: string;
    status: string;
    points: number;
    hours: number;
    complexity: string;
  }> = [];

  for (const type of types) {
    const artifacts = await listArtifacts(projectDir, config, type);
    for (const artifact of artifacts) {
      const raw = await readArtifactRaw(projectDir, config, type, artifact.id);
      if (!raw) continue;
      const { data } = parseMarkdown(raw);
      if (data.estimatedPoints) {
        calibrationData.push({
          id: artifact.id,
          type,
          status: (data.status as string) || 'unknown',
          points: data.estimatedPoints as number,
          hours: (data.estimatedHours as number) || 0,
          complexity: (data.complexity as string) || 'unknown',
        });
      }
    }
  }

  if (calibrationData.length === 0) {
    logger.warn('No artifacts with estimates found. Run `planr estimate <id> --save` first.');
    return;
  }

  // Display table
  console.log(
    `  ${chalk.dim('ID'.padEnd(12))} ${chalk.dim('Status'.padEnd(14))} ${chalk.dim('Points'.padEnd(8))} ${chalk.dim('Hours'.padEnd(8))} ${chalk.dim('Complexity')}`,
  );
  console.log(`  ${'─'.repeat(60)}`);

  for (const item of calibrationData) {
    const statusColor =
      item.status === 'done'
        ? chalk.green
        : item.status === 'in-progress'
          ? chalk.yellow
          : chalk.dim;
    console.log(
      `  ${item.id.padEnd(12)} ${statusColor(item.status.padEnd(14))} ${String(item.points).padEnd(8)} ${(`${item.hours}h`).padEnd(8)} ${complexityColor(item.complexity)}`,
    );
  }

  // Summary
  const doneItems = calibrationData.filter((d) => d.status === 'done');
  const totalPoints = calibrationData.reduce((s, d) => s + d.points, 0);
  const totalHours = calibrationData.reduce((s, d) => s + d.hours, 0);

  console.log(`  ${'─'.repeat(60)}`);
  console.log('');
  console.log(`  ${chalk.bold('Summary')}`);
  console.log(`  Total estimated:   ${totalPoints} points, ${totalHours}h`);
  console.log(
    `  Artifacts:         ${calibrationData.length} estimated, ${doneItems.length} completed`,
  );
  if (doneItems.length > 0) {
    const donePoints = doneItems.reduce((s, d) => s + d.points, 0);
    const avgPoints = (donePoints / doneItems.length).toFixed(1);
    console.log(`  Avg points/done:   ${avgPoints}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerEstimateCommand(program: Command) {
  program
    .command('estimate')
    .description('AI-powered effort estimation for any artifact')
    .argument('[artifactId]', 'artifact ID (e.g., TASK-001, US-002, QT-001)')
    .option('--epic <epicId>', 'estimate all artifacts under an epic with rollup')
    .option('--save', 'persist estimates to artifact frontmatter')
    .option('--calibrate', 'compare past estimates — show accuracy report')
    .action(
      async (
        artifactId: string | undefined,
        opts: { epic?: string; save?: boolean; calibrate?: boolean },
      ) => {
        const projectDir = program.opts().projectDir as string;
        const config = await loadConfig(projectDir);

        if (opts.calibrate) {
          await calibrate(projectDir, config);
          return;
        }

        if (opts.epic) {
          await estimateEpicRollup(projectDir, config, opts.epic, { save: opts.save });
          return;
        }

        if (!artifactId) {
          logger.error('Please provide an artifact ID or use --epic / --calibrate');
          logger.dim('Usage: planr estimate TASK-001 [--save]');
          logger.dim('       planr estimate --epic EPIC-001 [--save]');
          logger.dim('       planr estimate --calibrate');
          process.exit(1);
        }

        const result = await estimateSingle(projectDir, config, artifactId, {
          save: opts.save,
        });
        if (!result) process.exit(1);
      },
    );
}
