import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const CONFIG_FILENAME = 'planr.config.json';

export const DEFAULT_AGILE_DIR = 'docs/agile';
export const DEFAULT_CURSOR_RULES_DIR = '.cursor/rules';

export const ARTIFACT_DIRS = {
  epics: 'epics',
  features: 'features',
  stories: 'stories',
  tasks: 'tasks',
  quick: 'quick',
  backlog: 'backlog',
  sprints: 'sprints',
  adrs: 'adrs',
  checklists: 'checklists',
} as const;

export const ID_PREFIXES = {
  epic: 'EPIC',
  feature: 'FEAT',
  story: 'US',
  task: 'TASK',
  quick: 'QT',
  backlog: 'BL',
  sprint: 'SPRINT',
  adr: 'ADR',
} as const;

export function getTemplatesDir(): string {
  return path.resolve(__dirname, '..', 'templates');
}
