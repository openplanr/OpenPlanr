import { useMemo } from 'react';
import {
  ArtifactStatus,
  CommandHint,
  PriorityChip,
  WorkItemChip,
} from '../../design-system/components/index.js';
import { StructuralTrace } from '../planning/DeliveryTrace.js';
import { type PlanningModelNode, planningContinuation } from '../planning/planning-model.js';
import {
  type StructuralDetailModel,
  selectStructuralDetail,
} from '../planning/planning-structural-model.js';
import type { DashboardSearchHit, DashboardSearchSources } from './search-index.js';
import '../planning/detail.css';

function PreviewDependencies({ detail }: { detail: StructuralDetailModel }) {
  return (
    <section aria-label="Preview dependencies">
      <h3>Depends on</h3>
      {detail.dependencies.length ? (
        <ul>
          {detail.dependencies.map((ref) => (
            <li key={ref.reference}>
              {ref.node ? (
                <>
                  {ref.node.id} · {ref.node.title}{' '}
                  <ArtifactStatus status={ref.node.status} size="sm" />
                </>
              ) : (
                `${ref.reference}: Unresolved. ${ref.reason}`
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>None declared.</p>
      )}
    </section>
  );
}

function PlanningPreview({
  node,
  detail,
  onPreview,
}: Readonly<{
  node: PlanningModelNode;
  detail: StructuralDetailModel;
  onPreview: (id: string) => void;
}>) {
  const blocked =
    !['done', 'addressed'].includes(node.status) &&
    detail.dependencies.some((ref) => ref.node && !['done', 'addressed'].includes(ref.node.status));
  return (
    <>
      <div className="pc-palette__identity">
        <WorkItemChip type={node.type} id={node.id} />
        <ArtifactStatus status={blocked ? 'blocked' : node.status} size="sm" />
        <PriorityChip
          priority={
            typeof node.frontmatter.priority === 'string' ? node.frontmatter.priority : 'none'
          }
        />
      </div>
      <h3>{node.title}</h3>
      <StructuralTrace model={detail} onNavigate={(related) => onPreview(related.id)} />
      <PreviewDependencies detail={detail} />
      {node.status === 'in-progress' ? (
        <p>Quiet: unknown. Commit-aware evidence is unavailable in this preview.</p>
      ) : null}
    </>
  );
}

function DestinationPreview({ hit }: { hit: DashboardSearchHit | null }) {
  if (!hit || hit.source === 'planning')
    return (
      <p>
        Preview unavailable. Search for an item, view or command, then use the arrow keys to choose
        a result.
      </p>
    );
  const reason = {
    command: 'Enter copies this command. Nothing is executed.',
    operate: 'Accessible Operate result. Open the full page to inspect its evidence and authority.',
    route: 'View destination. Enter opens this view.',
  }[hit.source];
  return (
    <>
      <h3>{hit.title}</h3>
      <p>{reason}</p>
    </>
  );
}

export function SearchPreview({
  hit,
  sources,
  onPreview,
  onCopy,
  singleLetters,
}: Readonly<{
  hit: DashboardSearchHit | null;
  sources: DashboardSearchSources;
  onPreview: (id: string) => void;
  onCopy?: (command: string) => Promise<void>;
  singleLetters: boolean;
}>) {
  const graph = useMemo(
    () => sources.planningGraph ?? { nodes: sources.planningNodes ?? [], edges: [] },
    [sources.planningGraph, sources.planningNodes],
  );
  const node =
    hit?.source === 'planning'
      ? (graph.nodes.find((entry) => `planning:${entry.id}` === hit.id) ?? null)
      : null;
  const detail = useMemo(() => (node ? selectStructuralDetail(graph, node) : null), [graph, node]);
  const command =
    hit?.source === 'command' ? hit.command : node ? planningContinuation(node) : null;
  const ready = hit && (hit.source !== 'planning' || node);
  const stale =
    sources.planningPresentation &&
    !['ready', 'refreshing', 'read-only'].includes(sources.planningPresentation);
  return (
    <aside
      className="pc-palette__preview"
      aria-label="Search result preview"
      data-preview-id={node?.id ?? hit?.id}
      data-preview-state={ready ? 'ready' : 'unavailable'}
    >
      <h2>Preview</h2>
      {stale ? <p>Last validated planning snapshot. Reconnect to check for changes.</p> : null}
      {node && detail ? (
        <PlanningPreview node={node} detail={detail} onPreview={onPreview} />
      ) : (
        <DestinationPreview hit={hit} />
      )}
      {command ? (
        <CommandHint
          key={command}
          command={command}
          label="Next command"
          onCopy={onCopy}
          shortcutsEnabled={singleLetters}
        />
      ) : null}
      {node && !command ? <p>A copyable command is unavailable for this identity.</p> : null}
    </aside>
  );
}
