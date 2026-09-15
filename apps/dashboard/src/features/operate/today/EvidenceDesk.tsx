import type { OperateTodaySurfaceModel } from './today-model.js';

export type EvidenceDeskProps = Readonly<{
  model: OperateTodaySurfaceModel;
  mode: 'wide' | 'compact';
}>;

function metricValue(value: number | null, unit: string | null): string {
  if (value === null) return 'Not observed';
  return unit ? `${value} ${unit}` : String(value);
}

function readableStatus(value: string): string {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function metricStatus(freshness: string, state: string): string {
  const freshnessLabel = readableStatus(freshness);
  const stateLabel = readableStatus(state);
  return freshnessLabel === stateLabel
    ? `${freshnessLabel} data`
    : `${freshnessLabel} data · ${stateLabel}`;
}

function EvidenceDeskContents({
  model,
  idPrefix,
}: {
  model: OperateTodaySurfaceModel;
  idPrefix: string;
}) {
  const evidenceReferences = model.attention.flatMap((attention) =>
    attention.evidenceRefIds.map((evidenceRefId) => ({
      attentionId: attention.attentionId,
      evidenceRefId,
    })),
  );

  return (
    <>
      <div className="op-today-evidence__summary">
        <span>{evidenceReferences.length} linked</span>
        <span>
          {model.domainMetrics.length} metric{model.domainMetrics.length === 1 ? '' : 's'}
        </span>
      </div>

      <section aria-labelledby={`${idPrefix}-metrics`}>
        <p className="op-eyebrow" id={`${idPrefix}-metrics`}>
          {model.vocabulary.signals}
        </p>
        {model.domainMetrics.length > 0 ? (
          <dl className="op-today-evidence__metrics">
            {model.domainMetrics.map((metric) => (
              <div key={metric.metricId} data-freshness={metric.freshness}>
                <dt>{metric.title ?? 'Key signal'}</dt>
                <dd>
                  <span>{metricValue(metric.value, metric.unit)}</span>
                  <small>{metricStatus(metric.freshness, metric.state)}</small>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p>No signal is available for this workspace yet.</p>
        )}
      </section>

      <section aria-labelledby={`${idPrefix}-evidence-refs`}>
        <p className="op-eyebrow" id={`${idPrefix}-evidence-refs`}>
          Supporting evidence
        </p>
        {evidenceReferences.length > 0 ? (
          <p>
            {evidenceReferences.length} supporting record
            {evidenceReferences.length === 1 ? '' : 's'} are available in Evidence.
          </p>
        ) : (
          <p>No supporting record is linked to this focus yet.</p>
        )}
      </section>

      <details className="op-binding-passport__details">
        <summary>Technical details</summary>
        <dl className="op-today-evidence__custody">
          <div>
            <dt>Supporting records</dt>
            <dd>
              <code>
                {evidenceReferences.length > 0
                  ? evidenceReferences.map((entry) => entry.evidenceRefId).join(' · ')
                  : 'None'}
              </code>
            </dd>
          </div>
          <div>
            <dt>Event record</dt>
            <dd>
              <code>
                {model.surface.eventHead.sequence} · {model.surface.eventHead.hash ?? 'genesis'}
              </code>
            </dd>
          </div>
          <div>
            <dt>View hash</dt>
            <dd>
              <code>{model.surface.viewHash}</code>
            </dd>
          </div>
          <div>
            <dt>Generated</dt>
            <dd>
              <time dateTime={model.surface.generatedAt}>{model.surface.generatedAt}</time>
            </dd>
          </div>
        </dl>
      </details>
    </>
  );
}

export function EvidenceDesk({ model, mode }: EvidenceDeskProps) {
  const idPrefix = `op-today-evidence-${mode}-${model.binding.generation}`;
  if (mode === 'compact') {
    return (
      <details className="op-today-evidence op-today-evidence--compact">
        <summary>Evidence</summary>
        <div className="op-today-evidence__body">
          <EvidenceDeskContents model={model} idPrefix={idPrefix} />
        </div>
      </details>
    );
  }

  return (
    <aside className="op-today-evidence op-today-evidence--wide" aria-label="Evidence">
      <h2>Evidence</h2>
      <EvidenceDeskContents model={model} idPrefix={idPrefix} />
    </aside>
  );
}
