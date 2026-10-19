import { useMemo, useState } from 'react';
import {
  ArtifactRowCopy,
  ArtifactRowMeta,
  artifactRowStyle,
} from '../../design-system/components/artifact-row.js';
import {
  ArtifactRowTitle,
  ArtifactStatus,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  WorkItemChip,
} from '../../design-system/components/index.js';
import { usePlanningCopy, usePlanningShortcuts } from '../../lib/routing/planning-presentation.js';
import { useInspectorStore } from '../shell/inspector-selection.js';
import { inspectPlanningNode, useLiveListSelection } from './planning-inspector.js';
import {
  type PlanningModelNode,
  planningContinuation,
  planningDetailHref,
  planningDisplayId,
} from './planning-model.js';
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
  const copy = usePlanningCopy();
  const shortcutsEnabled = usePlanningShortcuts();
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
    <section ref={rootRef} aria-label="Live session activity">
      {removalNotice ? (
        <p className="pc-visually-hidden" role="status">
          {removalNotice}
        </p>
      ) : null}
      <Card padding={0}>
        <CardHeader
          title="Live"
          count={entries.length}
          description={`Accepted watcher patches, in arrival order. This session only. Reloading clears this feed; snapshots never add entries.${paused ? ' Previously accepted patches remain visible while the watcher reconnects.' : ''}`}
          actions={
            <span className="pc-activity__connection" data-reserve-label={DISCONNECTED_LABEL}>
              <Badge tone={paused ? 'warn' : 'info'} variant="outline">
                {paused
                  ? DISCONNECTED_LABEL
                  : activity.connection === 'connected'
                    ? 'Watching'
                    : 'Connecting'}
              </Badge>
            </span>
          }
        />
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
            <ol
              className="pc-activity__entries"
              style={artifactRowStyle(
                entries.flatMap((entry) => (entry.node ? [planningDisplayId(entry.node)] : [])),
              )}
            >
              {entries.map((entry) => {
                const node = entry.node;
                const available =
                  entry.kind !== 'removed' && node ? currentNodes.get(node.id) : null;
                return (
                  <li
                    key={entry.id}
                    className="pc-activity__entry pc-artifact-row"
                    data-selected={selected === entry.id || undefined}
                  >
                    <SessionActivityItem
                      entry={entry}
                      available={available ?? null}
                      selected={selected === entry.id}
                      onSelect={() => setSelected(entry.id)}
                    />
                    <span className="pc-artifact-row__meta-group">
                      <ArtifactRowMeta
                        label={
                          entry.kind === 'relationships' ? 'Relationships changed' : entry.kind
                        }
                      >
                        {entry.kind}
                      </ArtifactRowMeta>
                      {available ? <ArtifactStatus status={available.status} size="sm" /> : null}
                    </span>
                    {available ? (
                      <ArtifactRowCopy
                        onCopy={copy}
                        shortcutsEnabled={shortcutsEnabled}
                        id={planningDisplayId(available)}
                        command={planningContinuation(available)}
                      />
                    ) : (
                      <span />
                    )}
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
    </section>
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
  if (!node)
    return (
      <>
        <span />
        <ArtifactRowTitle>Graph relationships updated</ArtifactRowTitle>
      </>
    );
  const chip = (
    <WorkItemChip type={node.type} id={planningDisplayId(node)} interactive={Boolean(available)} />
  );
  if (!available)
    return (
      <span className="pc-artifact-row__link" data-activity-unavailable>
        <span className="pc-artifact-row__id">{chip}</span>
        <ArtifactRowTitle>{node.title}</ArtifactRowTitle>
        <small className="pc-visually-hidden">
          {entry.kind === 'removed' ? 'Removed from the graph' : 'No longer in the current graph'}
        </small>
      </span>
    );
  return (
    <a
      href={planningDetailHref(available) ?? undefined}
      className="pc-artifact-row__link"
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
      <span className="pc-artifact-row__id">{chip}</span>
      <ArtifactRowTitle>{node.title}</ArtifactRowTitle>
    </a>
  );
}
