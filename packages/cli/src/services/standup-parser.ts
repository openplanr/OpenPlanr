/**
 * Heuristic parsing of a standup transcript into yesterday / today / blockers.
 */

export interface TranscriptSegment {
  section: 'yesterday' | 'today' | 'blockers' | 'note';
  text: string;
  /** Placeholder for future audio/text sync (milliseconds from clip start) */
  audioOffsetMs?: number;
}

export interface ParsedStandup {
  yesterday: string[];
  today: string[];
  blockers: string[];
  incomplete: boolean;
  notes: string[];
  /** Best-effort line segments (no audio yet — offsets unused until capture exists) */
  segments: TranscriptSegment[];
}

const YDAY = /^(yesterday|last day|previously|done)\s*[:-]?\s*(.+)$/i;
const TODAY = /^(today|now|this session|working on)\s*[:-]?\s*(.+)$/i;
const BLOCK = /^(blockers?|blocked|impediments?)\s*[:-]?\s*(.+)$/i;

export function parseStandupTranscript(raw: string): ParsedStandup {
  const yesterday: string[] = [];
  const today: string[] = [];
  const blockers: string[] = [];
  const notes: string[] = [];
  const segments: TranscriptSegment[] = [];

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let mode: 'y' | 't' | 'b' | null = null;

  for (const line of lines) {
    let m = line.match(YDAY);
    if (m) {
      mode = 'y';
      const t = m[2].trim();
      yesterday.push(t);
      segments.push({ section: 'yesterday', text: t });
      continue;
    }
    m = line.match(TODAY);
    if (m) {
      mode = 't';
      const t = m[2].trim();
      today.push(t);
      segments.push({ section: 'today', text: t });
      continue;
    }
    m = line.match(BLOCK);
    if (m) {
      mode = 'b';
      const t = m[2].trim();
      blockers.push(t);
      segments.push({ section: 'blockers', text: t });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const item = line.replace(/^[-*]\s+/, '').trim();
      if (mode === 'y') {
        yesterday.push(item);
        segments.push({ section: 'yesterday', text: item });
      } else if (mode === 't') {
        today.push(item);
        segments.push({ section: 'today', text: item });
      } else if (mode === 'b') {
        blockers.push(item);
        segments.push({ section: 'blockers', text: item });
      } else {
        notes.push(item);
        segments.push({ section: 'note', text: item });
      }
      continue;
    }

    if (mode === 'y') {
      yesterday.push(line);
      segments.push({ section: 'yesterday', text: line });
    } else if (mode === 't') {
      today.push(line);
      segments.push({ section: 'today', text: line });
    } else if (mode === 'b') {
      blockers.push(line);
      segments.push({ section: 'blockers', text: line });
    } else {
      notes.push(line);
      segments.push({ section: 'note', text: line });
    }
  }

  const incomplete = yesterday.length === 0 || today.length === 0;
  return { yesterday, today, blockers, incomplete, notes, segments };
}

export function formatStandupMarkdown(parsed: ParsedStandup): string {
  const sec = (title: string, items: string[]) => {
    const body = items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : '_— none recorded —_';
    return `## ${title}\n\n${body}`;
  };
  return [
    '# Standup',
    '',
    sec('Yesterday', parsed.yesterday),
    '',
    sec('Today', parsed.today),
    '',
    sec('Blockers', parsed.blockers),
    parsed.notes.length > 0 ? `\n## Notes\n\n${parsed.notes.map((n) => `- ${n}`).join('\n')}` : '',
    parsed.incomplete
      ? '\n> **Note:** Some standup sections look incomplete. Fill in missing parts before sending.\n'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
