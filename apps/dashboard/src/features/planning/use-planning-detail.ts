import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { useEffect, useMemo, useState } from 'react';
import { createDashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { isCanonicalPlanningId } from '../../lib/routing/planning-view-codec.js';
import { fetchPlanningDetail, type PlanningDetailEnvelope } from './planning-api.js';
import { type PlanningModelNode, planningRouteSubjectId } from './planning-model.js';
import type { PlanningWorkspaceModel } from './planning-workspace.js';

type AcceptedDetail = { source: string; revision: string; envelope: PlanningDetailEnvelope };
const cache = new Map<string, AcceptedDetail>();

export function planningDetailIdentity(
  model: Pick<PlanningWorkspaceModel, 'binding' | 'envelope'>,
  node: PlanningModelNode,
) {
  // An inspector can read an exact graph identity that has no public detail route.
  const subjectId = isCanonicalPlanningId(node.id) ? planningRouteSubjectId(node) : null;
  return createDashboardQueryIdentity({
    ...model.binding,
    route: subjectId ? `#/detail/${encodeURIComponent(subjectId)}` : '#/list',
    subjectId,
    eventHead: model.envelope.cursor.eventHead,
    viewHash: model.envelope.cursor.viewHash,
  });
}

export function usePlanningDetail(
  model: PlanningWorkspaceModel,
  summary: PlanningModelNode | null,
  origin: string,
) {
  const { binding, envelope } = model;
  const identity = useMemo(
    () => (summary ? planningDetailIdentity({ binding, envelope }, summary) : null),
    [binding, envelope, summary],
  );
  const source = useMemo(
    () =>
      JSON.stringify([
        origin,
        model.envelope.binding,
        summary?.id,
        summary ? sha256Jcs(summary as never) : null,
      ]),
    [origin, model.envelope.binding, summary],
  );
  const revision = useMemo(() => JSON.stringify(model.envelope.cursor), [model.envelope.cursor]);
  const key = `${source}:${revision}`;
  const [accepted, setAccepted] = useState<AcceptedDetail | null>(() => cache.get(key) ?? null);
  const [failure, setFailure] = useState<{ key: string; reason: string } | null>(null);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!identity || !summary) return;
    if (attempt) setFailure(null);
    const cached = cache.get(key);
    if (cached) {
      setAccepted(cached);
      setFailure(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    fetchPlanningDetail({
      origin,
      identity,
      nodeId: summary.id,
      snapshot: model.envelope,
      signal: controller.signal,
    })
      .then((envelope) => {
        if (!active) return;
        const entry = { source, revision, envelope };
        cache.set(key, entry);
        if (cache.size > 100) cache.delete(cache.keys().next().value as string);
        setAccepted(entry);
        setFailure(null);
      })
      .catch(() => {
        if (active)
          setFailure({
            key,
            reason:
              'The artifact detail could not be verified. Retry the read or reconnect to the dashboard.',
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [origin, identity, model.envelope, key, source, revision, summary, attempt]);
  // A new revision can keep an unchanged, previously verified body while its read catches up.
  const visible = cache.get(key) ?? (accepted?.source === source ? accepted : null);
  return {
    node: visible?.envelope.node ?? null,
    identity,
    loading: Boolean(summary && visible?.revision !== revision && failure?.key !== key),
    error: failure?.key === key ? failure.reason : null,
    retry: () => retry((value) => value + 1),
  };
}
