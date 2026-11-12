import type { ReactNode } from 'react';
import { ArtifactTag, artifactTagType } from '../../design-system/components/artifact-recipes.js';
import { ArtifactStatus } from '../../design-system/components/index.js';
import { useDetailSelectable } from './DetailSelection.js';
import { authoredDay } from './DetailSummary.js';
import { DeclaredFile } from './PlanningDetailActions.js';
import { DetailDisclosure } from './PlanningMarkdown.js';
import {
  type PlanningModelNode,
  planningDetailHref,
  planningDisplayId,
  typePlural,
} from './planning-model.js';
import type { StructuralDetailModel, StructuralReference } from './planning-structural-model.js';
import type { PlanningWorkspaceModel } from './planning-workspace.js';
import { planningLabels } from './presentation-view.js';

function ChipLink({
  node,
  href,
  children,
}: {
  node: PlanningModelNode;
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      className="pc-detail__property-reference"
      href={href}
      title={node.title}
      {...useDetailSelectable(node)}
    >
      {children}
    </a>
  );
}

/** A reference chip: a link to a resolved item, or a dashed warning for a missing one. */
export function ReferenceChip({ reference }: { reference: StructuralReference }) {
  const node = reference.node;
  if (!node)
    return (
      <span className="pc-detail__property-reference" data-missing>
        <code>{reference.reference}</code> not found
      </span>
    );
  const href = planningDetailHref(node);
  const tag = artifactTagType(node.type);
  const content = (
    <>
      <ArtifactStatus status={node.status} variant="glyph" />
      {planningDisplayId(node)}
    </>
  );
  const chip = tag ? (
    <ArtifactTag type={tag}>{content}</ArtifactTag>
  ) : (
    <span className="pc-artifact-tag">{content}</span>
  );
  return href ? (
    <ChipLink node={node} href={href}>
      {chip}
    </ChipLink>
  ) : (
    <span className="pc-detail__property-reference" title={node.title}>
      {chip}
    </span>
  );
}

function References({ label, rows }: { label: string; rows: readonly StructuralReference[] }) {
  return (
    <section className="pc-detail__property-references" aria-label={label}>
      {rows.map((ref) => (
        <ReferenceChip key={ref.node?.id ?? ref.reference} reference={ref} />
      ))}
    </section>
  );
}

function parentRows(node: PlanningModelNode, detail: StructuralDetailModel) {
  const matches = (ref: StructuralReference, type: string, key: string) =>
    ref.node ? ref.node.type === type : ref.reference === node.frontmatter[key];
  const story = detail.parents.filter((ref) => matches(ref, 'story', 'storyId'));
  const spec = detail.parents.filter((ref) => matches(ref, 'spec', 'specId'));
  const other = detail.parents.filter((ref) => !story.includes(ref) && !spec.includes(ref));
  return { story, spec, other };
}

function childRows(detail: StructuralDetailModel): [string, StructuralReference[]][] {
  const groups = new Map<string, StructuralReference[]>();
  for (const ref of detail.children) {
    const label = ref.node ? typePlural(ref.node.type) : 'Contains';
    groups.set(label, [...(groups.get(label) ?? []), ref]);
  }
  return [...groups];
}

export function DetailProperties({
  node,
  detail,
  sourceNode,
  model,
  origin,
}: {
  node: PlanningModelNode;
  detail: StructuralDetailModel;
  sourceNode: PlanningModelNode | null;
  model: PlanningWorkspaceModel;
  origin: string;
}) {
  const parents = parentRows(node, detail);
  const labels = planningLabels(node);
  const created = authoredDay(node.frontmatter.created, true);
  const rows: [string, ReactNode][] = [];
  const references = (label: string, values: readonly StructuralReference[]) => {
    if (values.length) rows.push([label, <References key={label} label={label} rows={values} />]);
  };
  references('Story', parents.story);
  references('Spec', parents.spec);
  references('Parent', parents.other);
  references('Depends on', detail.dependencies);
  references('Unblocks', detail.dependents);
  for (const [label, values] of childRows(detail)) references(label, values);
  if (labels.length) rows.push(['Labels', labels.join(', ')]);
  if (created) rows.push(['Created', created]);
  if (detail.sourcePath)
    rows.push([
      'File',
      sourceNode ? (
        <DeclaredFile
          key="file"
          compact
          path={detail.sourcePath}
          node={sourceNode}
          model={model}
          origin={origin}
        />
      ) : (
        <code key="file" className="pc-detail__path">
          {detail.sourcePath}
        </code>
      ),
    ]);
  const frontmatter = Object.entries(node.frontmatter);
  return (
    <section className="pc-card pc-detail__properties-card" aria-label="Properties">
      <header className="pc-card__head pc-card__header">
        <h2 className="pc-card__title">Properties</h2>
      </header>
      {rows.length ? (
        <dl className="pc-detail__properties">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {frontmatter.length ? (
        <DetailDisclosure label="Frontmatter">
          {() => (
            <dl className="pc-detail__raw">
              {frontmatter.map(([key, value]) => (
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
      ) : null}
    </section>
  );
}
