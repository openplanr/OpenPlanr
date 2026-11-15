import { type MouseEvent, type ReactNode, useMemo } from 'react';
import {
  ArtifactStatus,
  ArtifactTag,
  type ArtifactType,
} from '../../design-system/components/index.js';
import { homeDate } from '../planning/planning-home-view.js';
import {
  type PlanningModelNode,
  planningContinuation,
  planningDetailHref,
  planningDisplayId,
} from '../planning/planning-model.js';
import {
  type StructuralDetailModel,
  selectStructuralDetail,
} from '../planning/planning-structural-model.js';
import type { DashboardSearchHit, DashboardSearchSources } from './search-index.js';

const PREVIEW_TAG: Readonly<Record<string, ArtifactType>> = {
  spec: 'spec',
  story: 'us',
  task: 't',
  backlog: 'bl',
  adr: 'adr',
  epic: 'epic',
  feature: 'epic',
  sprint: 'sprint',
  quick: 'qt',
};

function PreviewLink({
  node,
  onPreview,
}: Readonly<{ node: PlanningModelNode; onPreview: (id: string) => void }>) {
  const href = planningDetailHref(node);
  const label = planningDisplayId(node);
  if (!href) return <span>{label}</span>;
  return (
    <a
      className="pc-palette__fact-link"
      href={href}
      title={node.title}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        onPreview(node.id);
      }}
    >
      {label}
    </a>
  );
}

function ancestor(detail: StructuralDetailModel, type: string): PlanningModelNode | null {
  const current = detail.trace.findIndex((entry) => entry.role === 'Current artifact');
  const before = current < 0 ? [] : detail.trace.slice(0, current);
  return [...before].reverse().find((entry) => entry.node.type === type)?.node ?? null;
}

function PlanningFacts({
  node,
  detail,
  onPreview,
}: Readonly<{
  node: PlanningModelNode;
  detail: StructuralDetailModel;
  onPreview: (id: string) => void;
}>) {
  const spec = node.type === 'spec' ? null : ancestor(detail, 'spec');
  const story = node.type === 'story' ? null : ancestor(detail, 'story');
  const dependencies = detail.dependencies.flatMap((ref) => (ref.node ? [ref.node] : []));
  const updated = homeDate(node.frontmatter.updated ?? node.frontmatter.created);
  const facts: [string, ReactNode][] = [];
  if (spec) facts.push(['Spec', <PreviewLink key="spec" node={spec} onPreview={onPreview} />]);
  if (story) facts.push(['Story', <PreviewLink key="story" node={story} onPreview={onPreview} />]);
  if (dependencies.length)
    facts.push([
      'Depends on',
      dependencies.map((dependency) => (
        <PreviewLink key={dependency.id} node={dependency} onPreview={onPreview} />
      )),
    ]);
  if (updated) facts.push(['Updated', <span key="updated">{updated}</span>]);
  if (!facts.length) return null;
  return (
    <dl className="pc-palette__facts">
      {facts.map(([term, value]) => (
        <div key={term} className="pc-palette__fact">
          <dt>{term}</dt>
          <dd data-date={term === 'Updated' || undefined}>{value}</dd>
        </div>
      ))}
    </dl>
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
        <ArtifactTag type={PREVIEW_TAG[node.type] ?? 'qt'}>{planningDisplayId(node)}</ArtifactTag>
        <ArtifactStatus status={blocked ? 'blocked' : node.status} size="sm" variant="legend" />
      </div>
      <h3>{node.title}</h3>
      <PlanningFacts node={node} detail={detail} onPreview={onPreview} />
    </>
  );
}

function DestinationPreview({ hit }: { hit: DashboardSearchHit | null }) {
  if (!hit || hit.source === 'planning') return null;
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

function PreviewCommand({
  command,
  busy,
  singleLetters,
  onCopy,
}: Readonly<{
  command: string;
  busy: boolean;
  singleLetters: boolean;
  onCopy: (command: string) => void;
}>) {
  return (
    <button
      type="button"
      className="pc-palette__command-copy"
      aria-disabled={busy || undefined}
      aria-keyshortcuts={singleLetters ? 'C' : undefined}
      onClick={() => {
        if (!busy) onCopy(command);
      }}
      onKeyDown={(event) => {
        if (
          !singleLetters ||
          event.key.toLowerCase() !== 'c' ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey ||
          event.nativeEvent.isComposing
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        if (!busy) onCopy(command);
      }}
    >
      <span className="pc-visually-hidden">Copy command </span>
      <code>{command}</code>
    </button>
  );
}

export function SearchPreview({
  hit,
  sources,
  onPreview,
  onCopyCommand,
  commandBusy,
  singleLetters,
}: Readonly<{
  hit: DashboardSearchHit | null;
  sources: DashboardSearchSources;
  onPreview: (id: string) => void;
  onCopyCommand: (command: string) => void;
  commandBusy: boolean;
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
      {stale ? <p>Last validated planning snapshot. Reconnect to check for changes.</p> : null}
      {node && detail ? (
        <PlanningPreview node={node} detail={detail} onPreview={onPreview} />
      ) : (
        <DestinationPreview hit={hit} />
      )}
      {command ? (
        <PreviewCommand
          command={command}
          busy={commandBusy}
          singleLetters={singleLetters}
          onCopy={onCopyCommand}
        />
      ) : null}
    </aside>
  );
}
