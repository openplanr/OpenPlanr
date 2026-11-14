import { type ComponentProps, type ReactNode, useEffect, useId, useRef } from 'react';
import {
  ArtifactRowTitle,
  ArtifactStatus,
  CardHeader,
  CommandHint,
  PcIcon,
  WorkItemChip,
} from '../../design-system/components/index.js';
import {
  type PlanningAttentionFilter,
  serializePlanningViewHref,
} from '../../lib/routing/planning-view-codec.js';
import type {
  HomeAttention,
  HomeChangedGroup,
  HomeMeta,
  HomeSprint,
} from './planning-home-view.js';
import { inspectPlanningNode, useLiveListOrder } from './planning-inspector.js';
import {
  type PlanningModelNode,
  planningAttentionIds,
  planningAttentionView,
  planningDetailHref,
  planningDisplayId,
} from './planning-model.js';

export const PREVIEW_LIMIT = 5;

export type HomeTone = 'danger' | 'warning' | 'info';
export type HomeRowMeta = HomeMeta & Readonly<{ dependencies?: readonly PlanningModelNode[] }>;

export function NodeLink({
  node,
  children,
  keyboard = false,
  selected = false,
  className,
  describedBy,
  ...linkProps
}: {
  node: PlanningModelNode;
  children: ReactNode;
  keyboard?: boolean;
  selected?: boolean;
  className?: string;
  describedBy?: string;
} & Omit<ComponentProps<'a'>, 'children'>) {
  return (
    <a
      {...linkProps}
      className={className}
      aria-describedby={describedBy}
      data-keyboard-item={keyboard ? node.id : undefined}
      data-selected={selected || undefined}
      href={planningDetailHref(node) ?? undefined}
      onClick={(event) => {
        linkProps.onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        inspectPlanningNode(node);
      }}
      onFocus={(event) => {
        linkProps.onFocus?.(event);
        inspectPlanningNode(node, false);
      }}
    >
      {children}
    </a>
  );
}

function longDate(date: string, phone: boolean) {
  const at = new Date(`${date}T00:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    at.toLocaleDateString('en-GB', { timeZone: 'UTC', ...options });
  const length = phone ? 'short' : 'long';
  return `${part({ weekday: length })}, ${part({ day: 'numeric' })} ${part({ month: length })}`;
}

export function HomeHeader({
  attention,
  summary,
  phone,
}: {
  attention: HomeAttention;
  summary: string;
  phone: boolean;
}) {
  const totals = attention.statusTotals;
  const legend = [
    ['outstanding', 'Outstanding', totals.outstanding],
    ['in-progress', 'In progress', totals.inProgress],
    ['blocked', 'Blocked', totals.blocked],
    ['addressed', 'Addressed', totals.addressed],
    ['done', 'Done', totals.done],
  ] as const;
  return (
    <header className="pc-home__header">
      <p className="pc-home__eyebrow">
        <time dateTime={attention.changedToday.date}>
          {longDate(attention.changedToday.date, phone)}
        </time>
      </p>
      <h1>Needs attention</h1>
      <div className="pc-home__summary-line">
        <p className="pc-home__summary">{summary}</p>
        <ul className="pc-home__legend" aria-label="Project status">
          {legend.map(([status, label, count]) => (
            <li key={status}>
              <ArtifactStatus variant="legend" status={status} label={label} count={count} />
            </li>
          ))}
          {totals.unknown ? (
            <li>
              <ArtifactStatus
                variant="legend"
                status="unknown"
                label="Unknown"
                count={totals.unknown}
              />
            </li>
          ) : null}
        </ul>
      </div>
    </header>
  );
}

export function HomeRow({
  node,
  meta,
  tone,
  selected,
}: {
  node: PlanningModelNode;
  meta: HomeRowMeta;
  tone?: HomeTone;
  selected: boolean;
}) {
  const sentenceId = useId();
  const dependencies = meta.dependencies ?? [];
  return (
    <li className="pc-home__row pc-artifact-row" data-selected={selected || undefined}>
      <NodeLink
        node={node}
        keyboard
        selected={selected}
        className="pc-artifact-row__link"
        describedBy={sentenceId}
      >
        <span className="pc-artifact-row__id">
          <WorkItemChip type={node.type} id={planningDisplayId(node)} />
        </span>
        <ArtifactRowTitle>{node.title}</ArtifactRowTitle>
        <span id={sentenceId} className="pc-visually-hidden">
          {meta.sentence}
        </span>
      </NodeLink>
      <span className="pc-home__meta" data-tone={tone} title={meta.sentence}>
        {meta.text}
        {dependencies.length ? (
          <span className="pc-home__waits">
            {meta.text ? ' · ' : ''}waits{' '}
            <NodeLink node={dependencies[0]} className="pc-home__dependency">
              {planningDisplayId(dependencies[0])}
            </NodeLink>
            {dependencies.length > 1 ? ` +${dependencies.length - 1}` : null}
          </span>
        ) : null}
      </span>
    </li>
  );
}

export function AttentionCard({
  title,
  description,
  filter,
  tone,
  attention,
  byId,
  selectedId,
  meta,
  empty,
}: {
  title: string;
  description: string;
  filter: Exclude<PlanningAttentionFilter, 'changed-today'>;
  tone: HomeTone;
  attention: HomeAttention;
  byId: ReadonlyMap<string, PlanningModelNode>;
  selectedId?: string;
  meta: (node: PlanningModelNode) => HomeRowMeta;
  empty: string;
}) {
  const headingId = useId();
  const ids = planningAttentionIds(attention, filter);
  const previous = useRef<readonly string[]>([]);
  const nodes = ids.flatMap((id) => {
    const node = byId.get(id);
    return node ? [node] : [];
  });
  // Keep the inspected row mounted when a live patch resolves its attention reason.
  if (selectedId && previous.current.includes(selectedId) && !ids.includes(selectedId)) {
    const selected = byId.get(selectedId);
    if (selected)
      nodes.splice(Math.min(previous.current.indexOf(selectedId), nodes.length), 0, selected);
  }
  const ordered = useLiveListOrder(nodes, filter);
  const preview = ordered.slice(0, PREVIEW_LIMIT);
  useEffect(() => {
    previous.current = preview.map((node) => node.id);
  }, [preview]);
  return (
    <section className="pc-home__card" aria-labelledby={headingId} data-attention={filter}>
      <CardHeader
        id={headingId}
        title={title}
        glyph={<span className="pc-home__ring" data-tone={tone} />}
        count={ids.length}
        description={description}
        href={ids.length ? serializePlanningViewHref(planningAttentionView(filter)) : undefined}
      />
      {preview.length ? (
        <ul className="pc-home__rows">
          {preview.map((node) => (
            <HomeRow
              key={node.id}
              node={node}
              tone={
                filter === 'stale'
                  ? 'warning'
                  : filter === 'high-not-started'
                    ? 'danger'
                    : undefined
              }
              selected={selectedId === node.id}
              meta={
                ids.includes(node.id)
                  ? meta(node)
                  : { text: '', sentence: 'No longer matches this attention list.' }
              }
            />
          ))}
        </ul>
      ) : (
        <p className="pc-home__empty">{empty}</p>
      )}
    </section>
  );
}

export function ChangedTodayCard({
  groups,
  selectedId,
}: {
  groups: readonly HomeChangedGroup[];
  selectedId?: string;
}) {
  const headingId = useId();
  const href = serializePlanningViewHref(planningAttentionView('changed-today'));
  return (
    <section className="pc-home__card" aria-labelledby={headingId} data-attention="changed-today">
      <CardHeader
        id={headingId}
        title="Changed today"
        count={groups.length}
        actions={
          <a href="#/activity" className="pc-card__see-all">
            Activity
          </a>
        }
      />
      {groups.length ? (
        <ul className="pc-home__changes">
          {groups.slice(0, PREVIEW_LIMIT).map((group) => (
            <li key={group.key} className="pc-home__change">
              <span className="pc-home__change-tags">
                {group.tags.map((node) => (
                  <WorkItemChip key={node.id} type={node.type} id={planningDisplayId(node)} />
                ))}
                {group.more ? <span className="pc-home__change-note">+{group.more}</span> : null}
                {group.summary ? (
                  <span className="pc-home__change-note">{group.summary}</span>
                ) : null}
              </span>
              {group.spec ? (
                <NodeLink
                  node={group.spec}
                  keyboard
                  selected={selectedId === group.spec.id}
                  className="pc-home__change-title"
                >
                  {group.title}
                </NodeLink>
              ) : (
                <a href={href} className="pc-home__change-title">
                  {group.title}
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pc-home__empty">Nothing changed today.</p>
      )}
    </section>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <span className="pc-home__progress" aria-hidden="true">
      <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
    </span>
  );
}

export function SpecsCard({
  specs,
  byId,
  href,
  selectedId,
}: {
  specs: HomeAttention['perSpec'];
  byId: ReadonlyMap<string, PlanningModelNode>;
  href: string;
  selectedId?: string;
}) {
  return (
    <section className="pc-home__card" aria-label="Specs in flight">
      <CardHeader
        title="Specs in flight"
        count={specs.length}
        href={specs.length ? href : undefined}
      />
      {specs.length ? (
        <ul className="pc-home__specs">
          {specs.slice(0, PREVIEW_LIMIT).map((spec) => {
            const node = byId.get(spec.id);
            if (!node) return null;
            return (
              <li key={spec.id} className="pc-home__spec">
                <NodeLink
                  node={node}
                  keyboard
                  selected={selectedId === node.id}
                  className="pc-home__spec-link"
                >
                  <span className="pc-home__spec-id">{planningDisplayId(node)}</span>
                  <ArtifactRowTitle>{node.title}</ArtifactRowTitle>
                  <span
                    className="pc-home__spec-count"
                    title={`${spec.done} of ${spec.total} tasks done`}
                  >
                    {spec.total ? `${spec.done}/${spec.total}` : 'No tasks'}
                  </span>
                </NodeLink>
                <Progress done={spec.done} total={spec.total} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="pc-home__empty">No specs in flight.</p>
      )}
    </section>
  );
}

export function SprintCard({
  sprint,
  selectedId,
}: {
  sprint: HomeSprint | null;
  selectedId?: string;
}) {
  if (!sprint)
    return (
      <section className="pc-home__card pc-home__sprint" aria-label="No active sprint">
        <h2 className="pc-home__sprint-title">
          <PcIcon name="calendar-days" size={15} />
          No active sprint
        </h2>
        <p>Pick the next sprint from the backlog.</p>
        <CommandHint command="/planr:sprint" size="sm" />
      </section>
    );
  return (
    <section className="pc-home__card pc-home__sprint" aria-label="Active sprint">
      <div className="pc-home__sprint-head">
        <NodeLink
          node={sprint.node}
          keyboard
          selected={selectedId === sprint.node.id}
          className="pc-home__sprint-link"
        >
          <span className="pc-home__sprint-id">{planningDisplayId(sprint.node)}</span>
          <span className="pc-home__sprint-name">{sprint.node.title}</span>
        </NodeLink>
        {sprint.ends ? <span className="pc-home__sprint-ends">ends {sprint.ends}</span> : null}
      </div>
      <p className="pc-home__sprint-done">
        <strong>{sprint.done}</strong> <span>/ {sprint.total}</span> done
      </p>
      <Progress done={sprint.done} total={sprint.total} />
      <a href="#/sprints" className="pc-home__sprint-open">
        Open sprint
      </a>
    </section>
  );
}
