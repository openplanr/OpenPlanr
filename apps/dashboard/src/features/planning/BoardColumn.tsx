import {
  ArtifactRowCopy,
  ArtifactRowMeta,
  artifactRowStyle,
} from '../../design-system/components/artifact-row.js';
import {
  ArtifactRowTitle,
  ArtifactStatus,
  PriorityChip,
  WorkItemChip,
} from '../../design-system/components/index.js';
import { usePlanningCopy, usePlanningShortcuts } from '../../lib/routing/planning-presentation.js';
import {
  BOARD_CARD_PITCH,
  type BoardTarget,
  boardCellKey,
  useBoardCellWindow,
} from './planning-board-window.js';
import { inspectPlanningNode } from './planning-inspector.js';
import {
  type PlanningGroup,
  type PlanningModelNode,
  planningContinuation,
  planningDisplayId,
} from './planning-model.js';
import { authoredTimestamp } from './presentation-view.js';

function BoardCard({ node, selected }: { node: PlanningModelNode; selected: boolean }) {
  const copy = usePlanningCopy();
  const shortcutsEnabled = usePlanningShortcuts();
  const timestamp = authoredTimestamp(node.frontmatter.updated);
  const updated = timestamp === null ? 'Unknown' : new Date(timestamp).toISOString().slice(0, 10);
  return (
    <div
      className="pc-status-board__card pc-artifact-row"
      data-status={node.status}
      data-selected={selected || undefined}
    >
      <button
        type="button"
        className="pc-status-board__open"
        data-keyboard-item={node.id}
        data-selected={selected || undefined}
        aria-pressed={selected}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          inspectPlanningNode(node);
        }}
        onFocus={() => inspectPlanningNode(node, false)}
      >
        <span className="pc-status-board__identity">
          <WorkItemChip type={node.type} id={planningDisplayId(node)} surface="card" />
        </span>
        <ArtifactRowTitle>{node.title}</ArtifactRowTitle>
      </button>
      <ArtifactRowCopy
        onCopy={copy}
        shortcutsEnabled={shortcutsEnabled}
        id={planningDisplayId(node)}
        command={planningContinuation(node)}
      />
      <span className="pc-status-board__foot">
        <ArtifactStatus status={node.status} size="sm" surface="card" />
        <PriorityChip priority={String(node.frontmatter.priority ?? 'none')} />
        <ArtifactRowMeta label={`Updated ${updated}`}>
          {timestamp === null
            ? 'Unknown'
            : new Date(timestamp).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                timeZone: 'UTC',
              })}
        </ArtifactRowMeta>
      </span>
    </div>
  );
}

export function BoardColumn({
  group,
  laneKey,
  selectedId,
  collapsed,
  expandDone,
  target,
}: {
  group: PlanningGroup;
  laneKey: string;
  selectedId?: string;
  collapsed: boolean;
  expandDone: () => void;
  target: BoardTarget | null;
}) {
  const cell = boardCellKey(laneKey, group.key);
  const window = useBoardCellWindow(group.nodes, selectedId, target?.cell === cell ? target : null);
  return (
    <section
      data-keyboard-column={group.key}
      data-board-cell={cell}
      data-collapsed={collapsed || undefined}
      className="pc-status-board__column"
      style={artifactRowStyle(group.nodes.map(planningDisplayId))}
      aria-label={group.key}
    >
      <header className="pc-status-board__head">
        <ArtifactStatus status={group.key} size="sm" />
        <span className="pc-status-board__count">{group.nodes.length}</span>
      </header>
      <div
        ref={window.root}
        data-scroll-context={`board-cell:${cell}`}
        className="pc-status-board__cards"
        style={{ height: collapsed ? 72 : window.height }}
      >
        {collapsed || group.nodes.length === 0 ? (
          <ul className="pc-status-board__empty-list">
            <li>
              <button
                type="button"
                className="pc-status-board__empty"
                data-keyboard-item={`empty:${cell}`}
                aria-label={collapsed ? undefined : `${group.key}: no cards`}
                onClick={collapsed ? expandDone : undefined}
              >
                {collapsed ? `${group.nodes.length} done · Expand` : 'No cards'}
              </button>
            </li>
          </ul>
        ) : (
          <ul
            className="pc-status-board__window"
            style={{ height: group.nodes.length * BOARD_CARD_PITCH }}
          >
            {window.mounted.map(({ node, index }) => (
              <li
                key={node.id}
                aria-posinset={index + 1}
                aria-setsize={group.nodes.length}
                className="pc-status-board__slot"
                style={{ top: index * BOARD_CARD_PITCH }}
                data-ordinal={index}
              >
                <BoardCard node={node} selected={selectedId === node.id} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
