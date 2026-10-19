import { useEffect, useState } from 'react';
import { useDashboard } from '../../app/providers.js';
import { Button, Card, InlineAlert } from '../../design-system/components/index.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { createDashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { fetchPlanningOperatingTrace } from '../operate/planning/planning-actions.js';
import { OperatingOriginPanel } from './OperatingOriginPanel.js';
import type { PlanningModelNode } from './planning-model.js';

export type PlanningOperatingOriginSectionProps = Readonly<{
  specId: string;
  binding: DashboardQueryIdentity;
  node?: PlanningModelNode | null;
}>;

function declaresOperatingOrigin(
  node: PlanningModelNode | null | undefined,
  specId: string,
): boolean {
  if (node?.type !== 'spec' || node.id !== specId || !node.body) return false;
  const section = node.body
    .split(/(?=^##\s)/mu)
    .find((part) => /^## Operating origin[ \t]*\r?\n/u.test(part));
  return Boolean(
    section?.includes('`operating-origin.json`') &&
      /\]\(#\/operate\/actions\/[A-Za-z0-9._:-]+\/planning\)/u.test(section),
  );
}

type OriginRead = Readonly<{
  key: string;
  status: 'loading' | 'ready' | 'unavailable';
  envelope: Record<string, unknown> | null;
  reason?: string;
}>;

/** Read one access-safe origin; obsolete identity results never cross into the current view. */
export function PlanningOperatingOriginSection({
  specId,
  binding,
  node,
}: PlanningOperatingOriginSectionProps) {
  const { bootstrap } = useDashboard();
  const sourceRoot = bootstrap?.queryRoots.operate ?? null;
  const [attempt, setAttempt] = useState(0);
  const declared = declaresOperatingOrigin(node, specId);
  const key = JSON.stringify([
    attempt,
    specId,
    declared,
    binding.projectId,
    sourceRoot?.actorId,
    sourceRoot?.projectId,
    sourceRoot?.scopeId,
    sourceRoot?.domainId,
    sourceRoot?.domainVersion,
    sourceRoot?.generation,
  ]);
  const [read, setRead] = useState<OriginRead>({ key, status: 'loading', envelope: null });
  const unavailableReason = !sourceRoot
    ? 'Operate is unavailable for this project. No operating origin can be read.'
    : sourceRoot.projectId !== binding.projectId
      ? 'The Operate source does not belong to the current Planning project.'
      : !declared
        ? 'No operating origin is declared in the verified Spec.'
        : typeof window === 'undefined'
          ? 'Operating origin is available when this project is opened in the dashboard.'
          : null;

  useEffect(() => {
    setRead({ key, status: 'loading', envelope: null });
    if (unavailableReason || !sourceRoot) {
      setRead({
        key,
        status: 'unavailable',
        envelope: null,
        reason: unavailableReason ?? 'Operate is unavailable.',
      });
      return undefined;
    }
    const controller = new AbortController();
    let cancelled = false;
    const load = async () => {
      try {
        const sourceIdentity = createDashboardQueryIdentity({
          productArea: 'operate',
          route: '#/operate/today',
          ...sourceRoot,
          cycleId: null,
          subjectId: null,
          eventHead: null,
          viewHash: null,
        });
        const creation = await fetchPlanningOperatingTrace({
          origin: window.location.origin,
          identity: sourceIdentity,
          specId,
          signal: controller.signal,
        });
        if (cancelled) return;
        const origin = creation.origin as Record<string, unknown>;
        const spec = origin.spec as { specId?: string } | undefined;
        if (
          spec?.specId !== specId ||
          origin.scopeId !== sourceRoot.scopeId ||
          origin.domainId !== sourceRoot.domainId ||
          origin.domainVersion !== sourceRoot.domainVersion ||
          recordActorId(origin.actor) !== sourceRoot.actorId
        ) {
          setRead({
            key,
            status: 'unavailable',
            envelope: null,
            reason: 'The operating origin could not be verified for the current Spec and source.',
          });
          return;
        }
        setRead({
          key,
          status: 'ready',
          envelope: { origin: creation.origin, progress: creation.progress },
        });
      } catch {
        if (!cancelled)
          setRead({
            key,
            status: 'unavailable',
            envelope: null,
            reason: 'The access-safe operating origin read failed or could not be verified.',
          });
      }
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // The key commits every source-root field; object identity alone does not identify this read.
  }, [key, unavailableReason, sourceRoot, specId]);

  const current = read.key === key ? read : null;
  const reason = unavailableReason ?? current?.reason;
  if (!unavailableReason && current?.status === 'ready' && current.envelope) {
    return <OperatingOriginPanel envelope={current.envelope} />;
  }
  const retry = () => {
    setRead({ key, status: 'loading', envelope: null });
    setAttempt((value) => value + 1);
  };
  return (
    <section aria-label="Operating origin" aria-busy={!reason} style={{ minHeight: 132 }}>
      <Card title="Operating origin">
        {reason ? (
          <InlineAlert
            tone="info"
            title="Operating origin unavailable"
            actions={
              !unavailableReason ? (
                <Button size="sm" onClick={retry}>
                  Retry operating origin
                </Button>
              ) : undefined
            }
          >
            {reason}
          </InlineAlert>
        ) : (
          <p role="status">Loading operating origin projection…</p>
        )}
      </Card>
    </section>
  );
}

function recordActorId(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const actorId = Reflect.get(value, 'actorId');
  return typeof actorId === 'string' ? actorId : null;
}
