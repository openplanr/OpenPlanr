/**
 * Cursor agent adapter.
 *
 * Since Cursor is GUI-based, this agent writes the implementation
 * prompt to a file that Cursor can read from its prompt panel.
 */

import path from 'node:path';
import { access } from 'node:fs/promises';
import { writeFile, ensureDir } from '../utils/fs.js';
import type { CodingAgent, AgentOptions, AgentResult } from './types.js';

export class CursorAgent implements CodingAgent {
  readonly name = 'cursor';

  async isAvailable(): Promise<boolean> {
    // Cursor is available if the project has a .cursor directory
    // or the cursor binary exists
    return access(path.join(process.cwd(), '.cursor')).then(() => true).catch(() => false);
  }

  async execute(prompt: string, options: AgentOptions): Promise<AgentResult> {
    const promptDir = path.join(options.cwd, '.cursor', 'prompts');
    await ensureDir(promptDir);

    // Extract task ID from prompt for filename
    const taskMatch = prompt.match(/TASK-\d{3}/);
    const filename = taskMatch ? `${taskMatch[0]}.md` : `implement-${Date.now()}.md`;
    const filePath = path.join(promptDir, filename);

    await writeFile(filePath, prompt);

    const output = [
      `Implementation prompt saved to: ${filePath}`,
      '',
      'To implement in Cursor:',
      '  1. Open Cursor in this project',
      '  2. Open the Command Palette (Cmd+Shift+P)',
      '  3. Run "Cursor: Open Prompt" and select the saved file',
      '  4. Or paste the prompt directly into Cursor\'s AI chat',
    ].join('\n');

    if (options.stream) {
      console.log(output);
    }

    return { output, exitCode: 0 };
  }
}
