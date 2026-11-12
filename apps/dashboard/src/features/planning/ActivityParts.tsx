import type { CSSProperties, ReactNode } from 'react';
import { artifactTagType } from '../../design-system/components/artifact-recipes.js';
import {
  ArtifactStatus,
  ArtifactTag,
  Card,
  CardHeader,
  PcIcon,
  type PcIconName,
  SelectionBar,
} from '../../design-system/components/index.js';
import { usePlanningCopy, usePlanningShortcuts } from '../../lib/routing/planning-presentation.js';
import { clearInspector } from '../shell/inspector-selection.js';
import { NodeLink } from './HomeParts.js';
import type {
  ActivityBar,
  ActivityDay,
  ActivityKind,
  ActivityRow,
  BusiestSpec,
} from './planning-activity-view.js';
import { boardSelectionItems } from './planning-board-view.js';
import { inspectPlanningNode } from './planning-inspector.js';
import { type PlanningModelNode, planningDisplayId } from './planning-model.js';
import type { PlanningSessionActivity } from './planning-session-activity.js';

const KIND_ICON: Readonly<Record<ActivityKind, PcIconName>> = {
  created: 'plus',
  status: 'arrow-right',
  edited: 'pencil',
  removed: 'minus',
};

export const KIND_LABEL: Readonly<Record<ActivityKind, string>> = {
  created: 'Created',
  status: 'Status changed',
  edited: 'Edited',
  removed: 'Removed',
};

const CONNECTION_LABEL = {
  connected: 'Watching',
  connecting: 'Connecting',
  paused: 'Reconnecting',
};
const RECONNECTING_RESERVE = 'Reconnecting';
const SINCE_OPENED_LIMIT = 5;
// Bars scale instead of resizing so a live change never moves the header.
const BAR_MAX = 27;

function IdTag({ node, struck = false }: { node: ActivityRow['node']; struck?: boolean }) {
  const id = planningDisplayId(node);
  if (struck) return <s className="pc-activity__struck">{id}</s>;
  return <ArtifactTag type={artifactTagType(node.type) ?? 't'}>{id}</ArtifactTag>;
}

function Change({ row, short = false }: { row: ActivityRow; short?: boolean }) {
  return (
    <span className="pc-activity__change">
      {row.status ? (
        <ArtifactStatus status={row.status} size="sm" showLabel={false} variant="legend" />
      ) : null}
      <span>{short ? row.short : row.change}</span>
    </span>
  );
}

export function ActivityChart({ bars }: { bars: readonly ActivityBar[] }) {
  const max = Math.max(1, ...bars.map((bar) => bar.count));
  return (
    <div className="pc-activity__chart" aria-hidden="true">
      {bars.map((bar) => (
        <span
          key={bar.day}
          className="pc-activity__bar"
          data-today={bar.today || undefined}
          style={{
            transform: `scaleY(${Math.max(2, Math.round((bar.count / max) * BAR_MAX)) / BAR_MAX})`,
          }}
        />
      ))}
    </div>
  );
}

export function ActivityHeader({
  total,
  days,
  chart,
}: {
  total: number;
  days: number;
  chart: ReactNode;
}) {
  return (
    <header className="pc-activity__header">
      <h1>
        Activity{' '}
        <span className="pc-activity__count">
          {`${total} ${total === 1 ? 'change' : 'changes'} in ${days} days`}
        </span>
      </h1>
      {chart}
    </header>
  );
}

function ActivityRowItem({
  row,
  selected,
  onSelect,
}: {
  row: ActivityRow;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const icon = (
    <span className="pc-activity__kind" data-kind={row.kind}>
      <PcIcon name={KIND_ICON[row.kind]} size={13} />
      <span className="pc-visually-hidden">{KIND_LABEL[row.kind]}</span>
    </span>
  );
  const time = <span className="pc-activity__time">{row.time}</span>;
  const target = row.kind === 'removed' ? null : row.current;
  if (!target)
    return (
      <li className="pc-activity__row" data-kind={row.kind} data-gone>
        <span className="pc-activity__cells">
          {icon}
          <span className="pc-activity__id">
            <IdTag node={row.node} struck />
          </span>
          <span className="pc-activity__title" title={row.node.title}>
            {row.node.title}
          </span>
          <Change row={row} />
          {time}
        </span>
      </li>
    );
  return (
    <li className="pc-activity__row" data-kind={row.kind} data-selected={selected || undefined}>
      <NodeLink
        node={target}
        keyboard
        selected={selected}
        aria-current={selected ? 'true' : undefined}
        className="pc-activity__cells"
        onFocus={() => onSelect(row.key)}
        onClick={() => onSelect(row.key)}
      >
        {icon}
        <span className="pc-activity__id">
          <IdTag node={target} />
        </span>
        <span className="pc-activity__title" title={target.title}>
          {target.title}
        </span>
        <Change row={row} />
        {time}
      </NodeLink>
    </li>
  );
}

export function ActivityFeed({
  days,
  selectedKey,
  onSelect,
}: {
  days: readonly ActivityDay[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <section className="pc-activity__feed" aria-label="Changes">
      {days.map((group) => (
        <div key={group.day} className="pc-activity__day">
          <h2 className="pc-activity__day-head">
            <span>{group.label}</span>
            <span className="pc-activity__day-count">{group.rows.length}</span>
          </h2>
          <ul className="pc-activity__rows">
            {group.rows.map((row) => (
              <ActivityRowItem
                key={row.key}
                row={row}
                selected={row.key === selectedKey}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** The live session card: this browser's changes since the page opened, and the watcher state. */
export function ActivitySinceOpened({
  connection,
  rows,
}: {
  connection: PlanningSessionActivity['connection'];
  rows: readonly ActivityRow[];
}) {
  const state = connection ?? 'connecting';
  return (
    <section className="pc-activity__card pc-activity__live" aria-label="Live session activity">
      <Card padding={0}>
        <CardHeader
          title="Since you opened"
          count={rows.length || undefined}
          actions={
            <span className="pc-activity__connection" data-reserve-label={RECONNECTING_RESERVE}>
              <span className="pc-badge pc-activity__pill" data-state={state}>
                <span className="pc-activity__pill-mark" aria-hidden="true" />
                <span>
                  {CONNECTION_LABEL[state]}
                  {state === 'paused' ? (
                    <span className="pc-activity__kept"> · changes so far are kept</span>
                  ) : null}
                </span>
              </span>
            </span>
          }
        />
        <p className="pc-visually-hidden">Changes since you opened this page. This session only.</p>
        <section
          className="pc-activity__live-list"
          aria-label="Live patches from this session"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users scroll the live list.
          tabIndex={0}
        >
          <ul>
            {rows.length === 0 ? (
              <li className="pc-activity__live-empty">
                Changes saved to the plan appear here as they happen.
              </li>
            ) : (
              rows.slice(0, SINCE_OPENED_LIMIT).map((row) => {
                const gone = row.kind === 'removed' || !row.current;
                const node = row.current ?? row.node;
                return (
                  <li key={row.key} className="pc-activity__live-row" data-gone={gone || undefined}>
                    <span className="pc-activity__live-meta">
                      <span
                        className="pc-activity__live-id"
                        style={
                          {
                            '--pc-activity-id': `var(--pc-type-${artifactTagType(node.type) ?? 't'})`,
                          } as CSSProperties
                        }
                      >
                        {gone ? <s>{planningDisplayId(node)}</s> : planningDisplayId(node)}
                      </span>
                      <Change row={row} short />
                      <span className="pc-activity__time">{row.time}</span>
                    </span>
                    {gone ? (
                      <span className="pc-activity__live-title">{node.title}</span>
                    ) : (
                      <NodeLink node={node} className="pc-activity__live-title">
                        {node.title}
                      </NodeLink>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </section>
      </Card>
    </section>
  );
}

export function BusiestSpecs({
  specs,
  onSpec,
}: {
  specs: readonly BusiestSpec[];
  onSpec: (spec: string) => void;
}) {
  const max = Math.max(1, ...specs.map((spec) => spec.count));
  return (
    <section className="pc-activity__card pc-activity__busiest" aria-label="Busiest specs">
      <Card padding={0}>
        <CardHeader title="Busiest specs" />
        <ul className="pc-activity__busiest-list">
          {specs.map((spec) => (
            <li key={spec.spec}>
              <button
                type="button"
                className="pc-activity__busiest-row"
                onClick={() => onSpec(spec.spec)}
              >
                <span className="pc-activity__busiest-id">{spec.spec}</span>
                <span className="pc-activity__busiest-title">{spec.title}</span>
                <span className="pc-activity__busiest-bar" aria-hidden="true">
                  <span style={{ width: `${(spec.count / max) * 100}%` }} />
                </span>
                <span className="pc-activity__busiest-count">{spec.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

export function ActivityState({
  heading,
  line,
  action,
  onAction,
}: {
  heading: string;
  line?: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <section className="pc-activity__state" aria-label={heading}>
      <h2>{heading}</h2>
      {line ? <p>{line}</p> : null}
      <button type="button" className="pc-activity__button" onClick={onAction}>
        {action}
      </button>
    </section>
  );
}

/** The shared selection bar with the selected row's Board-rule command. */
export function ActivitySelectionBar({ selected }: { selected: PlanningModelNode | undefined }) {
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
