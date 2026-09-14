/* biome-ignore-all lint/suspicious/noArrayIndexKey: owner ordering and duplicate labels remain visible without client deduplication. */
import { PcIcon, type PcIconName } from '../../design-system/components/index.js';
import type { DashboardSearchHit, DashboardUnsupportedIdentity } from './search-index.js';

const GROUP_ORDER = Object.freeze(['route', 'planning', 'operate'] as const);
const GROUP_LABEL = Object.freeze({
  route: 'Go to',
  planning: 'Planning work',
  operate: 'Operate items',
} satisfies Record<DashboardSearchHit['source'], string>);
const GROUP_ICON = Object.freeze({
  route: 'chevron-right',
  planning: 'corner-down-right',
  operate: 'gauge',
} satisfies Record<DashboardSearchHit['source'], PcIconName>);

function humanLabel(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replaceAll('-', ' ')
    .replaceAll('_', ' ')
    .trim();
  return words === '' ? value : `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

export type SearchResultsProps = Readonly<{
  hits: readonly DashboardSearchHit[];
  unsupported?: readonly DashboardUnsupportedIdentity[];
  activeHref: string | null;
  listId: string;
  onSelect: (hit: DashboardSearchHit) => void;
}>;

function groupHits(
  hits: readonly DashboardSearchHit[],
): Readonly<Record<DashboardSearchHit['source'], readonly DashboardSearchHit[]>> {
  const grouped: Record<DashboardSearchHit['source'], DashboardSearchHit[]> = {
    route: [],
    planning: [],
    operate: [],
  };
  for (const hit of hits) grouped[hit.source].push(hit);
  return Object.freeze({
    route: Object.freeze(grouped.route),
    planning: Object.freeze(grouped.planning),
    operate: Object.freeze(grouped.operate),
  });
}

export function SearchResults({
  hits,
  unsupported = Object.freeze([]),
  activeHref,
  listId,
  onSelect,
}: SearchResultsProps) {
  const grouped = groupHits(hits);
  const hasHits = hits.length > 0;
  const hasUnsupported = unsupported.length > 0;

  if (!hasHits && !hasUnsupported) {
    return (
      <p className="pc-palette__empty" role="status">
        No matches. Try a view name or an item id like US-001.
      </p>
    );
  }

  return (
    <div className="pc-palette__results">
      {GROUP_ORDER.map((source) => {
        const rows = grouped[source];
        if (rows.length === 0) return null;
        return (
          <section
            key={source}
            className="pc-palette__group"
            aria-labelledby={`${listId}-${source}-heading`}
          >
            <h2 id={`${listId}-${source}-heading`} className="pc-palette__group-title">
              {GROUP_LABEL[source]}
            </h2>
            <ol className="pc-palette__list" aria-label={GROUP_LABEL[source]}>
              {rows.map((hit, index) => {
                const active = hit.href === activeHref;
                return (
                  <li key={`${hit.id}:${index}`}>
                    <button
                      type="button"
                      className="pc-palette__row"
                      data-active={active ? 'true' : 'false'}
                      aria-current={active ? 'true' : undefined}
                      onClick={() => onSelect(hit)}
                    >
                      <PcIcon name={GROUP_ICON[source]} size={14} />
                      <span className="pc-palette__row-title">{hit.title}</span>
                      <span className="pc-palette__row-hint">{humanLabel(hit.kind)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
      {hasUnsupported ? (
        <section className="pc-palette__group" aria-labelledby={`${listId}-unsupported-heading`}>
          <h2 id={`${listId}-unsupported-heading`} className="pc-palette__group-title">
            Unavailable destinations
          </h2>
          <ol className="pc-palette__list" aria-label="Unavailable destinations">
            {unsupported.map((identity, index) => (
              <li key={`${identity.id}:${index}`}>
                <div className="pc-palette__row" aria-disabled="true">
                  <PcIcon name="circle-slash" size={14} />
                  <span className="pc-palette__row-title">{identity.title}</span>
                  <span className="pc-palette__row-hint">
                    {humanLabel(identity.kind)} · {identity.reason}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
