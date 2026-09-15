import { useEffect, useState } from 'react';
import { useDashboard } from '../../app/providers.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { createDashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { fetchPlanningOperatingTrace } from '../operate/planning/planning-actions.js';
import { OperatingOriginPanel } from './OperatingOriginPanel.js';

export type PlanningOperatingOriginSectionProps = Readonly<{
  specId: string;
  binding: DashboardQueryIdentity;
}>;

/** Fetch and render access-safe operating origin for one SPEC detail route. */
export function PlanningOperatingOriginSection({
  specId,
  binding,
}: PlanningOperatingOriginSectionProps) {
  const { bootstrap } = useDashboard();
  const sourceRoot = bootstrap?.queryRoots.operate ?? null;
  const [envelope, setEnvelope] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      sourceRoot === null ||
      sourceRoot.projectId !== binding.projectId
    ) {
      setEnvelope(null);
      setStatus('unavailable');
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    setStatus('loading');
    const sourceIdentity = createDashboardQueryIdentity({
      productArea: 'operate',
      route: '#/operate/today',
      actorId: sourceRoot.actorId,
      projectId: sourceRoot.projectId,
      scopeId: sourceRoot.scopeId,
      domainId: sourceRoot.domainId,
      domainVersion: sourceRoot.domainVersion,
      cycleId: null,
      subjectId: null,
      eventHead: null,
      viewHash: null,
      generation: sourceRoot.generation,
    });
    fetchPlanningOperatingTrace({
      origin: window.location.origin,
      identity: sourceIdentity,
      specId,
      signal: controller.signal,
    })
      .then((creation) => {
        if (cancelled) return;
        const origin = creation.origin as Record<string, unknown>;
        const spec = origin.spec as { specId?: string } | undefined;
        if (
          spec?.specId === specId &&
          origin.scopeId === sourceRoot.scopeId &&
          origin.domainId === sourceRoot.domainId &&
          origin.domainVersion === sourceRoot.domainVersion &&
          recordActorId(origin.actor) === sourceRoot.actorId
        ) {
          setEnvelope({
            origin: creation.origin,
            progress: creation.progress,
          });
          setStatus('ready');
          return;
        }
        setStatus('unavailable');
      })
      .catch(() => {
        if (!cancelled) setStatus('unavailable');
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [binding.projectId, sourceRoot, specId]);

  if (status === 'loading' || status === 'idle') {
    return (
      <section className="op-planning-section" aria-label="Operating origin loading">
        <p role="status">Loading operating origin projection…</p>
      </section>
    );
  }
  if (!envelope) return null;
  return <OperatingOriginPanel envelope={envelope} />;
}

function recordActorId(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const actorId = Reflect.get(value, 'actorId');
  return typeof actorId === 'string' ? actorId : null;
}
