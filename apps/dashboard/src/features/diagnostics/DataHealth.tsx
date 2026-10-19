import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  Toolbar,
} from '../../design-system/components/index.js';
import { planningDetailHref } from '../planning/planning-model.js';
import { structuralFilePath } from '../planning/planning-structural-model.js';

const REASONS = {
  'missing-reference': 'Unresolved reference',
  'ambiguous-reference': 'Ambiguous reference',
  'duplicate-identity': 'Duplicate identity',
  'dependency-cycle': 'Dependency cycle',
  'containment-cycle': 'Containment cycle',
  'invalid-date': 'Invalid authored date',
  'missing-date': 'Missing authored date',
  'closed-before-start': 'Closed before start',
  'end-before-start': 'End before start',
} as const;

export type ReadDiagnostic = Readonly<{
  nodeId: string;
  sourcePath: string;
  field: string;
  reason: keyof typeof REASONS;
  classification: 'source-data';
}>;

export type DataHealthRead = Readonly<{
  diagnostics: readonly ReadDiagnostic[];
}>;

const FIELDS = new Set([
  'epicId',
  'featureId',
  'storyId',
  'specId',
  'dependsOn',
  'taskIds',
  'id',
  'parent',
  'startDate',
  'endDate',
  'closedAt',
  'releaseCut',
]);

const RECOVERY = {
  references:
    'Inspect the authored reference and its intended item. Reconcile the source in your editor or host workflow, then wait for a fresh read.',
  identities:
    'Inspect the colliding source identities. Resolve the duplicate in the source before relying on its relationships.',
  cycles:
    'Inspect the linked dependencies or parents. Resolve the cycle in the source before relying on execution order.',
  dates:
    'Inspect the authored sprint dates. Use valid calendar dates and a closing or ending date on or after the start.',
} as const;

function category(reason: ReadDiagnostic['reason']): keyof typeof RECOVERY {
  if (reason.includes('reference')) return 'references';
  if (reason === 'duplicate-identity') return 'identities';
  if (reason.includes('cycle')) return 'cycles';
  return 'dates';
}

export function DataHealth({ read = null }: { read?: DataHealthRead | null }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const rows = useMemo(() => {
    const occurrences = new Map<string, number>();
    return (read?.diagnostics ?? []).map((entry) => {
      const nodeId = planningDetailHref(entry.nodeId) ? entry.nodeId : '';
      const sourcePath = structuralFilePath(entry.sourcePath) ?? '';
      const field = FIELDS.has(entry.field) ? entry.field : 'Authored field';
      const identity = JSON.stringify([nodeId, sourcePath, field, entry.reason]);
      const occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      return { ...entry, nodeId, sourcePath, field, id: `${identity}:${occurrence}` };
    });
  }, [read]);
  const needle = query.trim().toLowerCase();
  const shown = rows.filter((entry) => {
    const source = structuralFilePath(entry.sourcePath) ?? '';
    return (
      (filter === 'all' || category(entry.reason) === filter) &&
      `${entry.nodeId} ${source} ${entry.field} ${REASONS[entry.reason]}`
        .toLowerCase()
        .includes(needle)
    );
  });

  return (
    <div className="op-diagnostics__health">
      <p className="op-diagnostics__intro">
        Observed source-data findings only. Inspection is read-only and does not repair authored
        files.
      </p>
      {read === null ? (
        <Card>
          <EmptyState
            icon="info"
            title="Source diagnostics are unavailable"
            description="Source diagnostics are not available from this server. A readable graph does not prove that references, identities or sprint dates are valid."
            action={<a href="#/list">Inspect planning items</a>}
          />
        </Card>
      ) : (
        <>
          <Toolbar>
            <Input
              ariaLabel="Filter data health"
              placeholder="Filter item or source"
              value={query}
              onChange={setQuery}
              icon="search"
            />
            <Select
              ariaLabel="Data health category"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All findings' },
                { value: 'references', label: 'References' },
                { value: 'identities', label: 'Identities' },
                { value: 'cycles', label: 'Cycles' },
                { value: 'dates', label: 'Sprint dates' },
              ]}
            />
            <span className="op-diagnostics__count" role="status">
              {shown.length} of {rows.length} findings
            </span>
          </Toolbar>
          {shown.length === 0 ? (
            <Card>
              <EmptyState
                icon={rows.length === 0 ? 'circle-check' : 'search'}
                title={
                  rows.length === 0
                    ? 'No source findings reported'
                    : 'No findings match these filters'
                }
                description={
                  rows.length === 0
                    ? 'The current reader reported no reference, identity, cycle or authored sprint-date findings. This is an observation of this read, not a source repair.'
                    : 'Other findings remain available. Clear the filters to inspect them.'
                }
                action={
                  rows.length > 0 ? (
                    <Button
                      onClick={() => {
                        setQuery('');
                        setFilter('all');
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <ol className="op-diagnostics__list" aria-label="Data health findings">
              {shown.map((entry) => {
                const href = planningDetailHref(entry.nodeId);
                const path = structuralFilePath(entry.sourcePath);
                return (
                  <li key={entry.id} data-diagnostic={entry.reason}>
                    <article>
                      <header>
                        <Badge tone="warn" icon="triangle-alert">
                          {REASONS[entry.reason]}
                        </Badge>
                        <h3>
                          {href ? (
                            <a
                              data-keyboard-item={entry.id}
                              data-canonical-id={entry.nodeId}
                              href={href}
                            >
                              {entry.nodeId}
                            </a>
                          ) : (
                            'Item identity unavailable'
                          )}
                        </h3>
                      </header>
                      <p>
                        <strong>Source:</strong>{' '}
                        <code>{path ?? 'Repository-relative source unavailable'}</code>
                      </p>
                      <p>
                        <strong>Field:</strong> {entry.field}
                      </p>
                      <p className="op-diagnostics__remediation">
                        {RECOVERY[category(entry.reason)]}
                      </p>
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
