import { type ReactNode, useId, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CopyLabels,
  PcIcon,
  SelectionBar,
  Tabs,
  useCopyFeedback,
} from '../../../design-system/components/index.js';
import { useHomePhoneWidth } from '../../planning/planning-home-view.js';
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

const KIND_LABEL: Record<TodayRowKind | 'current', string> = {
  decision: 'Decision',
  approval: 'Approval',
  action: 'Action',
  verification: 'To verify',
  outcome: 'Outcome',
  question: 'Question',
  current: 'Current work',
};
const KIND_TAB: Record<TodayRowKind, string> = {
  decision: 'Decisions',
  approval: 'Approvals',
  action: 'Actions',
  verification: 'To verify',
  outcome: 'Outcomes',
  question: 'Questions',
};
const KIND_ORDER = [
  'decision',
  'approval',
  'action',
  'verification',
  'outcome',
  'question',
] as const;
const KIND_HREF: Record<TodayRowKind, (id: string) => string> = {
  decision: () => '#/operate/inbox',
  approval: () => '#/operate/inbox',
  action: (id) => `#/operate/actions/${encodeURIComponent(id)}`,
  verification: () => '#/operate/inbox',
  outcome: (id) => `#/operate/outcomes/${encodeURIComponent(id)}`,
  question: () => '#/operate/inbox',
};
const PHONE_TILE_LABEL: Readonly<Record<string, string>> = {
  'Evidence gaps': 'Gaps',
  'Dissent kept': 'Dissent',
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

function TodayHeader({ view, page, phone }: { view: TodayView; page: boolean; phone: boolean }) {
  // Off Today the route keeps its own h1, so the situation title steps down a level.
  const Title = page ? 'h1' : 'h2';
  return (
    <header className="pc-operate-today__header">
      <div className="pc-operate-today__heading">
        <p className="pc-operate-today__eyebrow">
          {view.date && !phone ? `${view.date} · ` : null}
          <a href={view.cycleHref}>cycle {view.cycleId}</a>
        </p>
        <Title className="pc-operate-today__title">{view.title}</Title>
        {view.summary ? <p className="pc-operate-today__summary">{view.summary}</p> : null}
      </div>
      <CommandButton label="Run a review" />
    </header>
  );
}

function KindMark({ kind }: { kind: TodayRowKind | 'current' }) {
  return <span className="pc-operate-today__kind-mark" data-kind={kind} aria-hidden="true" />;
}

function DecisionCard({
  decision,
  next,
  phone,
}: {
  decision: TodayDecision;
  next?: ReactNode;
  phone: boolean;
}) {
  return (
    <section
      className="pc-operate-today__card pc-operate-today__decision"
      aria-label={KIND_LABEL[decision.kind]}
    >
      <header className="pc-operate-today__decision-head">
        <span className="pc-operate-today__pill" data-kind={decision.kind}>
          <KindMark kind={decision.kind} />
          {KIND_LABEL[decision.kind]}
        </span>
        {decision.id ? <span className="pc-operate-today__id">{decision.id}</span> : null}
        {decision.owner ? (
          <span className="pc-operate-today__owner-line">Owner · {decision.owner}</span>
        ) : null}
      </header>
      <div className="pc-operate-today__decision-body">
        <h2>{decision.title}</h2>
        {decision.tiles.length ? (
          <dl className="pc-operate-today__tiles">
            {decision.tiles.map((tile) => (
              <div key={tile.label} className="pc-operate-today__tile" data-tone={tile.tone}>
                <dt>{(phone && PHONE_TILE_LABEL[tile.label]) || tile.label}</dt>
                <dd>{tile.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
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
        {next ?? (
          <>
            <code>{TODAY_COMMAND}</code>
            <CommandButton label="Copy command" primary />
          </>
        )}
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
  const kinds = KIND_ORDER.filter((entry) => rows.some((row) => row.kind === entry));
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

/** A card head; on a phone it is a disclosure that shows the card's list in place. */
function CardHead({
  title,
  count,
  listId,
  phone,
  open,
  onToggle,
}: {
  title: string;
  count: ReactNode;
  listId: string;
  phone: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <header className="pc-operate-today__card-head">
      {phone ? (
        <h2>
          <button
            type="button"
            className="pc-operate-today__disclosure"
            aria-expanded={open}
            aria-controls={listId}
            onClick={onToggle}
          >
            {title}
            {count}
            <PcIcon name="chevron-right" size={15} />
          </button>
        </h2>
      ) : (
        <>
          <h2>{title}</h2>
          {count}
        </>
      )}
    </header>
  );
}

function SeatsCard({ seats, phone }: { seats: readonly TodaySeat[]; phone: boolean }) {
  const reported = seats.filter((seat) => seat.state !== 'waiting').length;
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <section
      className="pc-operate-today__card pc-operate-today__seats"
      aria-label="Executive seats"
    >
      <CardHead
        title="Executive seats"
        count={
          <span className="pc-operate-today__count">
            {reported}/{seats.length}
          </span>
        }
        listId={listId}
        phone={phone}
        open={open}
        onToggle={() => setOpen(!open)}
      />
      <ul id={listId} hidden={phone && !open}>
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

/** The phone disclosure's count: what is not proven first, else what is verified, else the total. */
function evidenceCount(evidence: readonly TodayEvidence[]) {
  const unproven = evidence.filter((entry) => entry.state === 'unproven').length;
  const verified = evidence.filter((entry) => entry.state === 'verified').length;
  if (unproven) return { text: `${unproven} not proven`, warning: true };
  return { text: verified ? `${verified} verified` : String(evidence.length), warning: false };
}

function EvidenceCard({ evidence, phone }: { evidence: readonly TodayEvidence[]; phone: boolean }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const count = evidenceCount(evidence);
  return (
    <section className="pc-operate-today__card pc-operate-today__evidence" aria-label="Evidence">
      <CardHead
        title="Evidence"
        count={
          phone ? (
            <span
              className="pc-operate-today__evidence-count"
              data-tone={count.warning ? 'warning' : undefined}
            >
              {count.text}
            </span>
          ) : null
        }
        listId={listId}
        phone={phone}
        open={open}
        onToggle={() => setOpen(!open)}
      />
      <ul id={listId} hidden={phone && !open}>
        {evidence.map((entry) => (
          <li key={entry.key} className="pc-operate-today__evidence-row" data-state={entry.state}>
            <span className="pc-operate-today__evidence-title">{entry.title}</span>
            {entry.note ? (
              <span className="pc-operate-today__evidence-state">
                {entry.state === 'verified' ? <PcIcon name="check" size={13} /> : null}
                {entry.state === 'unproven' ? (
                  <span className="pc-operate-today__diamond" aria-hidden="true" />
                ) : null}
                {entry.note}
              </span>
            ) : null}
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
  next,
  notices,
}: {
  view: TodayView;
  places: boolean;
  inboxCount?: number;
  next?: ReactNode;
  notices?: ReactNode;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const phone = useHomePhoneWidth();
  const selected = view.rows.find((row) => row.key === selectedKey);
  return (
    <div className="pc-operate-today">
      {places ? <PlaceTabs inboxCount={inboxCount} /> : null}
      <TodayHeader view={view} page={places} phone={phone} />
      {notices}
      <section className="pc-operate-today__main" aria-label="Today decision workspace">
        {view.decision ? <DecisionCard decision={view.decision} next={next} phone={phone} /> : null}
        {view.rows.length ? (
          <WaitingOnYou rows={view.rows} selectedKey={selectedKey} onSelect={setSelectedKey} />
        ) : null}
      </section>
      <div className="pc-operate-today__side">
        {view.seats.length ? <SeatsCard seats={view.seats} phone={phone} /> : null}
        {view.evidence.length ? <EvidenceCard evidence={view.evidence} phone={phone} /> : null}
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
