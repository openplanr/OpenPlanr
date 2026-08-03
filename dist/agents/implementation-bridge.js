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
import { getParentChain, readArtifact, readArtifactRaw, updateArtifact, } from '../services/artifact-service.js';
import { display, logger } from '../utils/logger.js';
import { createAgent } from './agent-factory.js';
import { composeImplementationPrompt } from './prompt-composer.js';
import { findSubtasks, formatSubtaskList, getNextPending, parseTaskMarkdown, } from './task-parser.js';
export async function executeImplementation(projectDir, config, taskId, opts) {
    // 1. Read the task artifact (supports both TASK-xxx and QT-xxx)
    const artifactType = taskId.startsWith('QT-') ? 'quick' : 'task';
    const taskData = await readArtifact(projectDir, config, artifactType, taskId);
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
        display.line(taskData.content);
        return;
    }
    // 3. Resolve target subtask(s) — may return early if all done or no match
    const targetSubtasks = resolveTargetSubtasks(allSubtasks, opts);
    if (!targetSubtasks)
        return;
    // 4. Gather parent chain context
    const parentContext = await gatherParentContext(projectDir, config, artifactType, taskId, taskData);
    // 5. Build the implementation prompt
    const prompt = await buildImplementationPrompt(projectDir, taskId, taskData, targetSubtasks, allSubtasks, parentContext);
    // 6. Handle dry run
    if (opts.dryRun) {
        handleDryRun(prompt);
        return;
    }
    // 7. Launch coding agent
    const agentName = (opts.agent || config.defaultAgent || 'claude');
    const result = await launchAgent(agentName, prompt, projectDir);
    if (!result)
        return;
    // 8. Post-execution handling
    if (result.exitCode === 0) {
        await markSubtasksDone(projectDir, config, artifactType, taskId, targetSubtasks);
        logger.success(`${agentName} completed successfully.`);
        logger.dim('');
        logger.dim('If something needs fixing, run:');
        logger.dim('  planr task fix "describe the issue"');
        logger.dim('  make build 2>&1 | planr task fix');
    }
    else {
        logger.warn(`${agentName} exited with code ${result.exitCode}.`);
    }
}
/**
 * Resolve which subtasks to implement based on --next, --subtask, or all.
 * Returns null when the caller should return early (all done / no match).
 */
function resolveTargetSubtasks(allSubtasks, opts) {
    if (opts.next) {
        const next = getNextPending(allSubtasks);
        if (!next) {
            logger.success('All subtasks are completed!');
            return null;
        }
        logger.info(`Next pending: ${next.id} ${next.title}`);
        return [next];
    }
    if (opts.subtask) {
        const matches = findSubtasks(allSubtasks, opts.subtask);
        if (matches.length === 0) {
            logger.error(`No subtask matching "${opts.subtask}" found.`);
            logger.dim('Available subtasks:');
            display.line(formatSubtaskList(allSubtasks));
            return null;
        }
        logger.info(`Matched ${matches.length} subtask(s):`);
        for (const m of matches) {
            logger.dim(`  ${m.id} ${m.title}`);
        }
        return matches;
    }
    // Implementing all subtasks
    logger.info(`Implementing all ${allSubtasks.length} subtasks`);
    return allSubtasks;
}
/**
 * Read parent chain artifacts (story, feature, epic) for richer context.
 */
async function gatherParentContext(projectDir, config, artifactType, taskId, taskData) {
    logger.info('Preparing implementation context...');
    const parents = await getParentChain(projectDir, config, artifactType, taskId);
    const allSubtasks = parseTaskMarkdown(taskData.content);
    logger.success(`Read ${taskId} (${allSubtasks.length} subtasks)`);
    let storyContent;
    let featureContent;
    let epicContent;
    const storyId = taskData.data.storyId;
    if (storyId) {
        storyContent = (await readArtifactRaw(projectDir, config, 'story', storyId)) || undefined;
        if (storyContent)
            logger.success(`Read parent story (${storyId})`);
    }
    if (parents.feature) {
        const featureId = parents.story?.data?.featureId;
        if (featureId) {
            featureContent =
                (await readArtifactRaw(projectDir, config, 'feature', featureId)) || undefined;
            if (featureContent)
                logger.success(`Read parent feature (${featureId})`);
        }
    }
    if (parents.epic) {
        const epicId = parents.feature?.data?.epicId;
        if (epicId) {
            epicContent = (await readArtifactRaw(projectDir, config, 'epic', epicId)) || undefined;
            if (epicContent)
                logger.success(`Read parent epic (${epicId})`);
        }
    }
    return { storyContent, featureContent, epicContent };
}
/**
 * Build the full implementation prompt including codebase context scanning.
 */
async function buildImplementationPrompt(projectDir, taskId, taskData, targetSubtasks, allSubtasks, parentContext) {
    const { storyContent, featureContent, epicContent } = parentContext;
    // Codebase context scanning (best-effort)
    let codebaseContext;
    try {
        const { buildCodebaseContext, formatCodebaseContext, extractKeywords } = await import('../ai/codebase/index.js');
        const textToAnalyze = [taskData.content, storyContent || '', featureContent || ''].join(' ');
        const keywords = extractKeywords(textToAnalyze);
        const ctx = await buildCodebaseContext(projectDir, keywords);
        codebaseContext = formatCodebaseContext(ctx);
        const stackInfo = ctx.techStack
            ? ` — ${ctx.techStack.language}${ctx.techStack.framework ? ` + ${ctx.techStack.framework}` : ''}`
            : '';
        logger.success(`Scanned codebase${stackInfo}`);
    }
    catch (err) {
        logger.debug('Codebase scanning failed', err);
    }
    return composeImplementationPrompt({
        taskId,
        taskTitle: taskData.data.title || taskId,
        taskContent: taskData.content,
        targetSubtasks,
        allSubtasks,
        storyContent,
        featureContent,
        epicContent,
        codebaseContext,
    });
}
/**
 * Display the composed prompt without executing (dry-run mode).
 */
function handleDryRun(prompt) {
    logger.heading('Dry Run — Composed Prompt:');
    display.separator(60);
    display.line(prompt);
    display.separator(60);
    logger.dim(`Prompt length: ${prompt.length} chars (~${Math.ceil(prompt.length / 4)} tokens)`);
}
/**
 * Resolve and launch the configured coding agent.
 * Returns the execution result, or null if the agent is unavailable.
 */
async function launchAgent(agentName, prompt, projectDir) {
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
        return null;
    }
    logger.dim(`Prompt: ${prompt.length.toLocaleString()} chars (~${Math.ceil(prompt.length / 4).toLocaleString()} tokens)`);
    logger.heading(`Launching ${agentName}...`);
    display.separator(60);
    const result = await agent.execute(prompt, {
        cwd: projectDir,
        stream: true,
        dryRun: false,
    });
    display.separator(60);
    return result;
}
// ---------------------------------------------------------------------------
// Mark subtasks as done
// ---------------------------------------------------------------------------
async function markSubtasksDone(projectDir, config, artifactType, taskId, subtasks) {
    const raw = await readArtifactRaw(projectDir, config, artifactType, taskId);
    if (!raw)
        return;
    const ids = new Set(subtasks.map((s) => s.id));
    let updated = raw;
    for (const id of ids) {
        // Match: `- [ ] 1.1 Title` (with optional leading whitespace for indented subtasks)
        const pattern = new RegExp(`^(\\s*- )\\[ \\](\\s+${id.replace('.', '\\.')}\\s)`, 'm');
        updated = updated.replace(pattern, '$1[x]$2');
    }
    if (updated !== raw) {
        await updateArtifact(projectDir, config, artifactType, taskId, updated);
        const count = ids.size;
        logger.success(`Marked ${count} subtask${count > 1 ? 's' : ''} as done in ${taskId}`);
    }
}
/**
 * Send a follow-up message to the coding agent, continuing the
 * previous session. This is the feedback loop for fixing issues
 * found after implementation.
 */
export async function executeFollowUp(projectDir, config, message, opts) {
    logger.heading('Fix / Follow-up');
    // Compose a focused fix prompt
    const prompt = composeFixPrompt(message);
    logger.dim(`Prompt: ${prompt.length.toLocaleString()} chars (~${Math.ceil(prompt.length / 4).toLocaleString()} tokens)`);
    const agentName = (opts.agent || config.defaultAgent || 'claude');
    const agent = await createAgent(agentName);
    const available = await agent.isAvailable();
    if (!available) {
        logger.error(`Coding agent "${agentName}" is not available.`);
        return;
    }
    logger.heading(`Continuing ${agentName} session...`);
    display.separator(60);
    const result = await agent.execute(prompt, {
        cwd: projectDir,
        stream: true,
        dryRun: false,
        continueSession: true,
    });
    display.separator(60);
    if (result.exitCode === 0) {
        logger.success(`${agentName} completed fix successfully.`);
        logger.dim('');
        logger.dim('Still broken? Run planr task fix again with the new error.');
    }
    else {
        logger.warn(`${agentName} exited with code ${result.exitCode}.`);
    }
}
/**
 * Compose a follow-up prompt that includes the error/issue context
 * and clear instructions to fix the previously implemented code.
 */
function composeFixPrompt(userMessage) {
    const sections = [];
    sections.push('# Fix Required\n');
    sections.push('The previously implemented code has an issue that needs fixing.\n');
    // Detect if the message looks like error output (long, has stack traces, etc.)
    const isErrorOutput = userMessage.length > 200 ||
        userMessage.includes('Error:') ||
        userMessage.includes('error:') ||
        userMessage.includes('FAIL') ||
        userMessage.includes('exit code');
    if (isErrorOutput) {
        sections.push('## Error Output\n');
        sections.push('```');
        sections.push(userMessage.trim());
        sections.push('```');
    }
    else {
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
//# sourceMappingURL=implementation-bridge.js.map