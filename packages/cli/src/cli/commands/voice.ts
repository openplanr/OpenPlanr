/**
 * `planr voice` — standup from transcript file or stdin (microphone capture is future work).
 */

import path from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../../services/config-service.js';
import { isNonInteractive } from '../../services/interactive-state.js';
import { promptConfirm, promptEditor } from '../../services/prompt-service.js';
import { lintWithProjectConfig } from '../../services/report-linter-service.js';
import { appendStandupToStory } from '../../services/story-standup-service.js';
import {
  readStandupTranscriptSource,
  transcriptToStandupMarkdown,
} from '../../services/voice-service.js';
import { writeFile } from '../../utils/fs.js';
import { display, logger } from '../../utils/logger.js';

export function registerVoiceCommand(program: Command) {
  const voice = program.command('voice').description('Voice-oriented standup helpers');

  voice
    .command('standup')
    .description('Convert a transcript file (or stdin) into structured standup markdown')
    .option('--file <path>', 'path to transcript text')
    .option(
      '--write <path>',
      'write standup markdown to this path (relative to project or absolute)',
    )
    .option('--edit', 'open generated markdown in $EDITOR before output/save (interactive only)')
    .option(
      '--reload-file',
      'after generating, offer to re-read --file from disk (interactive + --file only)',
    )
    .option('--append-story <storyId>', 'append standup under ## Standup notes on this story')
    .option('--lint', 'run standup through report linter')
    .action(
      async (opts: {
        file?: string;
        write?: string;
        edit?: boolean;
        reloadFile?: boolean;
        appendStory?: string;
        lint?: boolean;
      }) => {
        const projectDir = program.opts().projectDir as string;
        const config = await loadConfig(projectDir);

        const runOnce = async (text: string) => {
          let md = transcriptToStandupMarkdown(text);
          if (opts.edit && !isNonInteractive()) {
            md = await promptEditor('Edit standup markdown (save & close to apply):', md);
          }
          return md;
        };

        let text = await readStandupTranscriptSource({ file: opts.file });
        let md = await runOnce(text);
        display.line(md);

        while (
          opts.reloadFile &&
          opts.file &&
          !isNonInteractive() &&
          (await promptConfirm('Re-read transcript from file and regenerate?', false))
        ) {
          text = await readStandupTranscriptSource({ file: opts.file });
          md = await runOnce(text);
          display.line(md);
        }

        if (opts.lint) {
          const lint = lintWithProjectConfig(md, 'standup', config);
          for (const f of lint.findings) {
            display.line(`[${f.severity}] ${f.message}`);
          }
          if (!lint.ok) process.exit(1);
        }

        if (opts.write) {
          const out = path.isAbsolute(opts.write) ? opts.write : path.join(projectDir, opts.write);
          await writeFile(out, `${md}\n`);
          logger.success(`Wrote ${path.relative(projectDir, out) || out}`);
        }

        if (opts.appendStory) {
          await appendStandupToStory(projectDir, config, opts.appendStory, md);
          logger.success(`Appended standup to ${opts.appendStory}`);
        }
      },
    );
}
