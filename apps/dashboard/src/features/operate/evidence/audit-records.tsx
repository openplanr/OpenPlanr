import {
  ActionStateBadge,
  SectionHeader,
  StatePanel,
} from '../../../design-system/components/index.js';

/* Fields rendered as a governed state badge, in priority order. */
const BADGE_KEYS = Object.freeze(['claimStatus', 'status', 'state']);

const FACT_KEYS = Object.freeze([
  'classification',
  'accessState',
  'accessReason',
  'freshness',
  'evidenceKind',
  'confidence',
  'why',
  'epistemicStatus',
]);

function scalar(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

function humanLabel(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replaceAll('-', ' ')
    .replaceAll('_', ' ')
    .trim();
  return words === '' ? value : `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

function factValue(value: string): string {
  if (value === 'true') return 'Yes';
  if (value === 'false') return 'No';
  return humanLabel(value);
}

function recordId(record: object, fallback: string): string {
  return (
    scalar(Reflect.get(record, 'evidenceRefId')) ??
    scalar(Reflect.get(record, 'outcomeId')) ??
    scalar(Reflect.get(record, 'claimId')) ??
    scalar(Reflect.get(record, 'eventId')) ??
    scalar(Reflect.get(record, 'metricId')) ??
    scalar(Reflect.get(record, 'learningId')) ??
    fallback
  );
}

function deepLinkOf(record: object): string | null {
  const href = scalar(Reflect.get(record, 'deepLink'));
  return href?.startsWith('#/') ? href : null;
}

function badgeState(record: object): string | null {
  for (const key of BADGE_KEYS) {
    const value = scalar(Reflect.get(record, key));
    if (value !== null) return value;
  }
  return null;
}

function fallbackTitle(heading: string, index: number): string {
  const noun =
    heading === 'History'
      ? 'History entry'
      : heading.endsWith('s')
        ? heading.slice(0, -1)
        : heading;
  return `${noun} ${index + 1}`;
}

export function AuditNotice({ presentation }: { presentation: string }) {
  if (presentation === 'ready') return null;
  return (
    <p className="pc-operate__notice" role="status">
      This view is {humanLabel(presentation).toLocaleLowerCase('en-US')}. It does not make a success
      claim.
    </p>
  );
}

function RecordFacts({ record }: { record: object }) {
  const facts = FACT_KEYS.flatMap((key) => {
    const value = scalar(Reflect.get(record, key));
    return value === null ? [] : [{ key, value }];
  });
  if (facts.length === 0) return null;
  return (
    <dl className="pc-operate__record-facts">
      {facts.map((fact) => (
        <div key={fact.key}>
          <dt>{humanLabel(fact.key)}</dt>
          <dd>{factValue(fact.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AuditRecords({
  heading,
  records,
}: {
  heading: string;
  records: readonly object[];
}) {
  if (records.length === 0) {
    return (
      <StatePanel
        state="unavailable"
        eyebrow={heading}
        title={`No ${heading.toLowerCase()} to review`}
        description={`There are no ${heading.toLocaleLowerCase('en-US')} in this cycle right now.`}
      />
    );
  }
  return (
    <section className="pc-operate__section" aria-label={heading}>
      <SectionHeader headingLevel={2} title={heading} count={records.length} />
      <ol className="pc-operate__records">
        {records.map((record, index) => {
          const title =
            scalar(Reflect.get(record, 'title')) ??
            scalar(Reflect.get(record, 'statement')) ??
            scalar(Reflect.get(record, 'summary')) ??
            scalar(Reflect.get(record, 'why')) ??
            fallbackTitle(heading, index);
          const id = recordId(record, `${heading}-${index}`);
          const href = deepLinkOf(record);
          const state = badgeState(record);
          return (
            <li className="pc-operate__record" key={id}>
              <div className="pc-operate__record-head">
                <h3 className="pc-operate__record-title">
                  <span className="pc-operate__record-index" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>{' '}
                  {href ? (
                    <a className="pc-row-link" href={href}>
                      {title}
                    </a>
                  ) : (
                    title
                  )}
                </h3>
                {state ? <ActionStateBadge state={state} /> : null}
              </div>
              <RecordFacts record={record} />
              <details className="pc-operate__technical">
                <summary>Technical details</summary>
                <code>{id}</code>
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
