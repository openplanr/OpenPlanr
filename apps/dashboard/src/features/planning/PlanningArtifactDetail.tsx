import { memo, type ReactNode, useRef } from 'react';
import {
  ArtifactRowCopy,
  ArtifactRowTitle,
  ArtifactStatus,
  artifactRowStyle,
  Button,
  Card,
  CommandHint,
  EmptyState,
  PriorityChip,
  WorkItemChip,
} from '../../design-system/components/index.js';
import { usePlanningCopy, usePlanningShortcuts } from '../../lib/routing/planning-presentation.js';
import { StructuralTrace } from './DeliveryTrace.js';
import { CopyDetailValue, DeclaredFile } from './PlanningDetailActions.js';
import { DeferredDetailContent, DetailDisclosure, PlanningMarkdown } from './PlanningMarkdown.js';
import { PlanningOperatingOriginSection } from './PlanningOperatingOriginSection.js';
import {
  type PlanningModelNode,
  planningContinuation,
  planningDetailHref,
  planningDisplayId,
  planningSpecOf,
} from './planning-model.js';
import { type StructuralReference, selectStructuralDetail } from './planning-structural-model.js';
import type { PlanningWorkspaceModel } from './planning-workspace.js';
import { usePlanningDetail } from './use-planning-detail.js';
import './detail.css';

function NodeLink({
  node,
  row = false,
  compact = false,
}: {
  node: PlanningModelNode;
  row?: boolean;
  compact?: boolean;
}) {
  const href = planningDetailHref(node);
  return href ? (
    <a
      className={row ? 'pc-artifact-row__link' : 'pc-detail__node-link'}
      href={href}
      title={compact ? node.title : undefined}
    >
      {row ? (
        <>
          <span className="pc-artifact-row__id">
            <WorkItemChip type={node.type} id={planningDisplayId(node)} />
          </span>
          <ArtifactRowTitle>{node.title}</ArtifactRowTitle>
        </>
      ) : (
        <WorkItemChip
          type={node.type}
          id={planningDisplayId(node)}
          title={compact ? undefined : node.title}
          interactive
        />
      )}
    </a>
  ) : (
    <span>{node.id}: destination unavailable</span>
  );
}

function Relations({ title, rows }: { title: string; rows: readonly StructuralReference[] }) {
  const copy = usePlanningCopy();
  const shortcutsEnabled = usePlanningShortcuts();
  return (
    <section className="pc-detail__relations" aria-label={title}>
      <h3>{title}</h3>
      {rows.length ? (
        <ul
          style={artifactRowStyle(
            rows.map((ref) => (ref.node ? planningDisplayId(ref.node) : ref.reference)),
          )}
        >
          {rows.map((ref) => (
            <li
              key={ref.node?.id ?? ref.reference}
              className={ref.node ? 'pc-artifact-row' : undefined}
            >
              {ref.node ? (
                <>
                  <NodeLink node={ref.node} row />
                  <span className="pc-artifact-row__meta-group">
                    <ArtifactStatus status={ref.node.status} size="sm" showLabel={false} />
                  </span>
                  <ArtifactRowCopy
                    id={planningDisplayId(ref.node)}
                    command={planningContinuation(ref.node)}
                    onCopy={copy}
                    shortcutsEnabled={shortcutsEnabled}
                  />
                </>
              ) : (
                <span>
                  <code>{ref.reference}</code> · Unresolved: {ref.reason}
                </span>
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

function authoredDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/u.test(value)) return 'Unknown';
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time > Date.now()) return 'Unknown';
  if (value.length === 10 && new Date(time).toISOString().slice(0, 10) !== value) return 'Unknown';
  return new Date(time).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function SourceStatus({ node }: { node: PlanningModelNode }) {
  const status = typeof node.frontmatter.status === 'string' ? node.frontmatter.status : 'Unknown';
  const label = status.replaceAll('-', ' ');
  return (
    <ArtifactStatus
      status={status}
      label={label.charAt(0).toUpperCase() + label.slice(1)}
      size="sm"
    />
  );
}

function PropertyReferences({
  rows,
  label,
}: {
  rows: readonly StructuralReference[];
  label?: string;
}) {
  return (
    <section className="pc-detail__property-references" aria-label={label}>
      {rows.length ? (
        rows.map((ref) =>
          ref.node ? (
            <span className="pc-detail__property-reference" key={ref.node.id}>
              <NodeLink node={ref.node} compact />
              {label ? <ArtifactStatus status={ref.node.status} variant="glyph" /> : null}
            </span>
          ) : (
            <span key={ref.reference}>
              <code>{ref.reference}</code> · Unresolved: {ref.reason}
            </span>
          ),
        )
      ) : (
        <span>None declared.</span>
      )}
    </section>
  );
}

function RawProperties({ node }: { node: PlanningModelNode }) {
  return (
    <DetailDisclosure label="Raw properties">
      {() => (
        <dl className="pc-detail__raw">
          {Object.entries(node.frontmatter).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                <code>{typeof value === 'string' ? value : JSON.stringify(value)}</code>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </DetailDisclosure>
  );
}

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
  const copy = usePlanningCopy();
  const shortcutsEnabled = usePlanningShortcuts();
  const verifiedColumns = useRef<VerifiedColumns | null>(null);
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
  const openDependencies = detail.dependencies.filter(
    (ref) => ref.node && !['done', 'addressed'].includes(ref.node.status),
  );
  const unresolved = detail.dependencies.some((ref) => !ref.node);
  const status =
    !['done', 'addressed'].includes(node.status) && openDependencies.length
      ? 'blocked'
      : node.status;
  const href = planningDetailHref(node);
  const link =
    href && typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}${href}`
      : href;
  const spec = detail.trace.find((entry) => entry.node.type === 'spec')?.node;
  const command = planningContinuation(node);
  const report = spec ? planningContinuation(spec) : null;
  const sourceNode = read.node;
  const detailLoading = read.loading || parentRead.loading;
  return (
    <article
      className={`pc-detail__artifact${panel ? ' pc-detail__artifact--panel' : ''}`}
      data-artifact-id={node.id}
      data-detail-state={
        read.error || parentRead.error ? 'error' : detailLoading ? 'loading' : 'ready'
      }
    >
      <header className="pc-detail__header">
        <div className="pc-detail__identity">
          <NodeLink node={{ ...node, title: '' }} />
          <ArtifactStatus status={status} />
          <span className="pc-detail__source-status">
            Source: <SourceStatus node={node} />
          </span>
          {node.status === 'in-progress' ? (
            <span className="pc-detail__source-status">
              Quiet: unknown · Phase 2 evidence unavailable
            </span>
          ) : null}
          {openDependencies.length ? <span>Blocked by {openDependencies.length}</span> : null}
          <PriorityChip
            priority={
              typeof node.frontmatter.priority === 'string' ? node.frontmatter.priority : 'none'
            }
          />
        </div>
        {panel ? <h2>{node.title}</h2> : <h1>{node.title}</h1>}
        <div className="pc-detail__actions">
          {link ? <CopyDetailValue value={link} label="Copy link to item" /> : null}
        </div>
      </header>
      <div className="pc-detail__read-status" aria-live="polite">
        {read.error ? (
          <>
            <p role="alert">{read.error}</p>
            <Button size="sm" onClick={read.retry}>
              Retry detail
            </Button>
          </>
        ) : (
          <p role="status">
            {detailLoading
              ? sourceNode || verifiedColumns.current?.key === columnsKey
                ? 'Updating verified detail…'
                : 'Loading verified detail…'
              : 'Detail verified against the current planning snapshot.'}
          </p>
        )}
        {parentRead.error ? (
          <>
            <p role="alert">Referenced specification: {parentRead.error}</p>
            <Button size="sm" onClick={parentRead.retry}>
              Retry referenced criteria
            </Button>
          </>
        ) : parentSummary && !parentRead.node ? (
          <p role="status">Loading referenced criteria…</p>
        ) : null}
      </div>
      <Card
        title="Trace"
        description="From intent to this artifact and what it unblocks"
        padding={20}
      >
        <StructuralTrace key={node.id} model={detail} />
      </Card>
      {renderVerifiedColumns(
        verifiedColumns,
        columnsKey,
        Boolean(
          sourceNode &&
            !read.loading &&
            !read.error &&
            (!parentSummary || (parentRead.node && !parentRead.loading && !parentRead.error)),
        ),
        () => (
          <div className="pc-detail__columns">
            <div className="pc-detail__stack">
              <Card title="Acceptance criteria" meta={String(detail.criteria.length)} padding={20}>
                <section aria-label="Acceptance criteria">
                  {detail.criteria.length ? (
                    <ol className="pc-detail__criteria">
                      {detail.criteria.map((criterion, position) => (
                        <li key={`${criterion.sourceId}:${criterion.id ?? position}`}>
                          <code>{criterion.id ?? String(position + 1)}</code>
                          <div>
                            <PlanningMarkdown text={criterion.text} />
                            {criterion.sourceId && criterion.sourceId !== node.id ? (
                              <a href={planningDetailHref(criterion.sourceId) ?? undefined}>
                                From {criterion.sourceId}
                              </a>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>No acceptance criteria declared.</p>
                  )}
                </section>
              </Card>
              <Card
                className="pc-detail__files-card"
                title="Files"
                description="Declared by the artifact"
                padding={0}
              >
                <section
                  className="pc-detail__files-region"
                  aria-label="Declared files"
                  style={{
                    minBlockSize: `calc(${Math.max(1, detail.files.length)} * var(--pc-detail-file-row-height))`,
                  }}
                >
                  {detail.files.length ? (
                    detail.files.map((file) => (
                      <div className="pc-detail__file" key={`${file.group}:${file.text}`}>
                        <span className="pc-detail__file-kind">{file.group}</span>
                        {file.path && sourceNode ? (
                          <DeclaredFile
                            compact
                            key={`${node.id}:${file.path}`}
                            path={file.path}
                            node={sourceNode}
                            model={model}
                            origin={origin}
                          />
                        ) : (
                          <span>{file.text.replace(/`([^`]+)`/gu, '$1')}</span>
                        )}
                      </div>
                    ))
                  ) : (
                    <p>No files declared.</p>
                  )}
                </section>
              </Card>
              <Card title="Evidence" padding={20}>
                <section
                  className="pc-detail__evidence-region"
                  data-scroll-context="evidence"
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: This scroll region must be reachable for keyboard scrolling.
                  tabIndex={0}
                  aria-label="Artifact evidence"
                >
                  <DeferredDetailContent key={node.id}>
                    {() => (
                      <>
                        {detail.evidence.length ? (
                          <dl>
                            {detail.evidence.map((entry) => (
                              <div key={`${entry.label}:${entry.value}`}>
                                <dt>{entry.label}</dt>
                                <dd>
                                  {entry.href ? (
                                    <a href={entry.href} rel="noreferrer">
                                      {entry.value}
                                    </a>
                                  ) : (
                                    <code>{entry.value}</code>
                                  )}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        ) : (
                          <p>No linked evidence declared.</p>
                        )}
                        <p>
                          Commit, pull request and release evidence is unavailable in this preview.
                          Git history arrives in Phase 2.
                        </p>
                      </>
                    )}
                  </DeferredDetailContent>
                </section>
              </Card>
              <Card title="Artifact body" padding={20}>
                <DetailDisclosure key={node.id} label="Read Markdown source">
                  {() =>
                    sourceNode?.body ? (
                      <PlanningMarkdown text={sourceNode.body} />
                    ) : (
                      <p>
                        {!sourceNode
                          ? read.loading
                            ? 'Reading the artifact body…'
                            : 'The artifact body is unavailable until the detail is verified.'
                          : 'No body declared in the verified detail.'}
                      </p>
                    )
                  }
                </DetailDisclosure>
              </Card>
            </div>
            <div className="pc-detail__stack">
              <Card className="pc-detail__properties-card" title="Properties" padding={0}>
                <dl className="pc-detail__properties">
                  <div>
                    <dt>Status</dt>
                    <dd>
                      {typeof node.frontmatter.status === 'string'
                        ? `${node.frontmatter.status} in frontmatter`
                        : 'Not recorded in frontmatter.'}
                    </dd>
                  </div>
                  <div>
                    <dt>Depends on</dt>
                    <dd>
                      <PropertyReferences rows={detail.dependencies} label="Depends on" />
                    </dd>
                  </div>
                  <div>
                    <dt>Unblocks</dt>
                    <dd>
                      <PropertyReferences rows={detail.dependents} label="Unblocks" />
                    </dd>
                  </div>
                  <div>
                    <dt>Story</dt>
                    <dd>
                      <PropertyReferences
                        rows={detail.parents.filter(
                          (ref) =>
                            ref.node?.type === 'story' ||
                            ref.reference === node.frontmatter.storyId,
                        )}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Spec</dt>
                    <dd>
                      <PropertyReferences
                        rows={detail.parents.filter(
                          (ref) =>
                            ref.node?.type === 'spec' || ref.reference === node.frontmatter.specId,
                        )}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{authoredDate(node.frontmatter.created)}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{authoredDate(node.frontmatter.updated)}</dd>
                  </div>
                  <div>
                    <dt>File</dt>
                    <dd>
                      {detail.sourcePath ? (
                        <code className="pc-detail__path">{detail.sourcePath}</code>
                      ) : (
                        <span>Not recorded.</span>
                      )}
                    </dd>
                  </div>
                </dl>
                <DetailDisclosure label="More relationships">
                  {() => (
                    <>
                      <Relations title="Parents" rows={detail.parents} />
                      <Relations title="Contains" rows={detail.children} />
                    </>
                  )}
                </DetailDisclosure>
                <RawProperties node={node} />
                {detail.sourcePath && sourceNode ? (
                  <DeclaredFile
                    path={detail.sourcePath}
                    node={sourceNode}
                    model={model}
                    origin={origin}
                  />
                ) : (
                  <p>Source file path is not recorded in this snapshot.</p>
                )}
              </Card>
              <Card className="pc-detail__next-card" title="Next step" padding={0}>
                <p>
                  {unresolved
                    ? 'Resolve the missing references before treating this work as ready.'
                    : openDependencies.length
                      ? 'Inspect the open dependencies before continuing this artifact.'
                      : 'Continue from the verified artifact.'}
                </p>
                {command ? (
                  <CommandHint
                    onCopy={copy}
                    shortcutsEnabled={shortcutsEnabled}
                    command={command}
                    label="Copy continuation"
                  />
                ) : (
                  <p>An exact continuation is unavailable for this identity.</p>
                )}
                {report && report !== command ? (
                  <CommandHint
                    onCopy={copy}
                    shortcutsEnabled={shortcutsEnabled}
                    command={report}
                    label="Copy spec report"
                  />
                ) : null}
                {node.type === 'task' && node.id.includes('/') ? (
                  <p>
                    Task show and update commands cannot resolve this scoped identity. Use the
                    scoped continuation or parent spec report.
                  </p>
                ) : null}
                <p>Copies text only. The dashboard never runs these commands.</p>
              </Card>
            </div>
          </div>
        ),
      )}
      {node.type === 'spec' ? (
        <PlanningOperatingOriginSection specId={node.id} binding={model.binding} node={read.node} />
      ) : null}
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
