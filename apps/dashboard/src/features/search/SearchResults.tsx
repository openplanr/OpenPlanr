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
import {
  type DashboardSearchHit,
  type DashboardUnsupportedIdentity,
  searchHitDisplayId,
} from './search-index.js';

const GROUP_ORDER = Object.freeze(['planning', 'route', 'operate', 'command'] as const);
const GROUP_LABEL = Object.freeze({
  route: 'Views',
  planning: 'Nodes',
  operate: 'Operate items',
  command: 'Commands',
} satisfies Record<DashboardSearchHit['source'], string>);
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
}>;

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
}: SearchResultsProps) {
  const grouped = groupHits(hits);
  const selectedId =
    activeId ?? (activeHref ? hits.find((hit) => hit.href === activeHref)?.id : hits[0]?.id);
  const hasHits = hits.length > 0;
  const hasUnsupported = unsupported.length > 0;

  if (!hasHits && !hasUnsupported) {
    return (
      <p className="pc-palette__empty" role="status">
        No matches. Try an item ID, view name or command.
      </p>
    );
  }

  return (
    <div className="pc-palette__results" id={listId}>
      {GROUP_ORDER.map((source) => {
        const rows = grouped[source];
        const occurrences = new Map<string, number>();
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
            <ol
              className="pc-palette__list"
              aria-label={GROUP_LABEL[source]}
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
                    className="pc-artifact-row pc-palette__result"
                    data-source={hit.source}
                    data-selected={active || undefined}
                  >
                    <button
                      type="button"
                      className="pc-palette__row pc-artifact-row__link"
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
                    </button>
                    <span className="pc-palette__row-hint">{humanLabel(hit.kind)}</span>
                    {hit.source === 'command' || hit.source === 'planning' ? (
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
