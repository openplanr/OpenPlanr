/**
 * Task implementation bridge.
 *
 * Orchestrates the full flow:
 * 1. Read and parse the task artifact
 * 2. Resolve target subtask(s)
 * 3. Gather parent chain context (story → feature → epic)
 * 4. Build codebase context
 * 5. Compose the implementation prompt
 * 6. Dispatch to the configured coding agent
 */

import chalk from 'chalk';
import type { CodingAgentName, OpenPlanrConfig } from '../models/types.js';
import { getParentChain, readArtifact, readArtifactRaw } from '../services/artifact-service.js';
import { logger } from '../utils/logger.js';
import { createAgent } from './agent-factory.js';
import { composeImplementationPrompt } from './prompt-composer.js';
import {
  findSubtasks,
  formatSubtaskList,
  getNextPending,
  parseTaskMarkdown,
} from './task-parser.js';

export interface ImplementOptions {
  subtask?: string;
  next?: boolean;
  agent?: string;
  dryRun?: boolean;
  markDone?: boolean;
}

export async function executeImplementation(
  projectDir: string,
  config: OpenPlanrConfig,
  taskId: string,
  opts: ImplementOptions,
): Promise<void> {
  // 1. Read the task artifact
  const taskData = await readArtifact(projectDir, config, 'task', taskId);
  if (!taskData) {
    logger.error(`Task list ${taskId} not found.`);
    process.exit(1);
  }

  logger.heading(`Implement: ${taskId}`);

  // 2. Parse subtasks
  const allSubtasks = parseTaskMarkdown(taskData.content);

  if (allSubtasks.length === 0) {
    logger.warn('No subtasks found in this task list.');
    logger.info('Task list content:');
    console.log(taskData.content);
    return;
  }

  // 3. Resolve target subtask(s)
  let targetSubtasks = allSubtasks;

  if (opts.next) {
    const next = getNextPending(allSubtasks);
    if (!next) {
      logger.success('All subtasks are completed!');
      return;
    }
    targetSubtasks = [next];
    logger.info(`Next pending: ${next.id} ${next.title}`);
  } else if (opts.subtask) {
    const matches = findSubtasks(allSubtasks, opts.subtask);
    if (matches.length === 0) {
      logger.error(`No subtask matching "${opts.subtask}" found.`);
      logger.dim('Available subtasks:');
      console.log(formatSubtaskList(allSubtasks));
      return;
    }
    targetSubtasks = matches;
    logger.info(`Matched ${matches.length} subtask(s):`);
    for (const m of matches) {
      logger.dim(`  ${m.id} ${m.title}`);
    }
  } else {
    // Implementing all subtasks
    logger.info(`Implementing all ${allSubtasks.length} subtasks`);
  }

  // 4. Gather parent chain context
  logger.info('Preparing implementation context...');

  const parents = await getParentChain(projectDir, config, 'task', taskId);
  logger.success(`Read ${taskId} (${allSubtasks.length} subtasks)`);

  let storyContent: string | undefined;
  let featureContent: string | undefined;
  let epicContent: string | undefined;

  const storyId = taskData.data.storyId as string | undefined;
  if (storyId) {
    storyContent = (await readArtifactRaw(projectDir, config, 'story', storyId)) || undefined;
    if (storyContent) logger.success(`Read parent story (${storyId})`);
  }

  if (parents.feature) {
    const featureId = parents.story?.data?.featureId as string | undefined;
    if (featureId) {
      featureContent =
        (await readArtifactRaw(projectDir, config, 'feature', featureId)) || undefined;
      if (featureContent) logger.success(`Read parent feature (${featureId})`);
    }
  }

  if (parents.epic) {
    const epicId = parents.feature?.data?.epicId as string | undefined;
    if (epicId) {
      epicContent = (await readArtifactRaw(projectDir, config, 'epic', epicId)) || undefined;
      if (epicContent) logger.success(`Read parent epic (${epicId})`);
    }
  }

  // 5. Build codebase context
  let codebaseContext: string | undefined;
  try {
    const { buildCodebaseContext, formatCodebaseContext, extractKeywords } = await import(
      '../ai/codebase/index.js'
    );

    const textToAnalyze = [taskData.content, storyContent || '', featureContent || ''].join(' ');

    const keywords = extractKeywords(textToAnalyze);
    const ctx = await buildCodebaseContext(projectDir, keywords);
    codebaseContext = formatCodebaseContext(ctx);

    const stackInfo = ctx.techStack
      ? ` — ${ctx.techStack.language}${ctx.techStack.framework ? ` + ${ctx.techStack.framework}` : ''}`
      : '';
    logger.success(`Scanned codebase${stackInfo}`);
  } catch {
    // Codebase scanning is best-effort
  }

  // 6. Compose prompt
  const prompt = composeImplementationPrompt({
    taskId,
    taskTitle: (taskData.data.title as string) || taskId,
    taskContent: taskData.content,
    targetSubtasks,
    allSubtasks,
    storyContent,
    featureContent,
    epicContent,
    codebaseContext,
  });

  // 7. Handle dry run
  if (opts.dryRun) {
    logger.heading('Dry Run — Composed Prompt:');
    console.log(chalk.dim('━'.repeat(60)));
    console.log(prompt);
    console.log(chalk.dim('━'.repeat(60)));
    logger.dim(`Prompt length: ${prompt.length} chars (~${Math.ceil(prompt.length / 4)} tokens)`);
    return;
  }

  // 8. Resolve and launch coding agent
  const agentName = (opts.agent || config.defaultAgent || 'claude') as CodingAgentName;
  const agent = await createAgent(agentName);

  const available = await agent.isAvailable();
  if (!available) {
    logger.error(`Coding agent "${agentName}" is not available on this machine.`);
    logger.dim(`Make sure the "${agentName}" CLI is installed and in your PATH.`);
    logger.dim('');
    logger.dim('Install instructions:');
    logger.dim('  Claude: npm install -g @anthropic-ai/claude-code');
    logger.dim('  Codex:  npm install -g @openai/codex');
    logger.dim('  Cursor: Install from https://cursor.sh');
    logger.dim('');
    logger.dim('Or use --dry-run to see the prompt without executing.');
    return;
  }

  logger.dim(
    `Prompt: ${prompt.length.toLocaleString()} chars (~${Math.ceil(prompt.length / 4).toLocaleString()} tokens)`,
  );
  logger.heading(`Launching ${agentName}...`);
  console.log(chalk.dim('━'.repeat(60)));

  const result = await agent.execute(prompt, {
    cwd: projectDir,
    stream: true,
    dryRun: false,
  });

  console.log(chalk.dim('━'.repeat(60)));

  if (result.exitCode === 0) {
    logger.success(`${agentName} completed successfully.`);
    logger.dim('');
    logger.dim('If something needs fixing, run:');
    logger.dim('  planr task fix "describe the issue"');
    logger.dim('  make build 2>&1 | planr task fix');
  } else {
    logger.warn(`${agentName} exited with code ${result.exitCode}.`);
  }
}

// ---------------------------------------------------------------------------
// Follow-up / Fix — continue the last Claude session
// ---------------------------------------------------------------------------

export interface FollowUpOptions {
  agent?: string;
}

/**
 * Send a follow-up message to the coding agent, continuing the
 * previous session. This is the feedback loop for fixing issues
 * found after implementation.
 */
export async function executeFollowUp(
  projectDir: string,
  config: OpenPlanrConfig,
  message: string,
  opts: FollowUpOptions,
): Promise<void> {
  logger.heading('Fix / Follow-up');

  // Compose a focused fix prompt
  const prompt = composeFixPrompt(message);

  logger.dim(
    `Prompt: ${prompt.length.toLocaleString()} chars (~${Math.ceil(prompt.length / 4).toLocaleString()} tokens)`,
  );

  const agentName = (opts.agent || config.defaultAgent || 'claude') as CodingAgentName;
  const agent = await createAgent(agentName);

  const available = await agent.isAvailable();
  if (!available) {
    logger.error(`Coding agent "${agentName}" is not available.`);
    return;
  }

  logger.heading(`Continuing ${agentName} session...`);
  console.log(chalk.dim('━'.repeat(60)));

  const result = await agent.execute(prompt, {
    cwd: projectDir,
    stream: true,
    dryRun: false,
    continueSession: true,
  });

  console.log(chalk.dim('━'.repeat(60)));

  if (result.exitCode === 0) {
    logger.success(`${agentName} completed fix successfully.`);
    logger.dim('');
    logger.dim('Still broken? Run planr task fix again with the new error.');
  } else {
    logger.warn(`${agentName} exited with code ${result.exitCode}.`);
  }
}

/**
 * Compose a follow-up prompt that includes the error/issue context
 * and clear instructions to fix the previously implemented code.
 */
function composeFixPrompt(userMessage: string): string {
  const sections: string[] = [];

  sections.push('# Fix Required\n');
  sections.push('The previously implemented code has an issue that needs fixing.\n');

  // Detect if the message looks like error output (long, has stack traces, etc.)
  const isErrorOutput =
    userMessage.length > 200 ||
    userMessage.includes('Error:') ||
    userMessage.includes('error:') ||
    userMessage.includes('FAIL') ||
    userMessage.includes('exit code');

  if (isErrorOutput) {
    sections.push('## Error Output\n');
    sections.push('```');
    sections.push(userMessage.trim());
    sections.push('```');
  } else {
    sections.push('## Issue Description\n');
    sections.push(userMessage.trim());
  }

  sections.push('\n## Instructions\n');
  sections.push('1. Analyze the error/issue above.');
  sections.push('2. Identify the root cause in the code you previously created.');
  sections.push('3. Fix ONLY what is needed — do not rewrite unrelated code.');
  sections.push('4. Verify the fix addresses the reported issue.');
  sections.push('5. If the error involves missing dependencies, use compatible versions.');

  return sections.join('\n');
}
