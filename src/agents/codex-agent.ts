/**
 * OpenAI Codex CLI agent adapter.
 *
 * Invokes the `codex` CLI binary with the implementation prompt
 * and streams output directly to the terminal in real time.
 */

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentOptions, AgentResult, CodingAgent } from './types.js';
import { which } from './utils.js';

export class CodexAgent implements CodingAgent {
  readonly name = 'codex';

  async isAvailable(): Promise<boolean> {
    return (await which('codex')) !== null;
  }

  async execute(prompt: string, options: AgentOptions): Promise<AgentResult> {
    // Write prompt to a temp file to avoid ARG_MAX and backpressure issues
    const tmpFile = path.join(tmpdir(), `planr-prompt-${Date.now()}.txt`);
    await writeFile(tmpFile, prompt, 'utf-8');

    try {
      return await new Promise<AgentResult>((resolve, reject) => {
        const child = spawn('codex', ['--quiet'], {
          cwd: options.cwd,
          stdio: ['pipe', 'inherit', 'inherit'],
          env: { ...process.env },
        });

        // Stream the temp file into stdin — handles backpressure correctly
        const fileStream = createReadStream(tmpFile, 'utf-8');
        fileStream.pipe(child.stdin);

        child.on('error', (err) => {
          reject(new Error(`Failed to launch codex CLI: ${err.message}`));
        });

        child.on('close', (code) => {
          resolve({
            output: '',
            exitCode: code ?? 1,
          });
        });
      });
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  }
}
