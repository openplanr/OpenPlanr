import { useId, useState } from 'react';
import {
  CopyLabels,
  PcIcon,
  SelectionBar,
  useCopyFeedback,
} from '../../design-system/components/index.js';
import { usePlanningCopy, usePlanningShortcuts } from '../../lib/routing/planning-presentation.js';
import { clearInspector } from '../shell/inspector-selection.js';
import { boardSelectionItems } from './planning-board-view.js';
import { inspectPlanningNode } from './planning-inspector.js';
import { useListLayout } from './planning-list-window.js';
import { type PlanningModelNode, planningDetailHref, planningDisplayId } from './planning-model.js';
import type { SprintRecord } from './planning-sprints.js';
import {
  type NoActiveSummary,
  type SprintTimeline as SprintTimelineModel,
  sprintDates,
  sprintDoneCount,
} from './planning-sprints-view.js';

const SPRINT_COMMAND = '/planr:sprint';

/** Copies the sprint planning command and shows the result in the button; primary is the no-active action. */
export function SprintCommand({ label, primary = false }: { label: string; primary?: boolean }) {
  const feedback = useCopyFeedback(SPRINT_COMMAND, false, usePlanningCopy());
  const current = feedback.message || (feedback.state === 'pending' ? 'Copying' : label);
  return (
    <>
      <button
        type="button"
        className="pc-sprints__command"
        data-variant={primary ? 'primary' : undefined}
        data-state={feedback.state}
        disabled={feedback.state === 'pending'}
        aria-busy={feedback.state === 'pending' || undefined}
        title={feedback.error || undefined}
        onClick={() => void feedback.copy()}
      >
        <CopyLabels idle={label} current={current} /> <code>{SPRINT_COMMAND}</code>
      </button>
      <span className="pc-visually-hidden" aria-live="polite" aria-atomic="true">
        {feedback.message}
        {feedback.error ? `: ${feedback.error}` : ''}
      </span>
    </>
  );
}

/** The shared selection bar with the selected sprint item's Board-rule command. */
export function SprintsSelectionBar({ selected }: { selected: PlanningModelNode | undefined }) {
  const copy = usePlanningCopy();
  const shortcutsEnabled = usePlanningShortcuts();
  return (
    <SelectionBar
      items={boardSelectionItems(selected)}
      onCopy={copy}
      shortcutsEnabled={shortcutsEnabled}
      onClear={clearInspector}
      onOpen={() => {
        if (selected) inspectPlanningNode(selected);
      }}
    />
  );
}

export function SprintsHeader({ count, action }: { count: number; action: boolean }) {
  return (
    <header className="pc-sprints__header">
      <h1>
        Sprints <span className="pc-sprints__count">{count}</span>
      </h1>
      {action ? <SprintCommand label="Plan the next sprint" /> : null}
    </header>
  );
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function NoActiveSprint({ summary }: { summary: NoActiveSummary }) {
  const { last, ready } = summary;
  const closed = last
    ? `${last.id} closed${last.closed ? ` on ${last.closed}` : ''}${
        last.carried ? ` with ${plural(last.carried, 'item')} carried over` : ''
      }.`
    : summary.sprints
      ? ''
      : 'No sprints yet.';
  const sentence = [
    closed,
    ready ? `${plural(ready, 'open item')} ${ready === 1 ? 'is' : 'are'} ready to refine.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <section className="pc-sprints__none" aria-label="No active sprint">
      <div>
        <h2>No sprint is running</h2>
        {sentence ? <p>{sentence}</p> : null}
      </div>
      <SprintCommand label="Copy" primary />
    </section>
  );
}

export function PastSprintCard({ record }: { record: SprintRecord }) {
  const done = sprintDoneCount(record);
  const total = record.members.length;
  const dates = sprintDates(record);
  const id = planningDisplayId(record.node);
  return (
    <article className="pc-sprints__card" aria-label={`${id}: ${record.title}`}>
      <div className="pc-sprints__card-head">
        <span className="pc-sprints__id">{id}</span>
        <span>Closed</span>
        {dates ? <span className="pc-sprints__dates">{dates}</span> : null}
      </div>
      <h3 className="pc-sprints__card-title">
        <a href={planningDetailHref(record.node) ?? undefined}>{record.title}</a>
      </h3>
      <span className="pc-sprints__progress" aria-hidden="true">
        <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </span>
      <p className="pc-sprints__card-foot">
        <span>
          {done} of {total} done
        </span>
        {record.carryOver.length ? (
          <span className="pc-sprints__carried">{record.carryOver.length} carried over</span>
        ) : null}
      </p>
    </article>
  );
}

/** Past sprint cards; on a phone they sit behind a "Past sprints N" disclosure. */
export function PastSprints({ records }: { records: readonly SprintRecord[] }) {
  const phone = useListLayout() === 'phone';
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!records.length) return null;
  const cards = records.map((record) => <PastSprintCard key={record.node.id} record={record} />);
  if (!phone) return <>{cards}</>;
  return (
    <>
      <button
        type="button"
        className="pc-sprints__past"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="pc-sprints__past-label">Past sprints</span>{' '}
        <span className="pc-sprints__past-count">{records.length}</span>
        <PcIcon name="chevron-down" size={14} />
      </button>
      <div id={listId} className="pc-sprints__past-list" hidden={!open}>
        {open ? cards : null}
      </div>
    </>
  );
}

export function SprintTimeline({
  timeline,
  activeIds,
}: {
  timeline: SprintTimelineModel;
  activeIds: ReadonlySet<string>;
}) {
  const cuts = timeline.rows.some((row) => row.cut !== null);
  return (
    <section className="pc-sprints__timeline" aria-labelledby="pc-sprints-timeline">
      <header className="pc-sprints__timeline-head">
        <h2 id="pc-sprints-timeline">Timeline</h2>
        {timeline.today !== null || cuts ? (
          <ul className="pc-sprints__legend" aria-label="Timeline legend">
            {timeline.today !== null ? (
              <li>
                <span className="pc-sprints__today-glyph" aria-hidden="true" />
                Today
              </li>
            ) : null}
            {cuts ? (
              <li>
                <span className="pc-sprints__cut-glyph" aria-hidden="true" />
                Release cut
              </li>
            ) : null}
          </ul>
        ) : null}
      </header>
      <div className="pc-sprints__timeline-body">
        {timeline.ticks.length ? (
          <div className="pc-sprints__axis" aria-hidden="true">
            <span />
            <span className="pc-sprints__ticks">
              {timeline.ticks.map((tick) => (
                <span key={tick.time} style={{ left: `${tick.at}%` }}>
                  {tick.label}
                </span>
              ))}
            </span>
            <span />
          </div>
        ) : null}
        {timeline.rows.map(({ record, bar, cut }) => {
          const id = planningDisplayId(record.node);
          const done = sprintDoneCount(record);
          const dates = sprintDates(record);
          return (
            <div className="pc-sprints__timeline-row" key={record.node.id}>
              <a
                className="pc-sprints__timeline-label"
                href={planningDetailHref(record.node) ?? undefined}
              >
                <span className="pc-sprints__id">{id}</span>
                <span className="pc-sprints__timeline-title" title={record.title}>
                  {record.title}
                </span>
              </a>
              <span className="pc-sprints__track" aria-hidden="true">
                {timeline.today !== null ? (
                  <span className="pc-sprints__today" style={{ left: `${timeline.today}%` }} />
                ) : null}
                {bar ? (
                  <span
                    className="pc-sprints__bar"
                    data-active={activeIds.has(record.node.id) || undefined}
                    style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                  >
                    <span style={{ width: `${bar.fill * 100}%` }} />
                  </span>
                ) : null}
                {cut !== null ? (
                  <span className="pc-sprints__cut" style={{ left: `${cut}%` }} />
                ) : null}
              </span>
              <span className="pc-sprints__timeline-count">
                {done}/{record.members.length}
              </span>
              <span className="pc-visually-hidden">
                {[
                  dates,
                  `${done} of ${record.members.length} done`,
                  record.releaseCut ? `release cut ${record.releaseCut}` : null,
                  ...record.diagnostics,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
