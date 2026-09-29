import { display, logger } from '../utils/logger.js';
import { joinNames } from './runtime-change-summary.js';
import type {
  ExecuteCliHalfUpgradeResult,
  ReleaseNoteSection,
  UpgradeNextStep,
} from './upgrade-service.js';

export type ReleaseNotesMode = 'highlights' | 'full';

const HIGHLIGHTS_PER_RELEASE = 5;

function releaseNotesUrl(version: string): string {
  return `https://github.com/openplanr/OpenPlanr/releases/tag/openplanr%40${version}`;
}

/** The first sentence of a changelog entry, or the whole entry when it has one sentence. */
export function firstSentence(text: string): string {
  return /^(.+?[.!?])\s+(?=[A-Z`"(*])/s.exec(text)?.[1] ?? text;
}

/** Word-wraps `text` to lines of at most `width` columns; a longer word gets its own line. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function terminalWidth(): number {
  return Math.min(process.stdout.columns || 80, 100);
}

/** Per release, up to five first sentences in `highlights` mode, or every entry in full. */
export function printReleaseNotes(
  sections: ReleaseNoteSection[],
  installedVersion: string,
  mode: ReleaseNotesMode,
): void {
  if (sections.length === 0) return;
  display.blank();
  display.heading("What's new");
  const width = terminalWidth() - 6;
  for (const section of sections) {
    display.line(`  ${section.version}`);
    const entries =
      mode === 'full'
        ? section.entries
        : section.entries.slice(0, HIGHLIGHTS_PER_RELEASE).map(firstSentence);
    for (const entry of entries) {
      const [first, ...rest] = wrapText(entry, width);
      display.line(`    • ${first}`);
      for (const line of rest) display.line(`      ${line}`);
    }
    const hidden = section.entries.length - entries.length;
    if (hidden > 0) display.line(`    … and ${hidden} more`);
  }
  display.line(`  Full notes: ${releaseNotesUrl(installedVersion)}`);
}

/** The commands that bring each installed coding agent up to date, then the restart. */
export function printNextSteps(steps: UpgradeNextStep[], error?: string): void {
  display.blank();
  display.heading('Next');
  if (error) {
    logger.warn(`${error} Run \`planr upgrade status\` to see what else needs updating.`);
    return;
  }
  if (steps.length === 0) {
    logger.success('Your coding agents are up to date.');
    return;
  }
  steps.forEach((step, index) => {
    display.numbered(index + 1, step.command);
    display.line(`       ${step.host}: ${step.detail}`);
  });
  const hosts = [...new Set(steps.filter((step) => step.runtime).map((step) => step.host))];
  display.line(
    hosts.length > 0
      ? `  Then restart ${joinNames(hosts)} and check with \`planr upgrade status\`.`
      : '  Then check with `planr upgrade status`.',
  );
}

/** How `planr upgrade apply` and the inline upgrade offer report an upgrade. */
export function printUpgradeReport(
  result: ExecuteCliHalfUpgradeResult,
  mode: ReleaseNotesMode,
): void {
  if (!result.ok) {
    logger.error(result.failure?.message ?? 'The upgrade did not complete.');
    if (result.restoredTo) logger.info(`Restored the previous version ${result.restoredTo}.`);
    return;
  }
  logger.success(
    `Upgraded OpenPlanr from ${result.previousVersion} to ${result.installedVersion}.`,
  );
  if (result.releaseNotesError) logger.warn(result.releaseNotesError);
  printReleaseNotes(result.releaseNotes, result.installedVersion, mode);
  printNextSteps(result.nextSteps, result.nextStepsError);
}
