/* biome-ignore-all lint/a11y/noNoninteractiveTabindex: the horizontally scrolling proof table must remain keyboard-scrollable at narrow widths and 200% zoom. */
import { useMemo, useState } from 'react';
import { canonicalDashboardHref } from '../../../app/router.js';
import type { OperateReviewModel } from './review-model.js';

const TRACE_PAGE = 40;

function human(value: string): string {
  const words = value.replaceAll('-', ' ').replaceAll('_', ' ');
  return `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

function EvidenceLinks({
  ids,
  model,
  label,
}: {
  ids: readonly string[];
  model: OperateReviewModel;
  label: string;
}) {
  if (ids.length === 0) return <span>No {label.toLocaleLowerCase('en-US')} linked.</span>;
  const evidence = new Map(
    model.payload.data.evidence.map((entry) => [entry.evidenceRefId, entry]),
  );
  return (
    <ul className="op-review__evidence-links" aria-label={label}>
      {ids.map((id) => {
        const record = evidence.get(id);
        const href = record ? canonicalDashboardHref(record.deepLink) : null;
        return (
          <li key={id}>
            {href ? <a href={href}>{id}</a> : <code>{id}</code>}
            <span>
              {record ? `${human(record.claimStatus)} · ${human(record.freshness)}` : 'Not visible'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Challenges({ model }: { model: OperateReviewModel }) {
  const { findings, dissent, uncertainty, gaps } = model.payload.data;
  return (
    <section className="op-review__section" aria-labelledby="op-review-challenge-title">
      <div className="op-review__section-heading">
        <p className="op-eyebrow">Challenge record</p>
        <h2 id="op-review-challenge-title">What could change this decision</h2>
      </div>
      <div className="op-review__challenge-grid">
        <section aria-labelledby="op-review-findings-title">
          <h3 id="op-review-findings-title">Findings ({findings.length})</h3>
          {findings.length ? (
            <ol>
              {findings.map((finding) => (
                <li key={finding.findingId}>
                  <strong>{finding.title}</strong>
                  <p>{finding.statement}</p>
                  <span>{human(finding.state)}</span>
                  {finding.origin === 'operating-intelligence' ? (
                    <EvidenceLinks
                      ids={[
                        ...finding.supportingEvidenceRefIds,
                        ...finding.contradictingEvidenceRefIds,
                      ]}
                      model={model}
                      label={`Evidence for ${finding.title}`}
                    />
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p>No findings were returned.</p>
          )}
        </section>
        <section aria-labelledby="op-review-dissent-title">
          <h3 id="op-review-dissent-title">Dissent ({dissent.length})</h3>
          {dissent.length ? (
            <ol>
              {dissent.map((entry) => (
                <li key={`${entry.sourceArtifactId}:${entry.localDissentId}`}>
                  <p>{entry.statement}</p>
                  <strong>Resolution condition</strong>
                  <p>{entry.resolutionCondition}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p>No dissent was returned.</p>
          )}
        </section>
        <section aria-labelledby="op-review-uncertainty-title">
          <h3 id="op-review-uncertainty-title">Uncertainty ({uncertainty.length})</h3>
          {uncertainty.length ? (
            <ol>
              {uncertainty.map((entry) => (
                <li key={entry.uncertaintyId}>
                  <p>{entry.statement}</p>
                  <span>{human(entry.sourceKind)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p>No explicit uncertainty was returned.</p>
          )}
        </section>
        <section aria-labelledby="op-review-gaps-title">
          <h3 id="op-review-gaps-title">Missing proof ({gaps.length})</h3>
          {gaps.length ? (
            <ol>
              {gaps.map((gap) => (
                <li key={gap.absenceId}>
                  <p>{gap.reason}</p>
                  <strong>Next step</strong>
                  <p>{gap.recoveryDisposition}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p>No typed gaps were returned.</p>
          )}
        </section>
      </div>
    </section>
  );
}

function ClaimEvidence({ model }: { model: OperateReviewModel }) {
  const { claims } = model.payload.data;
  return (
    <section className="op-review__section" aria-labelledby="op-review-claims-title">
      <div className="op-review__section-heading">
        <p className="op-eyebrow">Evidence desk</p>
        <h2 id="op-review-claims-title">Claims and sentence-level proof</h2>
      </div>
      {claims.length ? (
        <ol className="op-review__claims">
          {claims.map((claim) => (
            <li key={claim.claimId}>
              <div>
                <strong>{claim.statement ?? `Restricted claim ${claim.claimId}`}</strong>
                <span>
                  {human(claim.status)} · {human(claim.epistemicStatus)}
                </span>
              </div>
              <EvidenceLinks
                ids={claim.supportEvidenceRefIds}
                model={model}
                label={`Supporting evidence for ${claim.claimId}`}
              />
              <EvidenceLinks
                ids={claim.contradictEvidenceRefIds}
                model={model}
                label={`Contradicting evidence for ${claim.claimId}`}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p>No claim statements were returned for this Review.</p>
      )}
    </section>
  );
}

function TraceMatrix({ model }: { model: OperateReviewModel }) {
  const [visible, setVisible] = useState(TRACE_PAGE);
  const matrix = model.payload.data.traceMatrix;
  const rows = useMemo(() => matrix?.edges.slice(0, visible) ?? [], [matrix, visible]);
  if (!matrix) {
    return (
      <section className="op-review__section" aria-labelledby="op-review-trace-title">
        <h2 id="op-review-trace-title">Reciprocal decision trace</h2>
        <p>The bounded trace matrix is not available in this workspace.</p>
      </section>
    );
  }
  return (
    <section className="op-review__section" aria-labelledby="op-review-trace-title">
      <div className="op-review__section-heading">
        <p className="op-eyebrow">Reciprocal trace</p>
        <h2 id="op-review-trace-title">Requirement to outcome custody</h2>
      </div>
      <dl className="op-review__proof">
        <div>
          <dt>Nodes</dt>
          <dd>{matrix.nodes.length}</dd>
        </div>
        <div>
          <dt>Relationships</dt>
          <dd>{matrix.edges.length}</dd>
        </div>
        <div>
          <dt>Restricted</dt>
          <dd>{matrix.proof.restrictedNodes}</dd>
        </div>
        <div>
          <dt>Typed absences</dt>
          <dd>{matrix.proof.typedAbsences}</dd>
        </div>
      </dl>
      <section
        className="op-review__table-scroll"
        aria-label="Scrollable reciprocal decision trace"
        tabIndex={0}
      >
        <table>
          <caption>
            Exact trace relationships, shown {rows.length} of {matrix.edges.length}
          </caption>
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">Relationship</th>
              <th scope="col">To</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((edge) => (
              <tr key={edge.edgeId}>
                <td>
                  <span>{human(edge.from.kind)}</span>
                  <code>{edge.from.id}</code>
                </td>
                <td>{human(edge.relation)}</td>
                <td>
                  <span>{human(edge.to.kind)}</span>
                  <code>{edge.to.id}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {visible < matrix.edges.length ? (
        <button
          type="button"
          className="op-inline-action"
          onClick={() => setVisible((count) => count + TRACE_PAGE)}
        >
          Show the next {Math.min(TRACE_PAGE, matrix.edges.length - visible)} relationships
        </button>
      ) : null}
      {matrix.omissions.length ? (
        <details>
          <summary>Trace omissions ({matrix.omissions.length})</summary>
          <ul>
            {matrix.omissions.map((entry) => (
              <li key={entry.omissionId}>
                {human(entry.subject)} <code>{entry.subjectId}</code> · {human(entry.kind)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export function ReviewEvidenceTrace({ model }: { model: OperateReviewModel }) {
  const truth = model.payload.data.truthSummary;
  return (
    <>
      <Challenges model={model} />
      <section className="op-review__section" aria-labelledby="op-review-proof-title">
        <div className="op-review__section-heading">
          <p className="op-eyebrow">Shared proof truth</p>
          <h2 id="op-review-proof-title">What the evidence can prove</h2>
        </div>
        <dl className="op-review__proof">
          <div>
            <dt>Proof status</dt>
            <dd>{human(truth.proof.status)}</dd>
          </div>
          <div>
            <dt>Linked evidence</dt>
            <dd>{truth.proof.linkedEvidence}</dd>
          </div>
          <div>
            <dt>Restricted evidence</dt>
            <dd>{truth.proof.restrictedEvidence}</dd>
          </div>
          <div>
            <dt>Unresolved claims</dt>
            <dd>{truth.proof.unresolvedClaims}</dd>
          </div>
          <div>
            <dt>Validated seats</dt>
            <dd>
              {truth.seats.validated} / {truth.seats.total}
            </dd>
          </div>
          <div>
            <dt>Verified outcomes</dt>
            <dd>{truth.proof.verifiedOutcomes}</dd>
          </div>
        </dl>
        {truth.proof.reasonCodes.length ? (
          <p role="status">Limits: {truth.proof.reasonCodes.map(human).join(' · ')}</p>
        ) : null}
      </section>
      <ClaimEvidence model={model} />
      <TraceMatrix model={model} />
    </>
  );
}
