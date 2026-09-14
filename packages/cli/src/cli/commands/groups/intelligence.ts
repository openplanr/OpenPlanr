import type { Command } from 'commander';
import { registerContextCommand } from '../context.js';
import { registerExportCommand } from '../export.js';
import { registerGitHubCommand } from '../github.js';
import { registerGraphCommand } from '../graph.js';
import { registerReportCommand } from '../report.js';
import { registerReportLinterCommand } from '../report-linter.js';
import { registerSearchCommand } from '../search.js';
import { registerVoiceCommand } from '../voice.js';

export function registerIntelligenceCommands(program: Command): void {
  registerExportCommand(program);
  registerReportCommand(program);
  registerReportLinterCommand(program);
  registerContextCommand(program);
  registerVoiceCommand(program);
  registerGitHubCommand(program);
  registerGraphCommand(program);
  registerSearchCommand(program);
}
