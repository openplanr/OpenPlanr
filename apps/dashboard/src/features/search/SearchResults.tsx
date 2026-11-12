/* biome-ignore-all lint/suspicious/noArrayIndexKey: owner ordering and duplicate labels remain visible without client deduplication. */

import {
  ArtifactRowAction,
  artifactRowStyle,
} from '../../design-system/components/artifact-row.js';
import {
  ArtifactRowTitle,
  ArtifactStatus,
  ArtifactTag,
  type ArtifactType,
  PcIcon,
  type PcIconName,
} from '../../design-system/components/index.js';
import { planningArtifactStatusLabel } from '../planning/planning-model.js';
import {
  type DashboardSearchHit,
  type DashboardUnsupportedIdentity,
  searchHitDisplayId,
} from './search-index.js';

const GROUP_ORDER = Object.freeze(['planning', 'route', 'operate', 'command'] as const);
const GROUP_LABEL = Object.freeze({
  route: 'Views',
  planning: 'Items',
  operate: 'Operate',
  command: 'Commands',
} satisfies Record<DashboardSearchHit['source'], string>);
const OPENING_LABEL = Object.freeze({ ...GROUP_LABEL, route: 'Go to', planning: 'Recent' });
const PALETTE_ICON = Object.freeze({
  route: 'list',
  planning: 'chevron-right',
  operate: 'gauge',
  command: 'copy',
} satisfies Record<DashboardSearchHit['source'], PcIconName>);
const GROUP_ICON = Object.freeze({
  route: 'chevron-right',
  planning: 'corner-down-right',
  operate: 'gauge',
  command: 'copy',
} satisfies Record<DashboardSearchHit['source'], PcIconName>);

const PLANNING_TAG: Readonly<Record<string, ArtifactType>> = {
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
  activeId?: string | null;
  commandBusy?: boolean;
  shortcutsEnabled?: boolean;
  listId: string;
  onSelect: (hit: DashboardSearchHit) => void;
  onFocus?: (hit: DashboardSearchHit) => void;
  commandForHit?: (hit: DashboardSearchHit) => string | null;
  displayIdForHit?: (hit: DashboardSearchHit) => string;
  onCopyCommand?: (command: string) => void;
  /** The palette draws compact rows without per-row actions; `#/search` keeps its table rows. */
  variant?: 'palette' | 'page';
  opening?: boolean;
  term?: string;
  operateLoading?: boolean;
}>;

function MatchedTitle({ title, term }: Readonly<{ title: string; term: string }>) {
  const needle = term
    .trim()
    .replace(/^@\w+\s*/u, '')
    .toLowerCase();
  const start = needle ? title.toLowerCase().indexOf(needle) : -1;
  if (start < 0) return <>{title}</>;
  // The split title is hidden from the accessible name so it reads as one word.
  return (
    <>
      <span aria-hidden="true">
        {title.slice(0, start)}
        <span className="pc-palette__match">{title.slice(start, start + needle.length)}</span>
        {title.slice(start + needle.length)}
      </span>
      <span className="pc-visually-hidden">{title}</span>
    </>
  );
}

function paletteMeta(hit: DashboardSearchHit): string {
  if (hit.source === 'command') return hit.command;
  if (hit.source === 'route') return 'View';
  if (hit.source === 'planning') return hit.status ? planningArtifactStatusLabel(hit.status) : '';
  return humanLabel(hit.kind);
}

function groupHits(
  hits: readonly DashboardSearchHit[],
): Readonly<Record<DashboardSearchHit['source'], readonly DashboardSearchHit[]>> {
  const grouped: Record<DashboardSearchHit['source'], DashboardSearchHit[]> = {
    route: [],
    planning: [],
    operate: [],
    command: [],
  };
  for (const hit of hits) grouped[hit.source].push(hit);
  return Object.freeze({
    route: Object.freeze(grouped.route),
    planning: Object.freeze(grouped.planning),
    operate: Object.freeze(grouped.operate),
    command: Object.freeze(grouped.command),
  });
}

export function SearchResults({
  hits,
  unsupported = Object.freeze([]),
  activeHref,
  activeId,
  commandBusy = false,
  shortcutsEnabled = true,
  listId,
  onSelect,
  onFocus,
  commandForHit,
  displayIdForHit = searchHitDisplayId,
  onCopyCommand,
  variant = 'page',
  opening = false,
  term = '',
  operateLoading = false,
}: SearchResultsProps) {
  const palette = variant === 'palette';
  const labels = opening ? OPENING_LABEL : GROUP_LABEL;
  const grouped = groupHits(hits);
  const selectedId =
    activeId ?? (activeHref ? hits.find((hit) => hit.href === activeHref)?.id : hits[0]?.id);
  const hasHits = hits.length > 0;
  const hasUnsupported = unsupported.length > 0;

  if (!hasHits && !hasUnsupported) {
    if (palette) return null;
    return (
      <p className="pc-palette__empty" role="status">
        No matches. Try an item ID, view name or command.
      </p>
    );
  }

  return (
    <div className="pc-palette__results" id={listId} data-variant={variant}>
      {GROUP_ORDER.map((source) => {
        const rows = grouped[source];
        const occurrences = new Map<string, number>();
        if (palette && source === 'operate' && operateLoading && rows.length === 0)
          return (
            <section
              key={source}
              className="pc-palette__group"
              aria-labelledby={`${listId}-${source}-heading`}
              aria-busy="true"
            >
              <h2 id={`${listId}-${source}-heading`} className="pc-palette__group-title">
                {labels[source]} <span className="pc-palette__searching">searching…</span>
              </h2>
              <div className="pc-palette__skeleton" aria-hidden="true">
                <span />
              </div>
            </section>
          );
        if (rows.length === 0) return null;
        return (
          <section
            key={source}
            className="pc-palette__group"
            aria-labelledby={`${listId}-${source}-heading`}
          >
            <h2 id={`${listId}-${source}-heading`} className="pc-palette__group-title">
              {labels[source]}
            </h2>
            <ol
              className="pc-palette__list"
              aria-label={labels[source]}
              style={artifactRowStyle(rows.map((hit) => displayIdForHit(hit)))}
            >
              {rows.map((hit) => {
                const command =
                  hit.source === 'command' ? hit.command : (commandForHit?.(hit) ?? null);
                const occurrence = occurrences.get(hit.id) ?? 0;
                occurrences.set(hit.id, occurrence + 1);
                const active = hit.id === selectedId;
                return (
                  <li
                    key={`${hit.id}:${occurrence}`}
                    className={
                      palette ? 'pc-palette__result' : 'pc-artifact-row pc-palette__result'
                    }
                    data-source={hit.source}
                    data-selected={active || undefined}
                  >
                    <button
                      type="button"
                      className={
                        palette ? 'pc-palette__row' : 'pc-palette__row pc-artifact-row__link'
                      }
                      data-search-result={hit.id}
                      data-keyboard-item={hit.id}
                      data-copy-command={hit.source === 'command' ? 'true' : undefined}
                      data-canonical-id={
                        hit.source === 'planning'
                          ? hit.id.slice('planning:'.length)
                          : hit.source === 'operate'
                            ? hit.id.slice(`operate:${hit.kind}:`.length)
                            : undefined
                      }
                      onFocus={() => onFocus?.(hit)}
                      data-active={active ? 'true' : 'false'}
                      aria-current={active ? 'true' : undefined}
                      disabled={hit.source === 'command' && commandBusy}
                      aria-busy={(hit.source === 'command' && commandBusy) || undefined}
                      onClick={() => onSelect(hit)}
                    >
                      {palette ? (
                        <>
                          <PcIcon name={PALETTE_ICON[source]} size={16} />
                          {hit.source === 'planning' ? (
                            <span
                              className="pc-palette__id"
                              style={{
                                color: `var(--op-type-${PLANNING_TAG[hit.kind] ?? 'qt'})`,
                              }}
                            >
                              {displayIdForHit(hit)}
                            </span>
                          ) : null}
                          <span className="pc-palette__title" title={hit.title}>
                            <MatchedTitle title={hit.title} term={term} />
                          </span>
                          <span
                            className="pc-palette__meta"
                            data-command={hit.source === 'command' || undefined}
                          >
                            {paletteMeta(hit)}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="pc-artifact-row__id pc-palette__identity">
                            {hit.source === 'planning' && PLANNING_TAG[hit.kind] ? (
                              <>
                                {hit.status ? (
                                  <ArtifactStatus status={hit.status} size="sm" variant="glyph" />
                                ) : null}
                                <ArtifactTag type={PLANNING_TAG[hit.kind]}>
                                  {displayIdForHit(hit)}
                                </ArtifactTag>
                              </>
                            ) : (
                              <PcIcon name={GROUP_ICON[source]} size={16} />
                            )}
                          </span>
                          <ArtifactRowTitle>{hit.title}</ArtifactRowTitle>
                        </>
                      )}
                    </button>
                    {palette ? null : (
                      <span className="pc-palette__row-hint">{humanLabel(hit.kind)}</span>
                    )}
                    {palette ? null : hit.source === 'command' || hit.source === 'planning' ? (
                      <ArtifactRowAction
                        id={hit.source === 'planning' ? hit.id.slice('planning:'.length) : hit.id}
                        onFocus={() => onFocus?.(hit)}
                        shortcutsEnabled={shortcutsEnabled}
                        disabled={commandBusy || !command}
                        disabledReason={
                          !command
                            ? 'No verified command is available for this identity.'
                            : commandBusy
                              ? 'A command copy is already in progress.'
                              : undefined
                        }
                        onCopy={() => {
                          if (command) {
                            if (onCopyCommand) onCopyCommand(command);
                            else onSelect(hit);
                          }
                        }}
                      />
                    ) : (
                      <span />
                    )}
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
