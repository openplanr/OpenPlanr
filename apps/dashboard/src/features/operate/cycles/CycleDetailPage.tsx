/* biome-ignore-all lint/suspicious/noArrayIndexKey: canonical arrays retain owner order and duplicate identities by contract. */
import {
  ActionStateBadge,
  MetricStat,
  SectionHeader,
  StatePanel,
} from '../../../design-system/components/index.js';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import {
  isOperateReviewNavigationForCycle,
  type OperateReviewNavigation,
} from '../review/review-navigation.js';
import {
  type OperateCycleModel,
  type OperateCycleModelSources,
  resolveOperateCycleModel,
} from './cycle-model.js';
import { ExecutiveBoardSeats } from './ExecutiveBoardSeats.js';
import { resolveOperateCycleExecutiveBoardSection } from './executive-board-model.js';
import { OperatingSpine, operatingStageLabel } from './OperatingSpine.js';
import '../operate.css';

export type CycleDetailPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  sources: OperateCycleModelSources;
  reviewNavigation?: OperateReviewNavigation | null;
}>;

function humanLabel(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replaceAll('-', ' ')
    .replaceAll('_', ' ')
    .trim();
  return words === '' ? value : `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function ValueList({
  values,
  empty,
  className,
}: {
  values: readonly string[];
  empty: string;
  className?: string;
}) {
  return values.length > 0 ? (
    <ul className={className}>
      {values.map((value, index) => (
        <li key={`${value}:${index}`}>
          <code>{value}</code>
        </li>
      ))}
    </ul>
  ) : (
    <p>{empty}</p>
  );
}

function StageLedger({ model }: { model: OperateCycleModel }) {
  return (
    <section className="op-cycle-stages" aria-labelledby="op-cycle-stages-title">
      <div className="op-cycle-section-heading">
        <div>
          <p className="op-eyebrow">Cycle progress</p>
          <h2 id="op-cycle-stages-title">What is happening now</h2>
        </div>
        <p>
          Open a stage to inspect only its returned inputs, outputs, gates, gaps, and uncertainty.
        </p>
      </div>
      <div className="op-cycle-stages__ledger">
        {model.stages.map((stage, index) => (
          <details
            className="op-cycle-stage"
            key={`${stage.id}:${index}`}
            open={stage.state === 'current'}
            data-stage-state={stage.state}
          >
            <summary>
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <strong>{operatingStageLabel(stage.id)}</strong>
              <small>{stage.reason ?? humanLabel(stage.state)}</small>
              <span className="op-cycle-stage__status">{humanLabel(stage.state)}</span>
            </summary>
            <div className="op-cycle-stage__overview">
              <span>{countLabel(stage.inputArtifactIds.length, 'input')}</span>
              <span>{countLabel(stage.outputArtifactIds.length, 'output')}</span>
              <span>{countLabel(stage.gates.length, 'gate')}</span>
              <span>{countLabel(stage.evidenceGapIds.length, 'evidence gap')}</span>
              <span>{countLabel(stage.uncertaintyIds.length, 'uncertainty', 'uncertainties')}</span>
              <span>{countLabel(stage.persistentActionIds.length, 'persistent action')}</span>
            </div>
            <details className="op-cycle-stage__technical">
              <summary>Technical details</summary>
              <div className="op-cycle-stage__body">
                <section aria-labelledby={`op-cycle-stage-${index}-inputs`}>
                  <h3 id={`op-cycle-stage-${index}-inputs`}>Inputs</h3>
                  <ValueList values={stage.inputArtifactIds} empty="No inputs were returned." />
                </section>
                <section aria-labelledby={`op-cycle-stage-${index}-outputs`}>
                  <h3 id={`op-cycle-stage-${index}-outputs`}>Outputs</h3>
                  <ValueList values={stage.outputArtifactIds} empty="No outputs were returned." />
                </section>
                <section aria-labelledby={`op-cycle-stage-${index}-gates`}>
                  <h3 id={`op-cycle-stage-${index}-gates`}>Gates</h3>
                  {stage.gates.length > 0 ? (
                    <ul>
                      {stage.gates.map((gate, gateIndex) => (
                        <li key={`${gate.kind}:${gate.subjectId}:${gateIndex}`}>
                          <strong>{humanLabel(gate.kind)}</strong> <code>{gate.subjectId}</code>{' '}
                          <span>{humanLabel(gate.state)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No gates were returned.</p>
                  )}
                </section>
                <section aria-labelledby={`op-cycle-stage-${index}-blockers`}>
                  <h3 id={`op-cycle-stage-${index}-blockers`}>Blockers and uncertainty</h3>
                  <div className="op-cycle-stage__signals">
                    <div>
                      <h4>Evidence gaps</h4>
                      <ValueList
                        values={stage.evidenceGapIds}
                        empty="No evidence gaps were returned."
                      />
                    </div>
                    <div>
                      <h4>Uncertainty</h4>
                      <ValueList
                        values={stage.uncertaintyIds}
                        empty="No uncertainty was returned."
                      />
                    </div>
                    <div>
                      <h4>Persistent actions</h4>
                      <ValueList
                        values={stage.persistentActionIds}
                        empty="No persistent actions were returned for this stage."
                      />
                    </div>
                  </div>
                </section>
              </div>
            </details>
          </details>
        ))}
      </div>
    </section>
  );
}

function OwnershipLedger({ model }: { model: OperateCycleModel }) {
  return (
    <section className="op-cycle-ownership" aria-labelledby="op-cycle-ownership-title">
      <div className="op-cycle-section-heading">
        <div>
          <p className="op-eyebrow">People and dependencies</p>
          <h2 id="op-cycle-ownership-title">Work in this cycle</h2>
        </div>
        <p>See who owns the work, what it depends on, and what is blocking progress.</p>
      </div>
      {model.assignments.length > 0 ? (
        <ol className="op-cycle-assignments" aria-label="Cycle assignments">
          {model.assignments.map((assignment, index) => (
            <li key={`${assignment.assignmentId}:${index}`}>
              <div>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{assignment.title ?? model.vocabulary.assignment}</strong>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Role</dt>
                  <dd>{assignment.role ? humanLabel(assignment.role) : 'Not returned'}</dd>
                </div>
                <div>
                  <dt>Owner</dt>
                  <dd>{assignment.ownerLabel ?? 'Not returned'}</dd>
                </div>
                <div>
                  <dt>State</dt>
                  <dd>{humanLabel(assignment.state)}</dd>
                </div>
                <div>
                  <dt>Due</dt>
                  <dd>{assignment.dueAt ?? 'Not returned'}</dd>
                </div>
              </dl>
              <details>
                <summary>Technical details</summary>
                <div className="op-cycle-assignment__detail">
                  <section>
                    <h3>Assignment ID</h3>
                    <code>{assignment.assignmentId}</code>
                  </section>
                  <section>
                    <h3>Dependencies</h3>
                    {assignment.dependencies.length > 0 ? (
                      <ul>
                        {assignment.dependencies.map((dependency, dependencyIndex) => (
                          <li key={`${dependency.assignmentId}:${dependencyIndex}`}>
                            <code>{dependency.assignmentId}</code> ·{' '}
                            {dependency.state ?? 'state not returned'} ·{' '}
                            {dependency.resolved ? 'resolved' : 'unresolved'}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No dependency was returned.</p>
                    )}
                  </section>
                  <section>
                    <h3>Blockers</h3>
                    <ValueList values={assignment.blockers} empty="No blocker was returned." />
                  </section>
                  <section>
                    <h3>Artifacts</h3>
                    <p>Inputs</p>
                    <ValueList
                      values={assignment.inputArtifactIds}
                      empty="No input Artifact was returned."
                    />
                    <p>Outputs</p>
                    <ValueList
                      values={assignment.outputArtifactIds}
                      empty="No output Artifact was returned."
                    />
                  </section>
                  {assignment.next ? (
                    <p>
                      Next step: <strong>{assignment.next.label}</strong>{' '}
                      <code>{assignment.next.tool}</code>
                    </p>
                  ) : null}
                </div>
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <p className="op-cycle-empty-line">No assignment was returned for this Cycle.</p>
      )}

      <div className="op-cycle-relations">
        <section aria-labelledby="op-cycle-dependencies-title">
          <h3 id="op-cycle-dependencies-title">Dependency graph</h3>
          {model.dependencies.length > 0 ? (
            <>
              <p>
                {countLabel(model.dependencies.length, 'dependency', 'dependencies')} in this cycle.
              </p>
              <details className="op-cycle-relations__technical">
                <summary>Technical details</summary>
                <ol>
                  {model.dependencies.map((dependency, index) => (
                    <li key={`${dependency.subjectKind}:${dependency.subjectId}:${index}`}>
                      <strong>{humanLabel(dependency.subjectKind)}</strong>{' '}
                      <code>{dependency.subjectId}</code>
                      <ul>
                        {dependency.dependsOn.map((owner, ownerIndex) => (
                          <li
                            key={`${owner.assignmentId ?? owner.actionId ?? 'dependency'}:${ownerIndex}`}
                          >
                            <code>{owner.assignmentId ?? owner.actionId}</code> ·{' '}
                            {owner.state ? humanLabel(owner.state) : 'State not returned'} ·{' '}
                            {owner.resolved ? 'Resolved' : 'Unresolved'}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              </details>
            </>
          ) : (
            <p>No dependencies were returned.</p>
          )}
        </section>
        <section aria-labelledby="op-cycle-blockers-title">
          <h3 id="op-cycle-blockers-title">Cycle blockers</h3>
          {model.blockers.length > 0 ? (
            <>
              <p>{countLabel(model.blockers.length, 'blocker')} need attention.</p>
              <details className="op-cycle-relations__technical">
                <summary>Technical details</summary>
                <ol>
                  {model.blockers.map((blocker, index) => (
                    <li key={`${blocker.subjectKind}:${blocker.subjectId}:${index}`}>
                      <strong>{humanLabel(blocker.subjectKind)}</strong>{' '}
                      <code>{blocker.subjectId}</code>
                      <ValueList
                        values={blocker.blockingSubjectIds}
                        empty="No blocking subject was returned."
                      />
                    </li>
                  ))}
                </ol>
              </details>
            </>
          ) : (
            <p>No blockers are currently returned.</p>
          )}
        </section>
      </div>
    </section>
  );
}

function PersistentWork({ model }: { model: OperateCycleModel }) {
  const items = [
    ...model.persistentWork.findings,
    ...model.persistentWork.decisions,
    ...model.persistentWork.actions,
  ];
  return (
    <section className="op-cycle-persistent" aria-labelledby="op-cycle-persistent-title">
      <div className="op-cycle-section-heading">
        <div>
          <p className="op-eyebrow">Beyond Cycle closure</p>
          <h2 id="op-cycle-persistent-title">Persistent work</h2>
        </div>
        <p>Closure does not complete or delete the work this Cycle created or touched.</p>
      </div>
      {items.length > 0 ? (
        <ol className="op-cycle-persistent__items">
          {items.map((item, index) => (
            <li key={`${item.kind}:${item.subjectId}:${index}`}>
              <span>{humanLabel(item.kind)}</span>
              <strong>{humanLabel(item.state)}</strong>
              <small>{countLabel(item.relations.length, 'related record')}</small>
              <details className="op-cycle-persistent__technical">
                <summary>Technical details</summary>
                <code>{item.subjectId}</code>
                <ValueList values={item.relations} empty="No related records were returned." />
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <p className="op-cycle-empty-line">
          No persistent Finding, Decision, or Action was returned.
        </p>
      )}
      <div className="op-cycle-outcomes">
        <section>
          <h3>Outcomes</h3>
          {model.persistentWork.outcomes.length > 0 ? (
            <ol>
              {model.persistentWork.outcomes.map((outcome, index) => (
                <li key={`${outcome.outcomeId}:${index}`}>
                  {outcome.deepLink ? (
                    <a href={outcome.deepLink}>{humanLabel(outcome.status)}</a>
                  ) : (
                    <strong>{humanLabel(outcome.status)}</strong>
                  )}
                  <details className="op-cycle-outcome__technical">
                    <summary>Technical details</summary>
                    <code>{outcome.outcomeId}</code>
                  </details>
                </li>
              ))}
            </ol>
          ) : (
            <p>No Outcome was returned.</p>
          )}
        </section>
        <section>
          <h3>Learnings</h3>
          {model.persistentWork.learnings.length > 0 ? (
            <ol>
              {model.persistentWork.learnings.map((learning, index) => (
                <li key={`${learning.learningId}:${index}`}>
                  <strong>{learning.statement}</strong>
                  <details className="op-cycle-outcome__technical">
                    <summary>Technical details</summary>
                    <code>{learning.learningId}</code>
                  </details>
                </li>
              ))}
            </ol>
          ) : (
            <p>No Learning was returned.</p>
          )}
        </section>
      </div>
    </section>
  );
}

function ProofDesk({ model }: { model: OperateCycleModel }) {
  const checkpoint = model.replay.checkpoint;
  return (
    <aside className="op-cycle-proof" aria-labelledby="op-cycle-proof-title">
      <p className="op-eyebrow">History and verification</p>
      <h2 id="op-cycle-proof-title">Confidence in this cycle</h2>
      <section className="op-cycle-verification" data-verification={model.verification.status}>
        <h3>{humanLabel(model.verification.status)}</h3>
        <p>
          {model.verification.status === 'unverified'
            ? 'Required proof is missing or incomplete. This Cycle is not presented as verified.'
            : model.verification.status === 'not-required'
              ? 'The canonical projection returned no required verification.'
              : 'The canonical projection returned complete affirmative verification proof.'}
        </p>
        {model.verification.reasonCodes.length > 0 ? (
          <details className="op-cycle-verification__technical">
            <summary>Technical details</summary>
            <ValueList
              values={model.verification.reasonCodes}
              empty="No reason codes were returned."
            />
          </details>
        ) : null}
      </section>
      <details>
        <summary>Technical details</summary>
        <dl className="op-cycle-proof__facts">
          <div>
            <dt>Final head</dt>
            <dd>
              <code>{model.replay.finalHead.sequence}</code>
            </dd>
          </div>
          <div>
            <dt>Tail events</dt>
            <dd>{model.replay.tail.eventCount}</dd>
          </div>
          <div>
            <dt>Checkpoint</dt>
            <dd>{checkpoint ? 'returned' : 'not returned'}</dd>
          </div>
          <div>
            <dt>Checkpoint verified</dt>
            <dd>{model.replay.parityProof.checkpointVerified ? 'yes' : 'no'}</dd>
          </div>
          <div>
            <dt>Final hash matches</dt>
            <dd>{model.replay.parityProof.finalEventHashMatches ? 'yes' : 'no'}</dd>
          </div>
          <div>
            <dt>State parity</dt>
            <dd>{model.replay.parityProof.stateParityVerified ? 'yes' : 'no'}</dd>
          </div>
        </dl>
        {checkpoint ? (
          <div className="op-cycle-proof__checkpoint">
            <time dateTime={checkpoint.createdAt}>{checkpoint.createdAt}</time>
            <code>{checkpoint.runtimeStateHash}</code>
            <code>{checkpoint.eventReplayIndexHash}</code>
            <span>{checkpoint.recoveryVersion}</span>
          </div>
        ) : null}
      </details>
      <section className="op-cycle-read-actions" aria-labelledby="op-cycle-read-actions-title">
        <h3 id="op-cycle-read-actions-title">Available actions</h3>
        <ul>
          {model.allowedActions.map((action, index) => (
            <li key={`${action.tool}:${index}`}>
              <strong>{action.label}</strong>
              <span>{humanLabel(action.effect)}</span>
              <details className="op-cycle-read-actions__technical">
                <summary>Technical details</summary>
                <code>{action.tool}</code>
              </details>
            </li>
          ))}
        </ul>
        <p>Action details are available only when the current cycle allows them.</p>
      </section>
    </aside>
  );
}

function ExecutiveBoardSection({
  model,
  currentBinding,
  executiveBoard,
}: {
  model: OperateCycleModel;
  currentBinding: DashboardQueryIdentity;
  executiveBoard?: DashboardProductState<unknown> | null;
}) {
  const section = resolveOperateCycleExecutiveBoardSection(model, executiveBoard, currentBinding);
  if (section.kind === 'hidden') return null;
  if (section.kind === 'unavailable') {
    return (
      <section className="op-executive-board op-executive-board--unavailable" aria-live="polite">
        <StatePanel
          state="unavailable"
          eyebrow="Executive board"
          title={section.title}
          description={section.description}
        />
      </section>
    );
  }
  if (section.kind === 'incompatible') {
    return (
      <section className="op-executive-board op-executive-board--incompatible">
        <StatePanel
          state="incompatible"
          eyebrow="Executive board"
          title="Executive board cannot be trusted"
          description="The owner-issued executive board display did not pass exact binding and integrity verification."
        />
      </section>
    );
  }
  return <ExecutiveBoardSeats model={section} />;
}

export function CycleDetailPage({
  currentBinding,
  sources,
  reviewNavigation = null,
}: CycleDetailPageProps) {
  const model = resolveOperateCycleModel(sources, currentBinding);
  if (!model) {
    return (
      <div className="op-workspace op-cycle-detail pc-operate" data-route-kind="operate.cycle">
        <StatePanel
          state="incompatible"
          eyebrow="Cycle projection"
          title="Cycle cannot be trusted"
          description="The owner-issued workspace did not pass exact binding and integrity verification."
        />
      </div>
    );
  }
  const exactReviewNavigation =
    reviewNavigation && isOperateReviewNavigationForCycle(reviewNavigation, model.cycle.cycleId)
      ? reviewNavigation
      : null;

  return (
    <div
      className="op-workspace op-cycle-detail pc-operate"
      data-route-kind="operate.cycle"
      data-cycle-presentation={model.presentation}
      data-cycle-source={model.source}
    >
      <ul className="pc-metrics" aria-label="Cycle progress">
        <MetricStat label="terminal" value={model.progress.terminal} />
        <MetricStat label="total" value={model.progress.total} />
      </ul>
      <SectionHeader
        headingLevel={1}
        eyebrow={`planr-operate · ${model.vocabulary.title.toLowerCase()}`}
        title={model.cycle.focus[0] ?? model.vocabulary.title}
        description={`${humanLabel(model.cycle.state)} · ${humanLabel(model.cycle.health)}`}
        actions={
          <>
            <ActionStateBadge state={model.cycle.state} />
            <ActionStateBadge state={model.cycle.health} />
            {exactReviewNavigation ? (
              <a
                className="pc-row-link"
                data-review-navigation=""
                data-review-read-action-digest={exactReviewNavigation.readActionDigest}
                href={exactReviewNavigation.deepLink}
              >
                Open Review
              </a>
            ) : null}
          </>
        }
      />

      {model.source === 'durable-resume' ? (
        <p className="pc-operate__notice" data-tone="verified" role="status">
          Your saved cycle has been restored.
        </p>
      ) : null}
      {model.cycle.state === 'closed' ? (
        <p className="pc-operate__notice" role="status">
          This Cycle is closed. Persistent Decisions, Actions, Findings, Outcomes, and Learnings
          remain discoverable below.
        </p>
      ) : null}

      <OperatingSpine
        stages={model.stages}
        cycleId={model.cycle.cycleId}
        health={model.cycle.health}
        eyebrow="Observe through Learn"
        title={
          model.currentStage
            ? operatingStageLabel(model.currentStage.id)
            : humanLabel(model.cycle.state)
        }
        labelledBy="op-cycle-detail-spine-title"
      />

      <ExecutiveBoardSection
        model={model}
        currentBinding={currentBinding}
        executiveBoard={sources.current.executiveBoard}
      />

      <div className="op-cycle-detail__workspace">
        <div className="op-cycle-detail__primary">
          <StageLedger model={model} />
          <OwnershipLedger model={model} />
          <PersistentWork model={model} />
        </div>
        <ProofDesk model={model} />
      </div>
    </div>
  );
}
