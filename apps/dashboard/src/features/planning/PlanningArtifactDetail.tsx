import { memo, type ReactNode, useRef } from 'react';
import { EmptyState } from '../../design-system/components/index.js';
import { DetailColumns, LoadingColumns, ReadError } from './DetailSections.js';
import { DetailSelectionScope, useDetailCompact } from './DetailSelection.js';
import { DetailSummary } from './DetailSummary.js';
import { DetailTrace } from './DetailTrace.js';
import { PlanningOperatingOriginSection } from './PlanningOperatingOriginSection.js';
import { planningDetailHref, planningDisplayId, planningSpecOf } from './planning-model.js';
import { selectStructuralDetail } from './planning-structural-model.js';
import type { PlanningWorkspaceModel } from './planning-workspace.js';
import { usePlanningDetail } from './use-planning-detail.js';
import './detail.css';

const CLOSED = ['done', 'addressed'];

type VerifiedColumns = { key: string; content: ReactNode };

function renderVerifiedColumns(
  presentation: { current: VerifiedColumns | null },
  key: string,
  ready: boolean,
  render: () => ReactNode,
) {
  // Retained file actions must keep the snapshot that verified their body.
  if (presentation.current?.key !== key) presentation.current = null;
  if (ready) presentation.current = { key, content: render() };
  return presentation.current?.content ?? null;
}

function ArtifactDetail({
  model,
  nodeId,
  origin,
  panel = false,
}: {
  model: PlanningWorkspaceModel;
  nodeId: string;
  origin: string;
  panel?: boolean;
}) {
  const verifiedColumns = useRef<VerifiedColumns | null>(null);
  const compact = useDetailCompact(panel);
  const columnsKey = JSON.stringify([origin, model.envelope.binding, nodeId]);
  const summary = model.graph.nodes.find((entry) => entry.id === nodeId) ?? null;
  const read = usePlanningDetail(model, summary, origin);
  const scope = summary ? planningSpecOf(summary) : null;
  const parentSummary =
    scope && scope !== nodeId && Array.isArray(summary?.frontmatter.acceptanceRefs)
      ? (model.graph.nodes.find((entry) => entry.id === scope) ?? null)
      : null;
  const parentRead = usePlanningDetail(model, parentSummary, origin);
  const node = read.node ?? summary;
  const detail = node ? selectStructuralDetail(model.graph, node, parentRead.node) : null;
  if (!node || !detail) {
    verifiedColumns.current = null;
    return (
      <EmptyState
        icon="circle-alert"
        title="Artifact unavailable"
        description="This item was removed or is not in the current planning snapshot. Close the inspector or return to the list."
      />
    );
  }
  const blockers = detail.dependencies.flatMap((ref) =>
    ref.node && !CLOSED.includes(ref.node.status) ? [ref.node] : [],
  );
  const status = !CLOSED.includes(node.status) && blockers.length ? 'blocked' : node.status;
  const href = planningDetailHref(node);
  const link =
    href && typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}${href}`
      : href;
  const sourceNode = read.node;
  const detailLoading = read.loading || parentRead.loading;
  const ready = Boolean(
    sourceNode &&
      !read.loading &&
      !read.error &&
      (!parentSummary || (parentRead.node && !parentRead.loading && !parentRead.error)),
  );
  const columns = renderVerifiedColumns(verifiedColumns, columnsKey, ready, () => (
    <DetailColumns
      model={model}
      node={node}
      detail={detail}
      sourceNode={sourceNode}
      origin={origin}
    />
  ));
  return (
    <article
      className={`pc-detail__artifact${panel ? ' pc-detail__artifact--panel' : ''}`}
      data-artifact-id={node.id}
      data-detail-state={
        read.error || parentRead.error ? 'error' : detailLoading ? 'loading' : 'ready'
      }
      aria-busy={detailLoading || undefined}
      data-compact={compact || undefined}
    >
      <DetailSelectionScope nodes={model.graph.nodes} node={node} detail={detail} panel={panel}>
        <DetailSummary node={node} status={status} blockers={blockers} link={link} panel={panel} />
        <p className="pc-visually-hidden" role="status">
          {read.loading
            ? columns
              ? 'Updating verified detail…'
              : 'Loading verified detail…'
            : parentSummary && !parentRead.node && !parentRead.error
              ? 'Loading referenced criteria…'
              : ''}
        </p>
        <DetailTrace key={node.id} model={detail} />
        {read.error ? (
          <ReadError
            title={`${planningDisplayId(node)} could not be read`}
            message={read.error}
            onRetry={read.retry}
          />
        ) : null}
        {parentRead.error && parentSummary ? (
          <ReadError
            title={`Criteria from ${planningDisplayId(parentSummary)} could not be read`}
            message={parentRead.error}
            onRetry={parentRead.retry}
          />
        ) : null}
        {columns ?? (read.error || parentRead.error ? null : <LoadingColumns />)}
        {node.type === 'spec' ? (
          <PlanningOperatingOriginSection
            specId={node.id}
            binding={model.binding}
            node={read.node}
          />
        ) : null}
      </DetailSelectionScope>
    </article>
  );
}

export const PlanningArtifactDetail = memo(
  ArtifactDetail,
  (before, after) =>
    before.nodeId === after.nodeId &&
    before.origin === after.origin &&
    before.panel === after.panel &&
    before.model.graph === after.model.graph &&
    before.model.envelope === after.model.envelope &&
    before.model.binding === after.model.binding,
);
