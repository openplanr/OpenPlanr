/**
 * Cursor agent adapter.
 *
 * Since Cursor is GUI-based, this agent writes the implementation
 * prompt to a file that Cursor can read from its Composer panel.
 * For follow-up/fix prompts, it appends to the same file.
 */

import { access } from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, writeFile } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import type { AgentOptions, AgentResult, CodingAgent } from './types.js';

export class CursorAgent implements CodingAgent {
  readonly name = 'cursor';

  async isAvailable(): Promise<boolean> {
    // Cursor is available if the project has a .cursor directory
    return access(path.join(process.cwd(), '.cursor'))
      .then(() => true)
      .catch(() => false);
  }

  async execute(prompt: string, options: AgentOptions): Promise<AgentResult> {
    const promptDir = path.join(options.cwd, '.cursor', 'prompts');
    await ensureDir(promptDir);

    // Extract task ID from prompt for a meaningful filename
    const taskMatch = prompt.match(/TASK-\d{3}/);
    const filename = taskMatch ? `${taskMatch[0]}.md` : `implement-${Date.now()}.md`;
    const filePath = path.join(promptDir, filename);

    const header = options.continueSession ? '<!-- Follow-up / Fix prompt -->\n\n' : '';

    await writeFile(filePath, header + prompt);

    const action = options.continueSession ? 'Fix' : 'Implementation';
    const output = [
      `${action} prompt saved to: ${filePath}`,
      '',
      'To use in Cursor:',
      '  1. Open Cursor in this project',
      '  2. Open Composer (Cmd+I / Ctrl+I)',
      `  3. Reference the file: @${path.relative(options.cwd, filePath)}`,
      '  4. Or copy-paste the prompt directly into Composer',
    ].join('\n');

    if (options.stream) {
      console.log(output);
    }

    if (options.continueSession) {
      logger.dim('Note: Cursor does not support session continuation.');
      logger.dim(
        'The fix prompt has been saved as a new file — paste it into your existing Composer thread.',
      );
    }

    return { output, exitCode: 0 };
  }
}
