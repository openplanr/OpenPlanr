/**
 * OpenAI Codex CLI agent adapter.
 *
 * Invokes `codex exec --full-auto --json` for non-interactive mode with
 * write access. Parses JSONL events for real-time progress display.
 * Includes retry logic for transient errors.
 */

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import { type CodexEvent, createProgressSpinner, describeCodexActivity } from './progress.js';
import type { AgentOptions, AgentResult, CodingAgent } from './types.js';
import { isRetryableError, MAX_RETRIES, RETRY_DELAY_MS, sleep, which } from './utils.js';

export class CodexAgent implements CodingAgent {
  readonly name = 'codex';

  async isAvailable(): Promise<boolean> {
    return (await which('codex')) !== null;
  }

  async execute(prompt: string, options: AgentOptions): Promise<AgentResult> {
    const tmpFile = path.join(tmpdir(), `planr-prompt-${Date.now()}.txt`);
    await writeFile(tmpFile, prompt, 'utf-8');

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

        const result = await this.spawnCodex(tmpFile, options);
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

  private spawnCodex(
    tmpFile: string,
    options: AgentOptions,
  ): Promise<AgentResult & { stderr: string }> {
    return new Promise((resolve, reject) => {
      const args = this.buildArgs(options);

      const child = spawn('codex', args, {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      // Stream the temp file into stdin
      const fileStream = createReadStream(tmpFile, 'utf-8');
      fileStream.pipe(child.stdin);

      const { spinner, stderrChunks, resultRef } = this.attachListeners(child);

      child.on('error', (err) => {
        spinner.stop();
        reject(new Error(`Failed to launch codex CLI: ${err.message}`));
      });

      child.on('close', (code) => {
        spinner.stop();

        if (resultRef.text) {
          console.log(resultRef.text);
        }

        if (code !== 0) {
          const stderr = stderrChunks.join('');
          if (stderr) process.stderr.write(stderr);
        }

        resolve({
          output: resultRef.text,
          exitCode: code ?? 1,
          stderr: stderrChunks.join(''),
        });
      });
    });
  }

  private buildArgs(options: AgentOptions): string[] {
    if (options.continueSession) {
      return ['exec', 'resume', '--last'];
    }

    return ['exec', '--full-auto', '--json'];
  }

  private attachListeners(child: ReturnType<typeof spawn>) {
    const spinner = createProgressSpinner();
    const stderrChunks: string[] = [];
    const resultRef = { text: '' };
    let jsonBuffer = '';

    child.stdout?.on('data', (data: Buffer) => {
      jsonBuffer += data.toString();
      const lines = jsonBuffer.split('\n');
      jsonBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed) as CodexEvent;

          const activity = describeCodexActivity(event);
          if (activity) {
            spinner.setActivity(activity);
            process.stderr.write(`\r\x1b[K${chalk.green('✓')} ${chalk.dim(activity)}\n`);
          }

          // Capture the last agent message as the result text
          if (
            event.type === 'item.completed' &&
            event.item?.type === 'agent_message' &&
            event.item.text
          ) {
            resultRef.text = event.item.text;
          }
        } catch {
          // Incomplete JSON line — skip
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderrChunks.push(data.toString());
    });

    return { spinner, stderrChunks, resultRef };
  }
}
