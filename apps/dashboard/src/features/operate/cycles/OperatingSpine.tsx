/* biome-ignore-all lint/suspicious/noArrayIndexKey: owner stage order and duplicate identities remain byte-for-byte visible. */
import type { OperateExperienceCycleStageV1 } from '../../../contracts/operate.js';

export type OperatingSpineProps = Readonly<{
  stages: readonly OperateExperienceCycleStageV1[];
  cycleId: string;
  health: string;
  eyebrow?: string;
  title?: string;
  labelledBy?: string;
}>;

export function operatingStageLabel(stageId: OperateExperienceCycleStageV1['id']): string {
  return stageId.charAt(0).toUpperCase() + stageId.slice(1);
}

function healthLabel(health: string): string {
  if (health === 'normal') return 'On track';
  const words = health.replaceAll('-', ' ').replaceAll('_', ' ').trim();
  return words === '' ? health : `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

function stageStateLabel(state: string): string {
  const words = state.replaceAll('-', ' ').replaceAll('_', ' ').trim();
  return words === '' ? state : `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

/**
 * Pure presentation of an already verified owner-issued lifecycle. The verifier
 * owns schema, order, lifecycle, privacy, and digest custody before this
 * component can receive the array; this component never repairs or reclassifies it.
 */
export function OperatingSpine({
  stages,
  health,
  eyebrow = 'Active lifecycle',
  title,
  labelledBy = 'op-operating-spine-title',
}: OperatingSpineProps) {
  const current = stages.find((stage) => stage.state === 'current');
  return (
    <section className="op-cycle-spine" aria-labelledby={labelledBy}>
      <div className="op-cycle-spine__heading">
        <div>
          <p className="op-eyebrow">{eyebrow}</p>
          <h2 id={labelledBy}>
            {title ?? (current ? operatingStageLabel(current.id) : healthLabel(health))}
          </h2>
        </div>
        <p>{healthLabel(health)}</p>
      </div>
      <ol aria-label="Observe through Learn operating spine">
        {stages.map((stage, index) => (
          <li
            key={`${stage.id}:${index}`}
            data-projection-state={stage.state}
            aria-current={stage.state === 'current' ? 'step' : undefined}
          >
            <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <strong>{operatingStageLabel(stage.id)}</strong>
            <small>{stage.reason ?? stageStateLabel(stage.state)}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}
