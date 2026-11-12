import { ArtifactTag, artifactTagType } from '../../design-system/components/artifact-recipes.js';
import { ArtifactStatus, PriorityChip } from '../../design-system/components/index.js';
import { useDetailNarrow } from './DetailSelection.js';
import { CopyDetailValue } from './PlanningDetailActions.js';
import { type PlanningModelNode, planningDisplayId } from './planning-model.js';
import { authoredTimestamp } from './presentation-view.js';

const PRIORITIES = ['P0', 'P1', 'P2', 'P3', 'critical', 'high', 'medium', 'low'];

/** Day and short month of a valid authored date that is not in the future, else null. */
export function authoredDay(value: unknown, year = false): string | null {
  const time = authoredTimestamp(value);
  if (time === null || time > Date.now()) return null;
  return new Date(time).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(year ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

/** "A", "A and B", or "A +N" for a list of display IDs. */
export function idPhrase(ids: readonly string[]): string {
  if (ids.length <= 1) return ids[0] ?? '';
  if (ids.length === 2) return `${ids[0]} and ${ids[1]}`;
  return `${ids[0]} +${ids.length - 1}`;
}

export function DetailSummary({
  node,
  status,
  blockers,
  link,
  panel,
}: {
  node: PlanningModelNode;
  status: string;
  blockers: readonly PlanningModelNode[];
  link: string | null;
  panel: boolean;
}) {
  const priority =
    typeof node.frontmatter.priority === 'string' && PRIORITIES.includes(node.frontmatter.priority)
      ? node.frontmatter.priority
      : null;
  const updated = authoredDay(node.frontmatter.updated);
  const tag = artifactTagType(node.type);
  const inTopBar = useDetailNarrow() && !panel;
  return (
    <header className="pc-detail__header">
      <div className="pc-detail__identity">
        {inTopBar ? null : tag ? (
          <ArtifactTag type={tag} variant="id">
            {planningDisplayId(node)}
          </ArtifactTag>
        ) : (
          <code className="pc-detail__plain-id">{planningDisplayId(node)}</code>
        )}
        <span className="pc-detail__status" data-status={status}>
          <ArtifactStatus
            status={status}
            variant="legend"
            label={
              blockers.length
                ? `Blocked by ${idPhrase(blockers.map(planningDisplayId))}`
                : undefined
            }
          />
        </span>
        {priority ? (
          <span className="pc-detail__priority">
            <PriorityChip priority={priority} variant="text" />
          </span>
        ) : null}
        {updated ? <span className="pc-detail__updated">Updated {updated}</span> : null}
      </div>
      <div className="pc-detail__title-row">
        {panel ? <h2>{node.title}</h2> : <h1>{node.title}</h1>}
        {link && !inTopBar ? <CopyDetailValue value={link} label="Copy link" icon="link" /> : null}
      </div>
    </header>
  );
}
