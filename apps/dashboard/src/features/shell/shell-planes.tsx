import { Fragment, useState } from 'react';
import { dashboardRouteDefinition, type ParsedDashboardRoute } from '../../app/router.js';
import {
  Card,
  CommandHint,
  InlineAlert,
  PcIcon,
  SectionHeader,
  Skeleton,
  SkeletonCards,
  type SkeletonColumn,
  SkeletonTable,
} from '../../design-system/components/index.js';
import './console-shell.css';
import { PLANNING_FOLDER } from '@openplanr/protocol/names';

/** Below this the inspector floats over the plane instead of taking layout width. */
export const INSPECTOR_DOCK_WIDTH = 1180;

type TransitShape = 'overview' | 'table' | 'graph' | 'board' | 'cards' | 'detail';
type RouteShape = Readonly<{
  eyebrow: string;
  shape: TransitShape;
  columns?: readonly SkeletonColumn[];
}>;

/* Transit keeps the route recognisable: the real header, a skeleton body in the shape the
   route will have. Never a blank plane, never a spinner alone. */
const ROUTE_SHAPES: Readonly<Record<string, RouteShape>> = Object.freeze({
  'planning.overview': { eyebrow: 'planr-status', shape: 'overview' },
  'planning.list': {
    eyebrow: 'planr-plan',
    shape: 'table',
    columns: [
      { label: 'Item' },
      { label: 'Status', width: 132 },
      { label: 'Sprint', width: 88 },
      { label: 'Deps', width: 56 },
      { label: 'Updated', width: 88 },
      { label: 'Ref', width: 96 },
    ],
  },
  'planning.graph': { eyebrow: 'planr-diagram', shape: 'graph' },
  'planning.board': { eyebrow: 'planr-status', shape: 'board' },
  'planning.sprints': { eyebrow: 'planr-status', shape: 'cards' },
  'planning.activity': { eyebrow: 'planr-status', shape: 'cards' },
  'planning.search': {
    eyebrow: 'planr-status',
    shape: 'table',
    columns: [{ label: 'Result' }, { label: 'Kind', width: 120 }],
  },
  'planning.console': {
    eyebrow: 'planr-dashboard',
    shape: 'table',
    columns: [
      { label: 'Skill', width: 190 },
      { label: 'Purpose' },
      { label: 'Invocation', width: 268 },
    ],
  },
  'planning.detail': { eyebrow: 'planr-plan', shape: 'detail' },
  'planning.spec': { eyebrow: 'planr-spec', shape: 'detail' },
  'system.diagnostics': {
    eyebrow: 'planr-doctor',
    shape: 'table',
    columns: [{ label: 'Check' }, { label: 'Detail' }, { label: 'Result', width: 140 }],
  },
});
const OPERATE_SHAPE: RouteShape = Object.freeze({ eyebrow: 'planr-operate', shape: 'cards' });
const BOARD_PLACEHOLDERS = Object.freeze(['a', 'b', 'c', 'd', 'e']);

function shapeFor(route: ParsedDashboardRoute): RouteShape {
  if (route.kind !== 'not-found' && route.kind in ROUTE_SHAPES) return ROUTE_SHAPES[route.kind];
  return route.product === 'operate' ? OPERATE_SHAPE : ROUTE_SHAPES['planning.overview'];
}

export type TransitScreenProps = Readonly<{ route: ParsedDashboardRoute; note: string }>;

export function TransitScreen({ route, note }: TransitScreenProps) {
  const definition = dashboardRouteDefinition(route);
  const shape = shapeFor(route);
  const title = route.subjectId ?? definition?.label ?? 'Workspace';
  const description =
    route.product === 'operate'
      ? 'Reading the Operate projection. The route is already resolved.'
      : `Reading ${PLANNING_FOLDER}/. Planning files appear here after the read is validated.`;
  return (
    <div className="pc-transit" aria-busy="true">
      <SectionHeader eyebrow={shape.eyebrow} title={title} count={note} description={description} />
      {shape.shape === 'overview' ? (
        <>
          <Card padding={14}>
            <Skeleton h={44} />
          </Card>
          <div className="pc-transit__gap">
            <SkeletonTable
              rows={4}
              label="Loading blocked"
              columns={[
                { label: 'Item' },
                { label: 'Depends on', width: 200 },
                { label: 'Sprint', width: 92 },
                { label: 'Updated', width: 88 },
              ]}
            />
          </div>
        </>
      ) : shape.shape === 'graph' ? (
        <Card padding={14}>
          <Skeleton h={420} />
        </Card>
      ) : shape.shape === 'board' ? (
        <div className="pc-transit__board">
          {BOARD_PLACEHOLDERS.map((key, index) => (
            <Card key={key} padding={10}>
              <Skeleton w="52%" h={12} delay={index * 60} />
              <div className="pc-transit__gap-sm">
                <Skeleton h={54} delay={index * 60 + 40} />
              </div>
              <div className="pc-transit__gap-sm">
                <Skeleton h={54} delay={index * 60 + 80} />
              </div>
            </Card>
          ))}
        </div>
      ) : shape.shape === 'cards' ? (
        <SkeletonCards count={4} label={`Loading ${title}`} />
      ) : shape.shape === 'detail' ? (
        <SkeletonCards count={1} height={168} min={520} label="Loading artifact" />
      ) : (
        <SkeletonTable rows={8} columns={shape.columns ?? []} label={`Loading ${title}`} />
      )}
    </div>
  );
}

export type BootScreenProps = Readonly<{
  route: ParsedDashboardRoute;
  phase: 'checking' | 'compatible' | 'incompatible' | 'unavailable';
  detail: string | null;
}>;

const BOOT_FAILURES = {
  incompatible: {
    tone: 'danger',
    title: 'Dashboard installation is incompatible',
    description:
      'The UI, server, or packaged assets do not satisfy the same build contract. Open diagnostics to inspect the compatibility result.',
    command: '/planr:doctor',
    commandLabel: 'check the installation',
  },
  unavailable: {
    tone: 'warn',
    title: 'The dashboard connection could not be verified',
    description:
      'No validated bootstrap response is available. Check the local dashboard process and connection, then reload this tab.',
    command: 'openplanr dashboard',
    commandLabel: 'start the local dashboard from the project folder',
  },
} as const;

/** Boot is a transit frame with a phase readout. The phase decides what boot resolves into. */
export function BootScreen({ route, phase, detail }: BootScreenProps) {
  const failed = phase === 'incompatible' || phase === 'unavailable';
  const failure = phase === 'incompatible' ? BOOT_FAILURES.incompatible : BOOT_FAILURES.unavailable;
  const steps = ['checking', failed ? phase : 'compatible'];
  return (
    <div className="pc-boot">
      <div className="pc-boot__strip" role="status" aria-live="polite">
        <PcIcon
          name={failed ? 'octagon-alert' : 'loader-circle'}
          size={13}
          spin={!failed}
          color={failed ? 'var(--pc-astate-failed-fg)' : 'var(--pc-astate-proposed-fg)'}
        />
        <span>boot</span>
        <span className="pc-boot__steps">
          {steps.map((step, index) => (
            <Fragment key={step}>
              {index > 0 ? (
                <PcIcon name="chevron-right" size={11} color="var(--pc-text-tertiary)" />
              ) : null}
              <span className="pc-boot__phase" data-current={step === phase || undefined}>
                {step}
              </span>
            </Fragment>
          ))}
        </span>
      </div>
      <div className="pc-boot__body">
        {failed ? (
          <div className="pc-boot__card">
            <Card padding={14}>
              <div className="pc-boot__stack">
                <InlineAlert tone={failure.tone} title={failure.title}>
                  {detail ?? failure.description}
                </InlineAlert>
                <CommandHint command={failure.command} label={failure.commandLabel} size="sm" />
              </div>
            </Card>
          </div>
        ) : (
          <div className="pc-shell__scroll">
            <TransitScreen route={route} note="booting" />
          </div>
        )}
      </div>
    </div>
  );
}

export type PlaneBannerProps = Readonly<{
  state: 'stale' | 'offline';
  reason: string;
  projectionKind?: string;
  errorCode?: string | null;
  lastSnapshotAt?: number | null;
  attempt?: number;
  onRetry?: () => Promise<unknown>;
}>;

function recoveryCopy({ state, projectionKind, errorCode }: PlaneBannerProps) {
  if (projectionKind === 'corrupt' || errorCode === 'DASHBOARD_RESPONSE_INVALID') {
    return {
      kind: 'invalid-response',
      tone: 'danger',
      title: 'The latest dashboard response could not be validated',
      instruction:
        'The rejected response was not applied. Read again before resuming live updates.',
    } as const;
  }
  if (errorCode === 'DASHBOARD_READ_FAILED') {
    return {
      kind: 'read-failed',
      tone: 'danger',
      title: 'The dashboard read failed',
      instruction: 'Check that the local server is running and reachable, then retry the read.',
    } as const;
  }
  return {
    kind: state,
    tone: 'warn',
    title:
      state === 'offline' ? 'The file watcher disconnected' : 'Checking for missed file updates',
    instruction: 'Live updates resume after the connection and current snapshot are validated.',
  } as const;
}

function SnapshotTime({ at }: Readonly<{ at?: number | null }>) {
  const timestamp = typeof at === 'number' && Number.isFinite(at) ? new Date(at) : null;
  if (!timestamp || !Number.isFinite(timestamp.getTime())) {
    return <span>Live freshness cannot be confirmed.</span>;
  }
  return (
    <span>
      Showing the last validated snapshot from{' '}
      <time dateTime={timestamp.toISOString()}>
        {timestamp.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      </time>
      .
    </span>
  );
}

/** Stale and offline keep the last read on screen and say so above it. */
export function PlaneBanner(props: PlaneBannerProps) {
  const { reason, lastSnapshotAt, attempt, onRetry } = props;
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const copy = recoveryCopy(props);
  const reconnecting = copy.kind === 'stale' || copy.kind === 'offline';
  const retry = async () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    setRetryFailed(false);
    try {
      await onRetry();
    } catch {
      setRetryFailed(true);
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div
      className="pc-plane-banner"
      data-recovery-state={copy.kind}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <InlineAlert tone={copy.tone} title={copy.title}>
        <span>{reason}</span> <SnapshotTime at={lastSnapshotAt} /> <span>{copy.instruction}</span>
        {reconnecting && Number.isSafeInteger(attempt) && (attempt ?? 0) > 0
          ? ` Reconnecting, attempt ${attempt}.`
          : ''}
      </InlineAlert>
      {copy.kind === 'read-failed' ? (
        <CommandHint
          command="openplanr dashboard"
          label="if the server stopped, start it from the project folder"
          size="sm"
        />
      ) : null}
      {onRetry ? (
        <button
          className="op-inline-action"
          type="button"
          disabled={retrying}
          aria-busy={retrying || undefined}
          onClick={() => void retry()}
        >
          {retrying ? 'Reading again' : 'Retry read'}
        </button>
      ) : null}
      {retryFailed ? <p>Another read failed. Current data has not been refreshed.</p> : null}
    </div>
  );
}

/** Heads the diagnostics plane when installation compatibility is refused. */
export function IncompatibleNotice({ detail }: Readonly<{ detail: string | null }>) {
  return (
    <div className="pc-incompatible">
      <InlineAlert tone="danger" title={BOOT_FAILURES.incompatible.title}>
        {detail ?? BOOT_FAILURES.incompatible.description}
      </InlineAlert>
      <CommandHint command="/planr:doctor" label="check the installation" size="sm" />
      <InlineAlert tone="info" title="Nothing was changed">
        Plan views are read-only. No planning file was migrated, rewritten or removed.
      </InlineAlert>
    </div>
  );
}
