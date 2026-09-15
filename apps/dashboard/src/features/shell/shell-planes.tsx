import { Fragment } from 'react';
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
      : 'Reading the graph from .planr/. The route is already resolved.';
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

/** Boot is a transit frame with a phase readout. The phase decides what boot resolves into. */
export function BootScreen({ route, phase, detail }: BootScreenProps) {
  const failed = phase === 'incompatible' || phase === 'unavailable';
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
                <InlineAlert
                  tone={phase === 'incompatible' ? 'danger' : 'warn'}
                  title={
                    phase === 'incompatible'
                      ? 'This build cannot read the graph on disk'
                      : 'No graph at this path'
                  }
                >
                  {detail ??
                    (phase === 'incompatible'
                      ? 'The .planr/ schema on disk is a version this dashboard does not read. Nothing was opened, and nothing on disk was touched.'
                      : 'The dashboard started, but there is no .planr/ directory to read. Planning fills in as soon as one exists.')}
                </InlineAlert>
                <CommandHint
                  command={phase === 'incompatible' ? '/planr-doctor' : '/planr-plan'}
                  label={phase === 'incompatible' ? 'check the schema version' : 'create the graph'}
                  size="sm"
                />
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

export type PlaneBannerProps = Readonly<{ state: 'stale' | 'offline'; reason: string }>;

/** Stale and offline keep the last read on screen and say so above it. */
export function PlaneBanner({ state, reason }: PlaneBannerProps) {
  if (state === 'stale') {
    return (
      <div className="pc-plane-banner">
        <InlineAlert tone="warn" title="Showing the last good read">
          {reason}
        </InlineAlert>
      </div>
    );
  }
  return (
    <div className="pc-plane-banner">
      <InlineAlert tone="danger" title="Offline — the watcher is not reachable">
        {reason}
      </InlineAlert>
      <CommandHint command="/planr-dashboard" label="restart the local reader" size="sm" />
    </div>
  );
}

/** Heads the diagnostics plane when the served build cannot read the graph on disk. */
export function IncompatibleNotice({ detail }: Readonly<{ detail: string | null }>) {
  return (
    <div className="pc-incompatible">
      <InlineAlert tone="danger" title="This build cannot read the graph on disk">
        {detail ??
          'The .planr/ schema is a version the dashboard does not understand. It stopped rather than render a partial or wrong reading of the plan.'}
      </InlineAlert>
      <CommandHint command="/planr-doctor" label="report the schema version on disk" size="sm" />
      <InlineAlert tone="info" title="Nothing was changed">
        The dashboard only ever reads. No file was migrated, rewritten or removed.
      </InlineAlert>
    </div>
  );
}
