import { useEffect, useId, useRef, useState } from 'react';
import { ArtifactTag, artifactTagType } from '../../design-system/components/artifact-recipes.js';
import { ArtifactStatus, PriorityChip, Tabs } from '../../design-system/components/index.js';
import { NodeLink } from './HomeParts.js';
import { useLiveListOrder } from './planning-inspector.js';
import { planningDetailHref, planningDisplayId } from './planning-model.js';
import {
  type ActiveSprintView,
  SPRINT_BUCKET_LABEL,
  SPRINT_BUCKETS,
  type SprintItem,
} from './planning-sprints-view.js';

type SprintTab = 'open' | 'blocked' | 'done' | 'all';
const TABS: readonly (readonly [SprintTab, string])[] = [
  ['open', 'Open'],
  ['blocked', 'Blocked'],
  ['done', 'Done'],
  ['all', 'All'],
];

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

export function SprintItemRow({ item, selected }: { item: SprintItem; selected: boolean }) {
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

export function ActiveSprintCard({
  view,
  selectedId,
}: {
  view: ActiveSprintView;
  selectedId: string | undefined;
}) {
  const [tab, setTab] = useState<SprintTab>('open');
  const panelId = useId();
  const { record } = view;
  const id = planningDisplayId(record.node);
  const shown = useRef<readonly string[]>([]);
  // Keep the inspected row in place when a live patch moves it out of the current tab.
  const items = view.items.filter(
    (item) =>
      inTab(item, tab) || (item.node.id === selectedId && shown.current.includes(item.node.id)),
  );
  // Live patches keep rows where they were; a fresh tab or sprint uses the row order.
  const ordered = useLiveListOrder(
    items.map((item) => ({ id: item.node.id, item })),
    `${record.node.id}:${tab}`,
  ).map((entry) => entry.item);
  useEffect(() => {
    shown.current = ordered.map((item) => item.node.id);
  });
  const meta = [view.dates, view.day ? `day ${view.day.day} of ${view.day.days}` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <section className="pc-sprints__active" aria-label={`${id}: ${record.title}`}>
      <header className="pc-sprints__active-head">
        <span className="pc-sprints__tag">{id}</span>
        <h2>
          <a href={planningDetailHref(record.node) ?? undefined}>{record.title}</a>
        </h2>
        <span className="pc-sprints__pill">Active</span>
        {meta ? <span className="pc-sprints__dates">{meta}</span> : null}
      </header>
      <div className="pc-sprints__overview">
        <SprintStats view={view} />
        <SprintStatusBar view={view} />
      </div>
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
        <ul className="pc-sprints__items">
          {ordered.map((item) => (
            <SprintItemRow key={item.node.id} item={item} selected={selectedId === item.node.id} />
          ))}
        </ul>
      </div>
    </section>
  );
}
