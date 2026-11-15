import type { OperateTodaySurfaceModel } from './today-model.js';

/** Presentation model for Operate Today, built from whichever Operate source the page has. */

export type TodayRowKind =
  | 'decision'
  | 'approval'
  | 'action'
  | 'verification'
  | 'outcome'
  | 'question';
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
  state: 'verified' | 'unproven' | 'reference';
  note: string;
}>;
export type TodayFact = Readonly<{ label: string; value: string; muted?: boolean }>;
export type TodayTile = Readonly<{ label: string; value: string; tone?: 'warning' }>;
export type TodayDecision = Readonly<{
  kind: TodayRowKind | 'current';
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

/** "Sat, 25 Oct"; a date without a time is read in UTC so the browser's time zone cannot move it. */
export function dayLabel(value: string, weekday = true): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const timeZone = /^\d{4}-\d{2}-\d{2}$/u.test(value.trim()) ? 'UTC' : undefined;
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(date);
  const day = `${part({ day: 'numeric' })} ${part({ month: 'short' })}`;
  return weekday ? `${part({ weekday: 'short' })}, ${day}` : day;
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
  const nothingWaiting = decisionCount + item.actions.length + item.gaps.length === 0;
  const title = nothingWaiting
    ? 'Nothing needs you today'
    : decisionCount === 0
      ? 'No decision is waiting'
      : decisionCount === 1
        ? 'One decision needs you'
        : `${decisionCount} decisions need you`;
  const waiting = [
    item.actions.length ? counted(item.actions.length, 'action', 'actions') : '',
    item.gaps.length ? counted(item.gaps.length, 'open question', 'open questions') : '',
  ].filter(Boolean);
  const seatLine = seats.length ? `${reported} of ${seats.length} seats reported.` : '';
  const closed = dayLabel(item.updatedAt, false);
  const summary = nothingWaiting
    ? `Cycle ${item.cycleId} closed${closed ? ` on ${closed}` : ''} with no decisions recorded.`
    : `${seatLine}${waitingSentence(waiting, item.actions.length + item.gaps.length)}`;
  const confidence = first ? recorded(first.confidence) : null;
  const decision: TodayDecision | null = first
    ? {
        kind: 'decision',
        id: first.id,
        title: first.title,
        owner: recorded(first.owner),
        tiles: [
          ...(confidence ? [{ label: 'Confidence', value: confidence }] : []),
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

type Attention = OperateTodaySurfaceModel['attention'][number];

const ATTENTION_ROW_KIND: Record<Attention['kind'], TodayRowKind> = {
  decision: 'decision',
  approval: 'approval',
  action: 'action',
  verification: 'verification',
  outcome: 'outcome',
  uncertainty: 'question',
};

const SITUATION: Record<TodayRowKind, readonly [string, (count: number) => string]> = {
  decision: ['One decision needs you', (n) => `${n} decisions need you`],
  approval: ['One approval waits for you', (n) => `${n} approvals wait for you`],
  action: ['One action is waiting', (n) => `${n} actions are waiting`],
  verification: ['One result needs checking', (n) => `${n} results need checking`],
  outcome: ['One outcome needs review', (n) => `${n} outcomes need review`],
  question: ['One open question', (n) => `${n} open questions`],
};

/** Page title for the gateway's attention list; a mixed list never names one kind. */
export function attentionSituation(kinds: readonly Attention['kind'][]): string | null {
  const rowKinds = new Set(kinds.map((kind) => ATTENTION_ROW_KIND[kind]));
  const [only] = rowKinds;
  if (!only) return null;
  if (rowKinds.size > 1) return `${kinds.length} items need you`;
  const [one, many] = SITUATION[only];
  return kinds.length === 1 ? one : many(kinds.length);
}

const METRIC_CHANGE = {
  added: 'is now available.',
  removed: 'is no longer available.',
  changed: 'has changed.',
  stale: 'may be out of date.',
  conflict: 'needs review.',
} as const;

function readableStatus(value: string): string {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function metricValue(value: number | null, unit: string | null): string {
  if (value === null) return 'Not observed';
  return unit ? `${value} ${unit}` : String(value);
}

function materialChange(model: OperateTodaySurfaceModel): string {
  const metric = model.domainMetrics[0];
  if (metric) {
    const metricTitle = metric.title ?? 'A key signal';
    if (metric.change) return `${metricTitle} ${METRIC_CHANGE[metric.change.kind]}`;
    const value = metric.value === null ? null : String(metric.value);
    return value
      ? `${metricTitle} is currently ${value}${metric.unit ? ` ${metric.unit}` : ''}.`
      : `${metricTitle} is current.`;
  }
  return model.priorityAttention?.whyNow ?? 'A fuller update is not available yet.';
}

function fact(label: string, value: string | null | undefined): TodayFact[] {
  return value?.trim() ? [{ label, value: value.trim() }] : [];
}

/** Today from the gateway's verified surface; the protocol carries no owner, confidence or seats. */
export function todayViewFromSurface(model: OperateTodaySurfaceModel): TodayView {
  const attention = model.priorityAttention;
  const focus = model.activeCycle.focus[0] ?? null;
  const action = model.continuation
    ? (model.actions.find((entry) => entry.actionId === model.continuation?.subjectId) ?? null)
    : null;
  const refs = [...new Set(model.attention.flatMap((entry) => entry.evidenceRefIds))];
  return {
    date: dayLabel(model.surface.generatedAt),
    cycleId: model.activeCycle.cycleId,
    cycleHref: model.activeCycle.deepLink,
    title:
      attentionSituation(model.attention.map((entry) => entry.kind)) ??
      focus ??
      'Continue this work',
    summary: materialChange(model),
    decision: {
      kind: attention ? ATTENTION_ROW_KIND[attention.kind] : 'current',
      id: attention?.subjectId ?? model.continuation?.subjectId ?? '',
      title: attention?.title ?? 'Continue this work',
      owner: null,
      tiles: [],
      facts: [
        ...fact('Why now', attention?.whyNow),
        ...fact('Expected result', action?.expectedResult),
        ...fact('If we wait', attention?.consequence),
      ],
    },
    rows: model.attention.map((entry) => ({
      key: entry.attentionId,
      kind: ATTENTION_ROW_KIND[entry.kind],
      id: entry.subjectId,
      title: entry.title,
      owner: null,
    })),
    seats: [],
    evidence: [
      ...model.domainMetrics.map((metric) => ({
        key: `metric:${metric.metricId}`,
        title: `${metric.title ?? 'Key signal'} · ${metricValue(metric.value, metric.unit)}`,
        state: 'reference' as const,
        note:
          readableStatus(metric.freshness) === readableStatus(metric.state)
            ? `${readableStatus(metric.freshness)} data`
            : `${readableStatus(metric.freshness)} data · ${readableStatus(metric.state)}`,
      })),
      ...refs.map((ref) => ({
        key: `ref:${ref}`,
        title: ref,
        state: 'reference' as const,
        note: '',
      })),
    ],
  };
}
