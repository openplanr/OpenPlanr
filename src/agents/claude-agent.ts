/**
 * Claude Code CLI agent adapter.
 *
 * Invokes the `claude` CLI binary with --print mode, writing the
 * prompt to a temp file and piping it via stdin. Output streams
 * directly to the user's terminal for real-time feedback.
 */

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentOptions, AgentResult, CodingAgent } from './types.js';
import { which } from './utils.js';

export class ClaudeAgent implements CodingAgent {
  readonly name = 'claude';

  async isAvailable(): Promise<boolean> {
    return (await which('claude')) !== null;
  }

  async execute(prompt: string, options: AgentOptions): Promise<AgentResult> {
    // Write prompt to a temp file to avoid both ARG_MAX limits and
    // Node.js stream backpressure issues with large prompts
    const tmpFile = path.join(tmpdir(), `planr-prompt-${Date.now()}.txt`);
    await writeFile(tmpFile, prompt, 'utf-8');

    try {
      return await new Promise<AgentResult>((resolve, reject) => {
        const child = spawn('claude', ['--print'], {
          cwd: options.cwd,
          // stdin: pipe from temp file; stdout/stderr: inherit for real-time output
          stdio: ['pipe', 'inherit', 'inherit'],
          env: { ...process.env },
        });

        // Stream the temp file into stdin — handles backpressure correctly
        const fileStream = createReadStream(tmpFile, 'utf-8');
        fileStream.pipe(child.stdin);

        child.on('error', (err) => {
          reject(new Error(`Failed to launch claude CLI: ${err.message}`));
        });

        child.on('close', (code) => {
          resolve({
            output: '', // Output went directly to terminal via inherit
            exitCode: code ?? 1,
          });
        });
      });
    } finally {
      // Clean up temp file
      await unlink(tmpFile).catch(() => {});
    }
  }
}
