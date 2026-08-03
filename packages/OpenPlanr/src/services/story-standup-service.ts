/**
 * Append generated standup markdown to a user story file.
 */

import type { OpenPlanrConfig } from '../models/types.js';
import { readArtifactRaw, updateArtifact } from './artifact-service.js';

const STANDUP_SECTION = '## Standup notes';

export function injectStandupSection(raw: string, standupMarkdown: string, date: string): string {
  const block = `\n### ${date}\n\n${standupMarkdown.trim()}\n`;

  if (raw.includes(STANDUP_SECTION)) {
    const idx = raw.indexOf(STANDUP_SECTION) + STANDUP_SECTION.length;
    return `${raw.slice(0, idx)}${block}${raw.slice(idx)}`;
  }

  const tasksMatch = /\n## Tasks\b/m.exec(raw);
  if (tasksMatch?.index !== undefined) {
    const i = tasksMatch.index;
    return `${raw.slice(0, i)}\n\n${STANDUP_SECTION}\n${block}\n${raw.slice(i)}`;
  }

  return `${raw.trimEnd()}\n\n${STANDUP_SECTION}\n${block}\n`;
}

export async function appendStandupToStory(
  projectDir: string,
  config: OpenPlanrConfig,
  storyId: string,
  standupMarkdown: string,
): Promise<void> {
  const raw = await readArtifactRaw(projectDir, config, 'story', storyId);
  if (!raw) throw new Error(`Story ${storyId} not found.`);

  const date = new Date().toISOString().split('T')[0];
  const next = injectStandupSection(raw, standupMarkdown, date);
  await updateArtifact(projectDir, config, 'story', storyId, next);
}
