/** Presentation model for Operate Today, built from whichever Operate source the page has. */

export type TodayRowKind = 'decision' | 'action' | 'question';
export type TodayRow = Readonly<{
  key: string;
  kind: TodayRowKind;
  id: string;
  title: string;
  owner: string | null;
}>;
export type TodaySeatState = 'reported' | 'dissent' | 'waiting';
export type TodaySeat = Readonly<{ name: string; focus: string | null; state: TodaySeatState }>;
export type TodayEvidence = Readonly<{
  key: string;
  title: string;
  state: 'verified' | 'unproven';
  note: string;
}>;
export type TodayFact = Readonly<{ label: string; value: string; muted?: boolean }>;
export type TodayTile = Readonly<{ label: string; value: string; tone?: 'warning' }>;
export type TodayDecision = Readonly<{
  id: string;
  title: string;
  owner: string | null;
  tiles: readonly TodayTile[];
  facts: readonly TodayFact[];
}>;
export type TodayView = Readonly<{
  date: string | null;
  cycleId: string;
  cycleHref: string;
  title: string;
  summary: string;
  decision: TodayDecision | null;
  rows: readonly TodayRow[];
  seats: readonly TodaySeat[];
  evidence: readonly TodayEvidence[];
}>;

export const TODAY_COMMAND = '/planr:operate';

/** The seven Operate seats and what each one looks at. */
export const OPERATE_SEATS = [
  ['CEO', 'Strategy, runway, cost of delay'],
  ['CTO', 'Architecture and delivery risk'],
  ['CPO', 'Product bets and user value'],
  ['CMO', 'Positioning, demand, retention'],
  ['COO', 'Execution and operating cadence'],
  ['CHAIR', 'Brings the reports together'],
  ['CHALLENGER', 'Tests the board’s assumptions'],
] as const;

type LocalReviewInput = Readonly<{
  cycleId: string;
  href: string;
  updatedAt: string;
  decisions: readonly Readonly<{
    id: string;
    title: string;
    whyNow: string;
    owner: string;
    confidence: string;
    firstStep: string;
    expectedResult: string;
    dissent: string;
  }>[];
  actions: readonly Readonly<{ id: string; action: string; owner: string }>[];
  gaps: readonly Readonly<{ id: string; title: string }>[];
  lenses: readonly Readonly<{ name: string; present: boolean; signal: string }>[];
  evidence: readonly Readonly<{ id: string; reference: string; freshness: string }>[];
}>;

// The local review reader fills missing fields with these words instead of leaving them empty.
const READER_PLACEHOLDERS = new Set(['', 'none', 'not recorded', 'unassigned']);

function recorded(value: string): string | null {
  const trimmed = value.trim();
  return READER_PLACEHOLDERS.has(trimmed.toLowerCase()) ? null : trimmed;
}

function dayLabel(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', options).format(date);
  return `${part({ weekday: 'short' })}, ${part({ day: 'numeric' })} ${part({ month: 'short' })}`;
}

function counted(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

function waitingSentence(parts: readonly string[], total: number): string {
  if (parts.length === 0) return '';
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return ` ${list} ${total === 1 ? 'is' : 'are'} waiting.`;
}

function seatState(lens: LocalReviewInput['lenses'][number]): TodaySeatState {
  if (!lens.present) return 'waiting';
  const signal = lens.signal.toLowerCase();
  const challenged = lens.name.toLowerCase() === 'challenger' && signal.includes('exception');
  return signal.includes('dissent') || challenged ? 'dissent' : 'reported';
}

function seatFocus(name: string): string | null {
  const seat = OPERATE_SEATS.find(([role]) => role === name.trim().toUpperCase());
  return seat ? seat[1] : null;
}

/** Today from the latest completed local review; placeholder values from the reader are left out. */
export function todayViewFromLocalReview(item: LocalReviewInput): TodayView {
  const first = item.decisions[0];
  const seats = item.lenses.map((lens) => ({
    name: lens.name,
    focus: seatFocus(lens.name),
    state: seatState(lens),
  }));
  const reported = seats.filter((seat) => seat.state !== 'waiting').length;
  const decisionCount = item.decisions.length;
  const title =
    decisionCount === 0
      ? 'No decision is waiting'
      : decisionCount === 1
        ? 'One decision needs you'
        : `${decisionCount} decisions need you`;
  const waiting = [
    item.actions.length ? counted(item.actions.length, 'action', 'actions') : '',
    item.gaps.length ? counted(item.gaps.length, 'open question', 'open questions') : '',
  ].filter(Boolean);
  const seatLine = seats.length ? `${reported} of ${seats.length} seats reported.` : '';
  const summary = `${seatLine}${waitingSentence(waiting, item.actions.length + item.gaps.length)}`;
  const decision: TodayDecision | null = first
    ? {
        id: first.id,
        title: first.title,
        owner: recorded(first.owner),
        tiles: [
          ...(recorded(first.confidence)
            ? [{ label: 'Confidence', value: recorded(first.confidence) ?? '' }]
            : []),
          {
            label: 'Evidence gaps',
            value: String(item.gaps.length),
            ...(item.gaps.length ? { tone: 'warning' as const } : {}),
          },
          {
            label: 'Dissent kept',
            value: String(item.decisions.filter((entry) => recorded(entry.dissent)).length),
          },
        ],
        facts: [
          ['First step', first.firstStep],
          ['Expected result', first.expectedResult],
          ['If we wait', first.whyNow],
          ['Dissent', first.dissent],
        ].flatMap(([label, value]) => {
          const text = recorded(value);
          return text
            ? [{ label, value: text, ...(label === 'Dissent' ? { muted: true } : {}) }]
            : [];
        }),
      }
    : null;
  return {
    date: dayLabel(item.updatedAt),
    cycleId: item.cycleId,
    cycleHref: item.href,
    title,
    summary: summary.trim(),
    decision,
    rows: [
      ...item.decisions.map((entry) => ({
        key: `decision:${entry.id}`,
        kind: 'decision' as const,
        id: entry.id,
        title: entry.title,
        owner: recorded(entry.owner),
      })),
      ...item.actions.map((entry) => ({
        key: `action:${entry.id}`,
        kind: 'action' as const,
        id: entry.id,
        title: entry.action,
        owner: recorded(entry.owner),
      })),
      ...item.gaps.map((entry) => ({
        key: `question:${entry.id}`,
        kind: 'question' as const,
        id: entry.id,
        title: entry.title,
        owner: null,
      })),
    ],
    seats,
    evidence: [
      ...item.evidence.map((entry) => ({
        key: `evidence:${entry.id}`,
        title: entry.reference,
        state: 'verified' as const,
        note: recorded(entry.freshness) ? `Verified · ${entry.freshness.trim()}` : 'Verified',
      })),
      ...item.gaps.map((entry) => ({
        key: `gap:${entry.id}`,
        title: entry.title,
        state: 'unproven' as const,
        note: 'Not proven yet',
      })),
    ],
  };
}
