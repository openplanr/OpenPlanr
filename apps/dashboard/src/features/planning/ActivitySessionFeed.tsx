import { useMemo, useState } from 'react';
import {
  ArtifactStatus,
  Badge,
  Card,
  EmptyState,
  Tooltip,
  WorkItemChip,
} from '../../design-system/components/index.js';
import { useInspectorStore } from '../shell/inspector-selection.js';
import { inspectPlanningNode, useLiveListSelection } from './planning-inspector.js';
import { type PlanningModelNode, planningDetailHref, planningDisplayId } from './planning-model.js';
import type {
  PlanningSessionActivity,
  PlanningSessionActivityEntry,
} from './planning-session-activity.js';

const DISCONNECTED_LABEL = 'Disconnected · session retained';

export function ActivitySessionFeed({
  activity,
  entries,
  nodes,
}: {
  activity: PlanningSessionActivity;
  entries: readonly PlanningSessionActivityEntry[];
  nodes: readonly PlanningModelNode[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const inspector = useInspectorStore();
  const visibleNodes = useMemo(() => {
    const ids = new Set(
      entries.filter((entry) => entry.kind !== 'removed').map((entry) => entry.node?.id),
    );
    return nodes.filter((node) => ids.has(node.id));
  }, [entries, nodes]);
  const { rootRef, removalNotice } = useLiveListSelection(
    nodes,
    visibleNodes,
    inspector.selection?.kind === 'node' ? inspector.selection.id : undefined,
  );
  const currentNodes = new Map(nodes.map((node) => [node.id, node]));
  const paused = activity.connection === 'paused';
  return (
    <div ref={rootRef}>
      {removalNotice ? (
        <p className="pc-visually-hidden" role="status">
          {removalNotice}
        </p>
      ) : null}
      <Card padding={0}>
        <div className="pc-activity__feed-head">
          <div>
            <h2>Live</h2>
            <span>This session only</span>
          </div>
          <span className="pc-activity__connection" data-reserve-label={DISCONNECTED_LABEL}>
            <Badge tone={paused ? 'warn' : 'info'} variant="outline">
              {paused
                ? DISCONNECTED_LABEL
                : activity.connection === 'connected'
                  ? 'Watching'
                  : 'Connecting'}
            </Badge>
          </span>
        </div>
        <p className="pc-activity__explanation">
          Accepted watcher patches, in arrival order. Reloading clears this feed; snapshots never
          add entries.
          {paused
            ? ' Previously accepted patches remain visible while the watcher reconnects.'
            : ''}
        </p>
        <section
          className="pc-activity__feed"
          data-scroll-context="activity-session"
          aria-label="Live patches from this session"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Enables keyboard scrolling when all entries are removed.
          tabIndex={0}
        >
          {entries.length === 0 ? (
            <EmptyState
              icon="activity"
              title={activity.entries.length ? 'No matching live patches' : 'No activity returned'}
              description={
                activity.entries.length
                  ? 'The current filters do not match any accepted patch in this session.'
                  : 'No accepted live patch has arrived in this session. This empty state does not claim that nothing changed before you opened the dashboard.'
              }
            />
          ) : (
            <ol className="pc-activity__entries">
              {entries.map((entry) => {
                const node = entry.node;
                const available =
                  entry.kind !== 'removed' && node ? currentNodes.get(node.id) : null;
                return (
                  <li
                    key={entry.id}
                    className="pc-activity__entry"
                    data-selected={selected === entry.id || undefined}
                  >
                    <span className="pc-activity__operation">
                      {entry.kind === 'relationships' ? 'Relationships changed' : entry.kind}
                    </span>
                    <SessionActivityItem
                      entry={entry}
                      available={available ?? null}
                      selected={selected === entry.id}
                      onSelect={() => setSelected(entry.id)}
                    />
                    <span className="pc-activity__status">
                      {available ? <ArtifactStatus status={available.status} size="sm" /> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
        <p className="pc-activity__footnote">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · Current status is shown
          for available items; patches do not imply a status transition.
          {activity.truncated ? ' Only the latest 200 entries are retained.' : ''}
        </p>
      </Card>
    </div>
  );
}

function SessionActivityItem({
  entry,
  available,
  selected,
  onSelect,
}: {
  entry: PlanningSessionActivityEntry;
  available: PlanningModelNode | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const node = entry.node;
  if (!node) return <span className="pc-activity__relationship">Graph relationships updated</span>;
  const chip = (
    <WorkItemChip
      type={node.type}
      id={planningDisplayId(node)}
      title={node.title}
      interactive={Boolean(available)}
    />
  );
  if (!available)
    return (
      <span className="pc-activity__item" data-activity-unavailable>
        {chip}
        <small>
          {entry.kind === 'removed' ? 'Removed from the graph' : 'No longer in the current graph'}
        </small>
      </span>
    );
  return (
    <Tooltip content={node.title}>
      <a
        href={planningDetailHref(available) ?? undefined}
        className="pc-activity__item"
        data-keyboard-item={entry.id}
        data-canonical-id={available.id}
        data-selected={selected || undefined}
        onFocus={onSelect}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onSelect();
          inspectPlanningNode(available);
        }}
      >
        {chip}
      </a>
    </Tooltip>
  );
}
