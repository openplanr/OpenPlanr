/**
 * Claude Code CLI agent adapter.
 *
 * Spawns `claude --print` with stream-json output, showing real-time
 * progress via the shared progress spinner. Includes automatic retry
 * for transient API errors.
 */

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import { createProgressSpinner, describeActivity, type StreamEvent } from './progress.js';
import type { AgentOptions, AgentResult, CodingAgent } from './types.js';
import { isRetryableError, MAX_RETRIES, RETRY_DELAY_MS, sleep, which } from './utils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default tool set — we use all standard tools. Claude Code already
 * enforces CWD sandboxing and default permission checks. The safety
 * prompt below handles project-scoped constraints.
 */
const ALLOWED_TOOLS = ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep'] as const;

const SAFETY_PROMPT = [
  'IMPORTANT SAFETY RULES:',
  '1. NEVER run system-wide destructive commands: docker system prune, docker volume prune, docker image prune -a, or similar commands that affect resources beyond this project.',
  '2. For docker cleanup, ONLY use project-scoped commands: docker compose down, docker compose rm.',
  '3. NEVER run sudo or any privilege escalation.',
  '4. NEVER run rm -rf on directories you did not create in this session.',
  '5. When unsure if a command is destructive, explain what you would run and ask the user to execute it manually.',
].join('\n');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write prompt to a temp file to avoid ARG_MAX / backpressure issues */
async function writeTempPrompt(prompt: string): Promise<string> {
  const tmpFile = path.join(tmpdir(), `planr-prompt-${Date.now()}.txt`);
  await writeFile(tmpFile, prompt, 'utf-8');
  return tmpFile;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class ClaudeAgent implements CodingAgent {
  readonly name = 'claude';

  async isAvailable(): Promise<boolean> {
    return (await which('claude')) !== null;
  }

  async execute(prompt: string, options: AgentOptions): Promise<AgentResult> {
    const tmpFile = await writeTempPrompt(prompt);

    try {
      let lastExitCode = 1;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const delaySec = (RETRY_DELAY_MS * attempt) / 1000;
          process.stderr.write(
            `\n⟳ Retrying (attempt ${attempt + 1}/${MAX_RETRIES + 1}) in ${delaySec}s...\n`,
          );
          await sleep(RETRY_DELAY_MS * attempt);
        }

        const result = await this.spawnClaude(tmpFile, options);
        lastExitCode = result.exitCode;

        if (result.exitCode === 0) return result;
        if (result.stderr && isRetryableError(result.stderr)) continue;
        return result;
      }

      return { output: '', exitCode: lastExitCode };
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private spawnClaude(
    tmpFile: string,
    options: AgentOptions,
  ): Promise<AgentResult & { stderr: string }> {
    return new Promise((resolve, reject) => {
      const args = this.buildArgs(options);

      const child = spawn('claude', args, {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      const fileStream = createReadStream(tmpFile, 'utf-8');
      fileStream.pipe(child.stdin);

      const { spinner, stderrChunks, resultRef, statsRef } = this.attachListeners(child);

      child.on('error', (err) => {
        spinner.stop();
        reject(new Error(`Failed to launch claude CLI: ${err.message}`));
      });

      child.on('close', (code) => {
        spinner.stop();
        this.printSummary(resultRef.text, statsRef, stderrChunks, code);

        resolve({
          output: resultRef.text,
          exitCode: code ?? 1,
          stderr: stderrChunks.join(''),
        });
      });
    });
  }

  private buildArgs(options: AgentOptions): string[] {
    const args = [
      '--print',
      '--verbose',
      '--output-format',
      'stream-json',
      '--allowedTools',
      ...ALLOWED_TOOLS,
      '--append-system-prompt',
      SAFETY_PROMPT,
    ];

    if (options.continueSession) {
      args.push('--continue');
    }

    return args;
  }

  private attachListeners(child: ReturnType<typeof spawn>) {
    const spinner = createProgressSpinner();
    const stderrChunks: string[] = [];
    const resultRef = { text: '' };
    const statsRef = { filesCreated: 0, filesEdited: 0 };
    let jsonBuffer = '';

    child.stdout?.on('data', (data: Buffer) => {
      jsonBuffer += data.toString();
      const lines = jsonBuffer.split('\n');
      jsonBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed) as StreamEvent;

          const activity = describeActivity(event);
          if (activity) {
            spinner.setActivity(activity);
            if (activity.startsWith('Creating ')) statsRef.filesCreated++;
            if (activity.startsWith('Editing ')) statsRef.filesEdited++;
            process.stderr.write(`\r\x1b[K${chalk.green('✓')} ${chalk.dim(activity)}\n`);
          }

          if (event.type === 'result') {
            resultRef.text = event.result || '';
          }
        } catch {
          // Incomplete JSON line — skip
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderrChunks.push(data.toString());
    });

    return { spinner, stderrChunks, resultRef, statsRef };
  }

  private printSummary(
    resultText: string,
    stats: { filesCreated: number; filesEdited: number },
    stderrChunks: string[],
    exitCode: number | null,
  ) {
    if (resultText) {
      console.log(resultText);
    }

    const parts: string[] = [];
    if (stats.filesCreated > 0) {
      parts.push(`${stats.filesCreated} file${stats.filesCreated > 1 ? 's' : ''} created`);
    }
    if (stats.filesEdited > 0) {
      parts.push(`${stats.filesEdited} file${stats.filesEdited > 1 ? 's' : ''} edited`);
    }
    if (parts.length > 0) {
      console.log(chalk.dim(`\n📊 ${parts.join(', ')}`));
    }

    if (exitCode !== 0) {
      const stderr = stderrChunks.join('');
      if (stderr) process.stderr.write(stderr);
    }
  }
}
