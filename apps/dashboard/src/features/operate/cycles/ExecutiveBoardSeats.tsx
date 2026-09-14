/* biome-ignore-all lint/suspicious/noArrayIndexKey: owner seat order and duplicate identities remain byte-for-byte visible. */
import type { OperateExecutiveBoardDisplayPayloadV1 } from '@openplanr/protocol/schemas/v1.2.0/operate-executive-board-display-surface.mjs';
import type { OperateExecutiveBoardModel } from './executive-board-model.js';

type ExecutiveBoard = OperateExecutiveBoardModel['board'];
type ExecutiveBoardSeat = ExecutiveBoard['seats'][number];
type ChallengerFindings = NonNullable<ExecutiveBoard['challengerFindings']>;
type ChairSynthesis = NonNullable<ExecutiveBoard['chairSynthesis']>;

function humanLabel(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replaceAll('-', ' ')
    .replaceAll('_', ' ')
    .trim();
  return words === '' ? value : `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

function asChallengerFindings(
  value: ExecutiveBoard['challengerFindings'],
): ChallengerFindings | null {
  if (!value || !Array.isArray(value.findings) || !Array.isArray(value.dissent)) return null;
  return value;
}

function asChairSynthesis(value: ExecutiveBoard['chairSynthesis']): ChairSynthesis | null {
  if (!value || !Array.isArray(value.decisions)) return null;
  return value;
}

export type ExecutiveBoardSeatsProps = Readonly<{
  model: OperateExecutiveBoardModel;
}>;

function absenceSummary(absence: ExecutiveBoardSeat['absence']): string {
  if (!absence) return 'No absence was returned.';
  if (absence.kind === 'omitted') return absence.reason;
  if (absence.kind === 'lens') return absence.reason;
  return absence.reason;
}

function SeatCard({ seat, index }: { seat: ExecutiveBoardSeat; index: number }) {
  const hasArtifact = seat.artifact !== null;
  return (
    <article
      className="op-executive-seat"
      data-seat-role-id={seat.roleId}
      data-seat-role-kind={seat.roleKind}
      data-seat-state={seat.assignmentState ?? 'absent'}
      aria-labelledby={`op-executive-seat-${index}-title`}
    >
      <header className="op-executive-seat__header">
        <p className="op-eyebrow">{humanLabel(seat.roleKind)}</p>
        <h3 id={`op-executive-seat-${index}-title`}>{seat.label}</h3>
        <p>{seat.assignmentState ? humanLabel(seat.assignmentState) : 'Not issued'}</p>
      </header>
      <dl className="op-executive-seat__facts">
        <div>
          <dt>Report</dt>
          <dd>{hasArtifact ? 'Submitted' : 'Not submitted'}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>{seat.assignmentState ? humanLabel(seat.assignmentState) : 'Not issued'}</dd>
        </div>
        {seat.absence ? (
          <div>
            <dt>Typed absence</dt>
            <dd>{absenceSummary(seat.absence)}</dd>
          </div>
        ) : null}
      </dl>
      <details className="op-executive-seat__technical">
        <summary>Technical details</summary>
        <dl className="op-executive-seat__facts">
          <div>
            <dt>Role ID</dt>
            <dd>
              <code>{seat.roleId}</code> · v{seat.roleVersion}
            </dd>
          </div>
          <div>
            <dt>Assignment ID</dt>
            <dd>{seat.assignmentId ? <code>{seat.assignmentId}</code> : 'Not issued'}</dd>
          </div>
          <div>
            <dt>Artifact</dt>
            <dd>
              {hasArtifact ? (
                <>
                  <code>{seat.artifact.artifactId}</code>
                  <span className="op-executive-seat__hash">
                    Raw <code>{seat.artifact.rawHash}</code>
                  </span>
                  <span className="op-executive-seat__hash">
                    Canonical <code>{seat.artifact.canonicalHash}</code>
                  </span>
                </>
              ) : (
                'No accepted artifact was returned.'
              )}
            </dd>
          </div>
        </dl>
      </details>
    </article>
  );
}

function ChallengerPanel({ findings }: { findings: ChallengerFindings | null }) {
  if (!findings) return null;
  return (
    <section className="op-executive-challenger" aria-labelledby="op-executive-challenger-title">
      <div className="op-cycle-section-heading">
        <div>
          <p className="op-eyebrow">Independent challenge</p>
          <h2 id="op-executive-challenger-title">Challenger findings</h2>
        </div>
        <p>The Challenger tests the board's assumptions independently.</p>
      </div>
      {findings.findings.length > 0 ? (
        <ul className="op-executive-claims">
          {findings.findings.map((finding, index) => (
            <li key={`${finding.findingId}:${index}`}>
              <strong>{finding.title}</strong>
              <p>{finding.statement}</p>
              <p>
                {humanLabel(finding.severity)} severity · {humanLabel(finding.state)}
              </p>
              <details className="op-executive-claim__technical">
                <summary>Technical details</summary>
                <code>{finding.findingId}</code> · <code>{finding.findingType}</code>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p>No Challenger finding was returned.</p>
      )}
      {findings.dissent.length > 0 ? (
        <div className="op-executive-dissent">
          <h3>Dissent</h3>
          <ul>
            {findings.dissent.map((entry, index) => (
              <li key={`${entry.sourceArtifactId}:${entry.localDissentId}:${index}`}>
                <span>{entry.statement}</span>
                <small> Resolve when {entry.resolutionCondition}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ChairPanel({ synthesis }: { synthesis: ChairSynthesis | null }) {
  if (!synthesis) return null;
  return (
    <section className="op-executive-chair" aria-labelledby="op-executive-chair-title">
      <div className="op-cycle-section-heading">
        <div>
          <p className="op-eyebrow">Evidence-bound synthesis</p>
          <h2 id="op-executive-chair-title">Chair synthesis</h2>
        </div>
        <p>The Chair brings the reports together. Any next step still needs review.</p>
      </div>
      {synthesis.decisions.length > 0 ? (
        <div className="op-executive-decisions">
          {synthesis.decisions.map((decision, index) => (
            <article key={`${decision.title ?? 'decision'}:${index}`}>
              <h3>{decision.title ?? 'Untitled decision'}</h3>
              {decision.question ? <p>{decision.question}</p> : null}
              {decision.outcome ? <p>{decision.outcome}</p> : null}
              {decision.rationale ? <p>{decision.rationale}</p> : null}
              {decision.actionHypotheses.length > 0 ? (
                <ul>
                  {decision.actionHypotheses.map((action, actionIndex) => (
                    <li key={`${action.title ?? 'action'}:${actionIndex}`}>
                      <strong>{action.title ?? 'Proposed action'}</strong>
                      {action.expectedResult ? <span>{action.expectedResult}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p>No Chair decision was returned.</p>
      )}
      {synthesis.unresolvedGaps.length > 0 ? (
        <div className="op-executive-gaps">
          <h3>Unresolved gaps</h3>
          <ul>
            {synthesis.unresolvedGaps.map((gap, index) => (
              <li
                key={`${gap.kind}:${gap.kind === 'role' ? gap.roleId : gap.requirementId}:${index}`}
              >
                <span>{gap.reason}</span>
                <details className="op-executive-gap__technical">
                  <summary>Technical details</summary>
                  <code>{gap.kind === 'role' ? gap.roleId : gap.requirementId}</code> ·{' '}
                  <code>{gap.absenceCode}</code>
                </details>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {synthesis.dissent.length > 0 ? (
        <div className="op-executive-dissent">
          <h3>Preserved dissent</h3>
          <ul>
            {synthesis.dissent.map((entry, index) => (
              <li key={`${entry.sourceArtifactId}:${entry.localDissentId}:${index}`}>
                <span>{entry.statement}</span>
                <small> Resolve when {entry.resolutionCondition}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Pure presentation of one verified owner-issued executive board envelope. */
export function ExecutiveBoardSeats({ model }: ExecutiveBoardSeatsProps) {
  const board: OperateExecutiveBoardDisplayPayloadV1['data']['executiveBoard'] = model.board;
  return (
    <section className="op-executive-board" aria-labelledby="op-executive-board-title">
      <div className="op-cycle-section-heading">
        <div>
          <p className="op-eyebrow">Issued executive board</p>
          <h2 id="op-executive-board-title">Executive seats</h2>
        </div>
        <p>See the perspectives that informed this cycle.</p>
      </div>
      <div className="op-executive-board__seats">
        {board.seats.map((seat, index) => (
          <SeatCard seat={seat} index={index} key={`${seat.roleId}:${index}`} />
        ))}
      </div>
      {board.challengerFindings ? (
        <ChallengerPanel findings={asChallengerFindings(board.challengerFindings)} />
      ) : null}
      {board.chairSynthesis ? (
        <ChairPanel synthesis={asChairSynthesis(board.chairSynthesis)} />
      ) : null}
    </section>
  );
}
