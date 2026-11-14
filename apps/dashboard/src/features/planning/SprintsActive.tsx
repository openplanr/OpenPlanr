import { useEffect, useId, useRef, useState } from 'react';
import { ArtifactTag, artifactTagType } from '../../design-system/components/artifact-recipes.js';
import { ArtifactStatus, PriorityChip, Tabs } from '../../design-system/components/index.js';
import { NodeLink } from './HomeParts.js';
import { useLiveListOrder } from './planning-inspector.js';
import { useListLayout } from './planning-list-window.js';
import { planningDetailHref, planningDisplayId } from './planning-model.js';
import {
  type ActiveSprintView,
  phoneSprintOrder,
  SPRINT_BUCKET_LABEL,
  SPRINT_BUCKETS,
  type SprintItem,
} from './planning-sprints-view.js';
import { type TapSelectHandlers, useTapSelect } from './planning-tap-select.js';

type SprintTab = 'open' | 'blocked' | 'done' | 'all';
const TABS: readonly (readonly [SprintTab, string])[] = [
  ['open', 'Open'],
  ['blocked', 'Blocked'],
  ['done', 'Done'],
  ['all', 'All'],
];
const PHONE_ROWS = 4;

function inTab(item: SprintItem, tab: SprintTab) {
  if (tab === 'all') return true;
  if (tab === 'open') return item.bucket !== 'done';
  return item.bucket === tab;
}

function LastCell({ item }: { item: SprintItem }) {
  const { last } = item;
  if (!last) return <span className="pc-sprints__last" />;
  if (last.kind === 'blocker')
    return (
      <span className="pc-sprints__last" data-kind="blocker">
        by {last.id}
      </span>
    );
  if (last.kind === 'carried')
    return (
      <span className="pc-sprints__last" data-kind="carried" title={`Carried from ${last.from}`}>
        carried<span className="pc-visually-hidden"> from {last.from}</span>
      </span>
    );
  const ago = last.days
    ? `Updated ${last.days} ${last.days === 1 ? 'day' : 'days'} ago`
    : 'Updated today';
  return (
    <span className="pc-sprints__last" data-kind="age" title={ago}>
      <span aria-hidden="true">{last.days}d</span>
      <span className="pc-visually-hidden">{ago}</span>
    </span>
  );
}

export function SprintItemRow({
  item,
  selected,
  tap,
}: {
  item: SprintItem;
  selected: boolean;
  tap?: TapSelectHandlers;
}) {
  const { node } = item;
  const priority = node.frontmatter.priority;
  return (
    <li className="pc-sprints__item" data-selected={selected || undefined}>
      <NodeLink
        node={node}
        keyboard
        selected={selected}
        aria-current={selected ? 'true' : undefined}
        className="pc-sprints__item-link"
        {...tap}
      >
        <span className="pc-sprints__item-id">
          <ArtifactTag type={artifactTagType(node.type) ?? 't'}>
            {planningDisplayId(node)}
          </ArtifactTag>
        </span>
        <span className="pc-sprints__item-title" title={node.title}>
          {node.title}
        </span>
        <span className="pc-sprints__item-status">
          <ArtifactStatus status={node.status} variant="legend" />
        </span>
        <span className="pc-sprints__item-priority">
          <PriorityChip
            priority={typeof priority === 'string' ? priority : undefined}
            variant="text"
          />
        </span>
        <LastCell item={item} />
      </NodeLink>
    </li>
  );
}

function SprintStats({ view }: { view: ActiveSprintView }) {
  const { goal, capacityDays, record } = view;
  const done = view.counts.done;
  const wide = goal ? (capacityDays ? 1 : 2) : capacityDays ? 2 : 4;
  return (
    <div className="pc-sprints__stats">
      {goal ? (
        <div className="pc-sprints__stat" data-goal data-span={2}>
          <span className="pc-sprints__label">Goal</span>
          <p className="pc-sprints__goal">{goal}</p>
        </div>
      ) : null}
      <div className="pc-sprints__stat" data-span={wide}>
        <span className="pc-sprints__label">Done</span>
        <span className="pc-sprints__value">
          <strong>{done}</strong> of {record.members.length} items
        </span>
      </div>
      {capacityDays ? (
        <div className="pc-sprints__stat" data-span={goal ? 1 : 2}>
          <span className="pc-sprints__label">Capacity</span>
          <span className="pc-sprints__value">
            <strong>{capacityDays}</strong> days
          </span>
        </div>
      ) : null}
    </div>
  );
}

function SprintStatusBar({ view }: { view: ActiveSprintView }) {
  const shown = SPRINT_BUCKETS.filter((bucket) => view.counts[bucket] > 0);
  const summary = shown
    .map((bucket) => `${SPRINT_BUCKET_LABEL[bucket]} ${view.counts[bucket]}`)
    .join(', ');
  return (
    <div className="pc-sprints__status">
      <div className="pc-sprints__status-bar" role="img" aria-label={summary || 'No sprint items'}>
        {shown.map((bucket) => (
          <span key={bucket} data-bucket={bucket} style={{ flexGrow: view.counts[bucket] }} />
        ))}
      </div>
      <div className="pc-sprints__status-legend" aria-hidden="true">
        {shown.map((bucket) => (
          <span key={bucket}>
            <span className="pc-sprints__swatch" data-bucket={bucket} />
            {SPRINT_BUCKET_LABEL[bucket]} {view.counts[bucket]}
          </span>
        ))}
        {view.releaseCut ? (
          <span className="pc-sprints__release">Release cut {view.releaseCut}</span>
        ) : null}
      </div>
    </div>
  );
}

function SprintCardHead({ view, id }: { view: ActiveSprintView; id: string }) {
  const { record } = view;
  return (
    <header className="pc-sprints__active-head">
      <span className="pc-sprints__tag">{id}</span>
      <h2>
        <a href={planningDetailHref(record.node) ?? undefined}>{record.title}</a>
      </h2>
      <span className="pc-sprints__pill">Active</span>
      {view.dates || view.day ? (
        <span className="pc-sprints__dates">
          {view.dates ? (
            <span className="pc-sprints__when">
              {view.dates}
              {view.day ? ' · ' : ''}
            </span>
          ) : null}
          {view.day ? (
            <span className="pc-sprints__day">
              day {view.day.day} of {view.day.days}
            </span>
          ) : null}
        </span>
      ) : null}
    </header>
  );
}

export function ActiveSprintCard({
  view,
  selectedId,
}: {
  view: ActiveSprintView;
  selectedId: string | undefined;
}) {
  const [tab, setTab] = useState<SprintTab>('open');
  const [expanded, setExpanded] = useState(false);
  const phone = useListLayout() === 'phone';
  const tapSelect = useTapSelect();
  const panelId = useId();
  const { record } = view;
  const id = planningDisplayId(record.node);
  const shown = useRef<readonly string[]>([]);
  const rows = phone ? phoneSprintOrder(view.items) : view.items;
  const capped = new Set(
    rows
      .filter((item) => item.bucket !== 'done')
      .slice(0, PHONE_ROWS)
      .map((item) => item.node.id),
  );
  const listed = (item: SprintItem) =>
    phone ? expanded || capped.has(item.node.id) : inTab(item, tab);
  // Keep the inspected row in place when a live patch moves it out of the current list.
  const items = rows.filter(
    (item) => listed(item) || (item.node.id === selectedId && shown.current.includes(item.node.id)),
  );
  // Live patches keep rows where they were; a fresh tab or sprint uses the row order.
  const ordered = useLiveListOrder(
    items.map((item) => ({ id: item.node.id, item })),
    `${record.node.id}:${phone ? 'phone' : tab}`,
  ).map((entry) => entry.item);
  useEffect(() => {
    shown.current = ordered.map((item) => item.node.id);
  });
  const list = (
    <ul className="pc-sprints__items" aria-label={phone ? `${id} items` : undefined}>
      {ordered.map((item) => (
        <SprintItemRow
          key={item.node.id}
          item={item}
          selected={selectedId === item.node.id}
          tap={tapSelect(item.node)}
        />
      ))}
    </ul>
  );
  return (
    <section className="pc-sprints__active" aria-label={`${id}: ${record.title}`}>
      <SprintCardHead view={view} id={id} />
      <div className="pc-sprints__overview">
        <SprintStats view={view} />
        <SprintStatusBar view={view} />
      </div>
      {phone ? (
        <div id={panelId}>{list}</div>
      ) : (
        <>
          <div className="pc-sprints__tabs">
            <Tabs
              label={`${id} items`}
              variant="pill"
              value={tab}
              tabs={TABS.map(([key, label]) => ({
                id: key,
                label,
                panelId,
                count: view.items.filter((item) => inTab(item, key)).length,
              }))}
              onChange={(next) => {
                const match = TABS.find(([key]) => key === next);
                if (match) setTab(match[0]);
              }}
            />
          </div>
          <div id={panelId} role="tabpanel" aria-label={`${id} items`}>
            {list}
          </div>
        </>
      )}
      {phone && rows.length > capped.size ? (
        <button
          type="button"
          className="pc-sprints__all"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? 'Fewer items' : `All ${rows.length} items`}
        </button>
      ) : null}
    </section>
  );
}
