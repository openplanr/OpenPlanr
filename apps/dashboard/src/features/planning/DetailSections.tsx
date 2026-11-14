import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { Button, PcIcon, Skeleton } from '../../design-system/components/index.js';
import { DetailNextStep } from './DetailNextStep.js';
import { DetailProperties } from './DetailProperties.js';
import { DeclaredFile } from './PlanningDetailActions.js';
import { DeferredDetailContent, PlanningMarkdown } from './PlanningMarkdown.js';
import { type PlanningModelNode, planningDetailHref } from './planning-model.js';
import {
  type StructuralCriterion,
  type StructuralDetailModel,
  structuralFilePath,
} from './planning-structural-model.js';
import type { PlanningWorkspaceModel } from './planning-workspace.js';

const FILE_KIND: Readonly<Record<string, string>> = {
  Create: 'new',
  Modify: 'edit',
  Preserve: 'preserve',
};

function DetailCard({
  title,
  label,
  meta,
  actions,
  className,
  children,
}: {
  title: string;
  label?: string;
  meta?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`pc-card${className ? ` ${className}` : ''}`} aria-label={label ?? title}>
      <header className="pc-card__head pc-card__header">
        <h2 className="pc-card__title">{title}</h2>
        {meta ? <span className="pc-detail__meta">{meta}</span> : null}
        {actions ? <div className="pc-card__actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

function Criteria({ rows, nodeId }: { rows: readonly StructuralCriterion[]; nodeId: string }) {
  const tracked = rows.every((row) => row.checked !== null);
  const met = rows.filter((row) => row.checked).length;
  return (
    <DetailCard
      title="Acceptance criteria"
      meta={
        tracked
          ? `${met} of ${rows.length} met`
          : `${rows.length} ${rows.length === 1 ? 'criterion' : 'criteria'}`
      }
      actions={
        tracked ? (
          <span className="pc-detail__progress" aria-hidden="true">
            <span style={{ inlineSize: `${(met / rows.length) * 100}%` }} />
          </span>
        ) : null
      }
    >
      <ul className="pc-detail__criteria" data-tracked={tracked || undefined}>
        {rows.map((row, position) => (
          <li key={`${row.sourceId}:${row.id ?? position}`} data-met={row.checked || undefined}>
            {tracked ? <span className="pc-detail__check" aria-hidden="true" /> : null}
            <code>{row.id ?? String(position + 1)}</code>
            <div>
              <PlanningMarkdown text={row.text} />
              {row.sourceId && row.sourceId !== nodeId ? (
                <a href={planningDetailHref(row.sourceId) ?? undefined}>From {row.sourceId}</a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </DetailCard>
  );
}

function descriptionText(node: PlanningModelNode): string {
  const body = (node.body ?? '').trim();
  const heading = body.match(/^#\s+(.+)\n?/u);
  return heading && heading[1].includes(node.title) ? body.slice(heading[0].length).trim() : body;
}

/** The prose before the first heading; the full text is parsed only after "Show all". */
function descriptionPreview(text: string): string {
  const heading = text.search(/^#{1,6}\s/mu);
  return heading > 0 ? text.slice(0, heading).trim() : heading === 0 ? '' : text;
}

function Description({ text, nodeId }: { text: string; nodeId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const preview = descriptionPreview(text);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element || expanded) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  });
  return (
    <DetailCard
      title="Description"
      className="pc-detail__description"
      actions={
        overflows || expanded || preview !== text ? (
          <Button size="sm" variant="ghost" onClick={() => setExpanded((open) => !open)}>
            {expanded ? 'Show less' : 'Show all'}
          </Button>
        ) : null
      }
    >
      <div className="pc-detail__description-body" ref={body} data-expanded={expanded || undefined}>
        {expanded ? (
          <PlanningMarkdown text={text} />
        ) : preview ? (
          <DeferredDetailContent key={nodeId}>
            {() => <PlanningMarkdown text={preview} />}
          </DeferredDetailContent>
        ) : null}
      </div>
    </DetailCard>
  );
}

export function LoadingColumns() {
  return (
    <div className="pc-detail__skeleton-columns" aria-hidden="true">
      <div className="pc-detail__stack">
        <div className="pc-card pc-detail__skeleton">
          <Skeleton w="160px" h={20} radius="6px" />
          <Skeleton w="70%" h={14} radius="6px" />
          <Skeleton w="80%" h={14} radius="6px" />
          <Skeleton w="60%" h={14} radius="6px" />
        </div>
      </div>
      <div className="pc-detail__stack">
        <div className="pc-card pc-detail__skeleton">
          <Skeleton w="120px" h={20} radius="6px" />
          <Skeleton w="100%" h={40} radius="8px" />
        </div>
      </div>
    </div>
  );
}

export function ReadError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="pc-state-card pc-state-error pc-detail__error" role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      <Button size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** The verified two-column body: criteria, files, description and evidence beside next step and properties. */
export function DetailColumns({
  model,
  node,
  detail,
  sourceNode,
  origin,
}: {
  model: PlanningWorkspaceModel;
  node: PlanningModelNode;
  detail: StructuralDetailModel;
  sourceNode: PlanningModelNode | null;
  origin: string;
}) {
  const description = sourceNode ? descriptionText(sourceNode) : '';
  return (
    <div className="pc-detail__columns">
      <div className="pc-detail__stack">
        {detail.criteria.length ? <Criteria rows={detail.criteria} nodeId={node.id} /> : null}
        {detail.files.length ? (
          <DetailCard
            title="Files"
            label="Declared files"
            className="pc-detail__files-card"
            meta={String(detail.files.length)}
          >
            <ul className="pc-detail__files">
              {detail.files.map((file) => (
                <li className="pc-detail__file" key={`${file.group}:${file.text}`}>
                  <PcIcon name="file-text" size={14} />
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
                    <span
                      className="pc-detail__file-text"
                      data-path={structuralFilePath(file.text) ? true : undefined}
                    >
                      {file.text.replace(/`([^`]+)`/gu, '$1')}
                    </span>
                  )}
                  <span className="pc-detail__file-kind" data-kind={FILE_KIND[file.group]}>
                    {FILE_KIND[file.group] ?? file.group.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          </DetailCard>
        ) : null}
        {description ? <Description text={description} nodeId={node.id} /> : null}
        {detail.evidence.length ? (
          <DetailCard
            title="Evidence"
            label="Artifact evidence"
            meta={String(detail.evidence.length)}
          >
            <dl className="pc-detail__evidence">
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
          </DetailCard>
        ) : null}
      </div>
      <div className="pc-detail__stack">
        <DetailNextStep node={node} dependencies={detail.dependencies} />
        <DetailProperties
          node={node}
          detail={detail}
          sourceNode={sourceNode}
          model={model}
          origin={origin}
        />
      </div>
    </div>
  );
}
