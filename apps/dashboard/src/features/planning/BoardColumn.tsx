import { useLayoutEffect, useMemo, useRef } from 'react';
import { ArtifactTag, artifactTagType } from '../../design-system/components/artifact-recipes.js';
import { ArtifactStatus, PriorityChip } from '../../design-system/components/index.js';
import { boardCardMeta } from './planning-board-projection.js';
import {
  BOARD_COLUMN_CAP,
  type BoardLayout,
  type BoardTarget,
  boardCellKey,
  useBoardCellWindow,
} from './planning-board-window.js';
import { inspectPlanningNode } from './planning-inspector.js';
import {
  type PlanningGroup,
  type PlanningModelGraph,
  type PlanningModelNode,
  planningArtifactStatusLabel,
  planningDisplayId,
} from './planning-model.js';

function BoardCard({
  node,
  graph,
  selected,
  plainId,
}: {
  node: PlanningModelNode;
  graph: PlanningModelGraph;
  selected: boolean;
  plainId: boolean;
}) {
  const meta = boardCardMeta(graph, node);
  const priority = node.frontmatter.priority;
  const tag = artifactTagType(node.type);
  return (
    <div
      className="pc-status-board__card"
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
          {tag && plainId ? (
            <span className="pc-status-board__plain-id" style={{ color: `var(--pc-type-${tag})` }}>
              {planningDisplayId(node)}
            </span>
          ) : tag ? (
            <ArtifactTag type={tag} variant="id" surface="card">
              {planningDisplayId(node)}
            </ArtifactTag>
          ) : (
            <span className="pc-artifact-tag pc-artifact-row__id">{planningDisplayId(node)}</span>
          )}
          {typeof priority === 'string' ? (
            <PriorityChip priority={priority} variant="text" />
          ) : null}
        </span>
        <span className="pc-status-board__title">{node.title}</span>
        {meta ? <span className="pc-status-board__meta">{meta}</span> : null}
      </button>
    </div>
  );
}

export function BoardColumnHead({ group, total }: { group: PlanningGroup; total: number }) {
  return (
    <header className="pc-status-board__head" data-status={group.key}>
      <span className="pc-status-board__head-row">
        <ArtifactStatus status={group.key} variant="legend" size="sm" label="" />
        <span className="pc-status-board__name">{planningArtifactStatusLabel(group.key)}</span>
        {group.key === 'done' ? null : (
          <span className="pc-status-board__count">{group.nodes.length}</span>
        )}
      </span>
      <span className="pc-status-board__share" aria-hidden="true">
        <span
          style={{
            width: `${group.key === 'done' ? 100 : total ? (group.nodes.length / total) * 100 : 0}%`,
          }}
          data-status={group.key}
        />
      </span>
    </header>
  );
}

export function BoardColumn({
  group,
  graph,
  laneKey,
  laneLabel,
  selectedId,
  collapsed,
  expanded,
  head,
  layout,
  toggleDone,
  expand,
  target,
}: {
  group: PlanningGroup;
  graph: PlanningModelGraph;
  laneKey: string;
  /** Set in lanes mode so each status region is named for its lane. */
  laneLabel: string | null;
  selectedId?: string;
  collapsed: boolean;
  expanded: boolean;
  head: number | null;
  layout: BoardLayout;
  toggleDone: () => void;
  expand: (cell: string) => void;
  target: BoardTarget | null;
}) {
  const cell = boardCellKey(laneKey, group.key);
  const capped = !collapsed && !expanded && group.nodes.length > BOARD_COLUMN_CAP;
  const nodes = useMemo(
    () => (capped ? group.nodes.slice(0, BOARD_COLUMN_CAP) : group.nodes),
    [capped, group.nodes],
  );
  const section = useRef<HTMLElement>(null);
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const selector = refocus.current;
    if (!selector) return;
    refocus.current = null;
    if (document.activeElement && document.activeElement !== document.body) return;
    section.current?.querySelector<HTMLElement>(selector)?.focus();
  });
  const toggle = () => {
    refocus.current = '[data-keyboard-item]';
    toggleDone();
  };
  const showMore = () => {
    refocus.current = `[data-ordinal="${BOARD_COLUMN_CAP}"] [data-keyboard-item]`;
    expand(cell);
  };
  const window = useBoardCellWindow(
    nodes,
    selectedId,
    target?.cell === cell ? target : null,
    layout,
  );
  return (
    <section
      ref={section}
      data-keyboard-column={group.key}
      data-board-cell={cell}
      data-collapsed={collapsed || undefined}
      className="pc-status-board__column"
      aria-label={laneLabel ? `${laneLabel}, ${group.label}` : group.label}
    >
      {head === null ? null : <BoardColumnHead group={group} total={head} />}
      {collapsed ? (
        <div className="pc-status-board__done-summary">
          <strong>{group.nodes.length}</strong>
          <span>done and hidden</span>
          <button
            type="button"
            className="pc-status-board__done-toggle"
            data-keyboard-item={`empty:${cell}`}
            onClick={toggle}
          >
            Show done
          </button>
        </div>
      ) : group.nodes.length === 0 ? (
        <button
          type="button"
          className="pc-status-board__empty"
          data-keyboard-item={`empty:${cell}`}
        >
          Nothing is {planningArtifactStatusLabel(group.key).toLowerCase()}.
        </button>
      ) : (
        <div
          ref={window.root}
          data-scroll-context={`board-cell:${cell}`}
          data-expanded={expanded || undefined}
          className="pc-status-board__cards"
        >
          <ul
            className="pc-status-board__window"
            data-virtual={expanded || undefined}
            style={expanded ? { height: nodes.length * window.pitch - window.gap } : undefined}
          >
            {window.mounted.map(({ node, index }) => (
              <li
                key={node.id}
                aria-posinset={index + 1}
                aria-setsize={group.nodes.length}
                className="pc-status-board__slot"
                style={expanded ? { top: index * window.pitch } : undefined}
                data-ordinal={index}
              >
                <BoardCard
                  node={node}
                  graph={graph}
                  selected={selectedId === node.id}
                  plainId={layout === 'lanes'}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {capped ? (
        <button type="button" className="pc-status-board__more" onClick={showMore}>
          Show {group.nodes.length - BOARD_COLUMN_CAP} more
        </button>
      ) : null}
      {group.key === 'done' && !collapsed && group.nodes.length > 0 ? (
        <button type="button" className="pc-status-board__done-toggle" onClick={toggle}>
          Hide done cards
        </button>
      ) : null}
    </section>
  );
}
