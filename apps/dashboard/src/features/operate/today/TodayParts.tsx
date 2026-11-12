import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CopyLabels,
  PcIcon,
  SelectionBar,
  Tabs,
  useCopyFeedback,
} from '../../../design-system/components/index.js';
import { useTapSelectWith } from '../../planning/planning-tap-select.js';
import { TOPBAR_ROUTE_TABS_ID } from '../../shell/shell-navigation.js';
import {
  TODAY_COMMAND,
  type TodayDecision,
  type TodayEvidence,
  type TodayRow,
  type TodayRowKind,
  type TodaySeat,
  type TodayView,
} from './today-view.js';
import './today.css';

const KIND_LABEL: Record<TodayRowKind, string> = {
  decision: 'Decision',
  action: 'Action',
  question: 'Question',
};
const KIND_TAB: Record<TodayRowKind, string> = {
  decision: 'Decisions',
  action: 'Actions',
  question: 'Questions',
};
const KIND_HREF: Record<TodayRowKind, (id: string) => string> = {
  decision: () => '#/operate/inbox',
  action: (id) => `#/operate/actions/${encodeURIComponent(id)}`,
  question: () => '#/operate/inbox',
};
const SEAT_LABEL = { reported: 'Reported', dissent: 'Dissent', waiting: 'Waiting' } as const;
const PLACES = [
  ['Today', '#/operate/today'],
  ['Inbox', '#/operate/inbox'],
  ['Cycles', '#/operate/cycles'],
  ['History', '#/operate/history'],
] as const;

/** Today, Inbox, Cycles and History in the top bar's route slot. */
function PlaceTabs({ inboxCount }: { inboxCount?: number }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setSlot(document.getElementById(TOPBAR_ROUTE_TABS_ID)), []);
  if (!slot) return null;
  return createPortal(
    <nav className="pc-operate-places" aria-label="Operate places">
      {PLACES.map(([label, href]) => (
        <a
          key={label}
          href={href}
          className="pc-operate-places__tab"
          aria-current={label === 'Today' ? 'page' : undefined}
        >
          {label}
          {label === 'Inbox' && inboxCount !== undefined ? (
            <span className="pc-operate-places__count">{inboxCount}</span>
          ) : null}
        </a>
      ))}
    </nav>,
    slot,
  );
}

function CommandButton({ label, primary = false }: { label: string; primary?: boolean }) {
  const feedback = useCopyFeedback(TODAY_COMMAND);
  const current = feedback.message || (feedback.state === 'pending' ? 'Copying' : label);
  return (
    <>
      <button
        type="button"
        className="pc-operate-today__command"
        data-variant={primary ? 'primary' : undefined}
        data-state={feedback.state}
        disabled={feedback.state === 'pending'}
        aria-busy={feedback.state === 'pending' || undefined}
        title={feedback.error || undefined}
        onClick={() => void feedback.copy()}
      >
        <CopyLabels idle={label} current={current} />
        {primary ? null : <code>{TODAY_COMMAND}</code>}
      </button>
      <span className="pc-visually-hidden" aria-live="polite" aria-atomic="true">
        {feedback.message}
        {feedback.error ? `: ${feedback.error}` : ''}
      </span>
    </>
  );
}

function TodayHeader({ view, page }: { view: TodayView; page: boolean }) {
  // Off Today the route keeps its own h1, so the situation title steps down a level.
  const Title = page ? 'h1' : 'h2';
  return (
    <header className="pc-operate-today__header">
      <div className="pc-operate-today__heading">
        <p className="pc-operate-today__eyebrow">
          {view.date ? `${view.date} · ` : null}
          <a href={view.cycleHref}>cycle {view.cycleId}</a>
        </p>
        <Title className="pc-operate-today__title">{view.title}</Title>
        {view.summary ? <p className="pc-operate-today__summary">{view.summary}</p> : null}
      </div>
      <CommandButton label="Run a review" />
    </header>
  );
}

function KindMark({ kind }: { kind: TodayRowKind }) {
  return <span className="pc-operate-today__kind-mark" data-kind={kind} aria-hidden="true" />;
}

function DecisionCard({ decision }: { decision: TodayDecision }) {
  return (
    <section className="pc-operate-today__card pc-operate-today__decision" aria-label="Decision">
      <header className="pc-operate-today__decision-head">
        <span className="pc-operate-today__pill">
          <KindMark kind="decision" />
          Decision
        </span>
        <span className="pc-operate-today__id">{decision.id}</span>
        {decision.owner ? (
          <span className="pc-operate-today__raised">Owner · {decision.owner}</span>
        ) : null}
      </header>
      <div className="pc-operate-today__decision-body">
        <h2>{decision.title}</h2>
        <dl className="pc-operate-today__tiles">
          {decision.tiles.map((tile) => (
            <div key={tile.label} className="pc-operate-today__tile" data-tone={tile.tone}>
              <dt>{tile.label}</dt>
              <dd>{tile.value}</dd>
            </div>
          ))}
        </dl>
        {decision.facts.length ? (
          <dl className="pc-operate-today__brief">
            {decision.facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd data-muted={fact.muted || undefined}>{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      <footer className="pc-operate-today__next">
        <span className="pc-operate-today__label">Next safe step</span>
        <code>{TODAY_COMMAND}</code>
        <CommandButton label="Copy command" primary />
      </footer>
    </section>
  );
}

function WaitingOnYou({
  rows,
  selectedKey,
  onSelect,
}: {
  rows: readonly TodayRow[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  const [kind, setKind] = useState<'all' | TodayRowKind>('all');
  const tap = useTapSelectWith((row: TodayRow) => onSelect(row.key));
  const kinds = (['decision', 'action', 'question'] as const).filter((entry) =>
    rows.some((row) => row.kind === entry),
  );
  const shown = kind === 'all' ? rows : rows.filter((row) => row.kind === kind);
  return (
    <section
      className="pc-operate-today__card pc-operate-today__waiting"
      aria-label="Waiting on you"
    >
      <header className="pc-operate-today__card-head">
        <h2>Waiting on you</h2>
        {kinds.length > 1 ? (
          <Tabs
            label="Kind of item"
            variant="pill"
            value={kind}
            tabs={[
              { id: 'all', label: 'All', count: rows.length },
              ...kinds.map((entry) => ({
                id: entry,
                label: KIND_TAB[entry],
                count: rows.filter((row) => row.kind === entry).length,
              })),
            ]}
            onChange={(next) => {
              const value = (['all', ...kinds] as const).find((entry) => entry === next);
              if (!value) return;
              setKind(value);
              if (
                value !== 'all' &&
                !rows.some((row) => row.key === selectedKey && row.kind === value)
              )
                onSelect(null);
            }}
          />
        ) : null}
      </header>
      <ul className="pc-operate-today__rows">
        {shown.map((row) => {
          const handlers = tap(row);
          const selected = row.key === selectedKey;
          return (
            <li
              key={row.key}
              className="pc-operate-today__row"
              data-selected={selected || undefined}
            >
              <a
                href={KIND_HREF[row.kind](row.id)}
                className="pc-operate-today__row-link"
                aria-current={selected ? 'true' : undefined}
                onFocus={() => onSelect(row.key)}
                onMouseDown={handlers?.onMouseDown}
                onClick={(event) => {
                  onSelect(row.key);
                  handlers?.onClick(event);
                }}
              >
                <span className="pc-operate-today__kind">
                  <KindMark kind={row.kind} />
                  {KIND_LABEL[row.kind]}
                </span>
                <span className="pc-operate-today__id">{row.id}</span>
                <span className="pc-operate-today__row-title" title={row.title}>
                  {row.title}
                </span>
                <span className="pc-operate-today__owner" title={row.owner ?? undefined}>
                  {row.owner}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SeatsCard({ seats }: { seats: readonly TodaySeat[] }) {
  const reported = seats.filter((seat) => seat.state !== 'waiting').length;
  return (
    <section
      className="pc-operate-today__card pc-operate-today__seats"
      aria-label="Executive seats"
    >
      <header className="pc-operate-today__card-head">
        <h2>Executive seats</h2>
        <span className="pc-operate-today__count">
          {reported}/{seats.length}
        </span>
      </header>
      <ul>
        {seats.map((seat) => (
          <li key={seat.name} className="pc-operate-today__seat" data-state={seat.state}>
            <span className="pc-operate-today__seat-name">{seat.name}</span>
            <span className="pc-operate-today__seat-focus">{seat.focus}</span>
            <span className="pc-operate-today__seat-state">
              <span className="pc-operate-today__seat-glyph" aria-hidden="true" />
              {SEAT_LABEL[seat.state]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EvidenceCard({ evidence }: { evidence: readonly TodayEvidence[] }) {
  return (
    <section className="pc-operate-today__card pc-operate-today__evidence" aria-label="Evidence">
      <header className="pc-operate-today__card-head">
        <h2>Evidence</h2>
      </header>
      <ul>
        {evidence.map((entry) => (
          <li key={entry.key} className="pc-operate-today__evidence-row" data-state={entry.state}>
            <span className="pc-operate-today__evidence-title">{entry.title}</span>
            <span className="pc-operate-today__evidence-state">
              {entry.state === 'verified' ? (
                <PcIcon name="check" size={13} />
              ) : (
                <span className="pc-operate-today__diamond" aria-hidden="true" />
              )}
              {entry.note}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Operate Today: the situation, the decision it asks for, what waits, seats and evidence. */
export function TodayLayout({
  view,
  places,
  inboxCount,
}: {
  view: TodayView;
  places: boolean;
  inboxCount?: number;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = view.rows.find((row) => row.key === selectedKey);
  return (
    <div className="pc-operate-today">
      {places ? <PlaceTabs inboxCount={inboxCount} /> : null}
      <TodayHeader view={view} page={places} />
      <div className="pc-operate-today__main">
        {view.decision ? <DecisionCard decision={view.decision} /> : null}
        {view.rows.length ? (
          <WaitingOnYou rows={view.rows} selectedKey={selectedKey} onSelect={setSelectedKey} />
        ) : null}
      </div>
      <div className="pc-operate-today__side">
        {view.seats.length ? <SeatsCard seats={view.seats} /> : null}
        {view.evidence.length ? <EvidenceCard evidence={view.evidence} /> : null}
      </div>
      <SelectionBar
        items={
          selected
            ? [
                {
                  id: selected.id,
                  title: selected.title,
                  command: `${selected.id} ${selected.title}`,
                },
              ]
            : []
        }
        copyLabel="Copy ID and title"
        onClear={() => setSelectedKey(null)}
      />
    </div>
  );
}
