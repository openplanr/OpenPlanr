import {
  Cable,
  CircleDotDashed,
  CircleOff,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { Skeleton } from './console-core.js';

export type StatePanelState =
  | 'booting'
  | 'first-use'
  | 'ready-to-resume'
  | 'unavailable'
  | 'incompatible'
  | 'offline'
  | 'empty'
  | 'error';

const ICONS = {
  booting: CircleDotDashed,
  'first-use': Cable,
  'ready-to-resume': ShieldCheck,
  unavailable: CircleOff,
  incompatible: TriangleAlert,
  offline: RotateCcw,
  empty: Cable,
  error: TriangleAlert,
} satisfies Record<StatePanelState, typeof CircleDotDashed>;

export type StatePanelProps = Readonly<{
  state: StatePanelState;
  eyebrow: string;
  title: string;
  description: string;
  detail?: string;
  actions?: ReactNode;
  headingId?: string;
}>;

/** Honest empty/degraded state presentation. State and reasons always come from its caller. */
export function StatePanel({
  state,
  eyebrow,
  title,
  description,
  detail,
  actions,
  headingId,
}: StatePanelProps) {
  const Icon = ICONS[state];
  const urgent = state === 'offline' || state === 'incompatible' || state === 'error';
  const generatedHeadingId = useId();
  const resolvedHeadingId = headingId ?? `dashboard-state-panel-${generatedHeadingId}`;

  return (
    <section
      className="op-state-panel"
      data-state={state}
      aria-labelledby={resolvedHeadingId}
      role={urgent ? 'alert' : 'status'}
      aria-busy={state === 'booting' || undefined}
      aria-live={urgent ? 'assertive' : 'polite'}
    >
      <span className="op-state-panel__signal" aria-hidden="true" />
      <div className="op-state-panel__body">
        <p className="op-eyebrow">{eyebrow}</p>
        <div className="op-state-panel__heading">
          <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
          <h2 id={resolvedHeadingId}>{title}</h2>
        </div>
        <p>{description}</p>
        {state === 'booting' ? (
          <div className="op-state-panel__skeleton" aria-hidden="true">
            <Skeleton w="80%" h={16} />
            <Skeleton w="60%" h={16} />
            <Skeleton h={16} />
          </div>
        ) : null}
        {detail ? <p className="op-state-panel__detail">{detail}</p> : null}
      </div>
      {actions ? <div className="op-state-panel__actions">{actions}</div> : null}
    </section>
  );
}
