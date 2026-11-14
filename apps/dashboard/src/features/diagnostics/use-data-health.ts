import { useEffect, useMemo, useState } from 'react';
import { fetchPlanningDiagnostics } from '../planning/planning-api.js';
import type { PlanningWorkspaceModel } from '../planning/planning-workspace.js';
import type { DataHealthRead } from './DataHealth.js';

type AcceptedRead = { source: string; revision: string; read: DataHealthRead };

export function useDataHealth(
  model: PlanningWorkspaceModel | null,
  origin: string | null,
  enabled: boolean,
) {
  const identity = model?.binding ?? null;
  const snapshot = model?.envelope ?? null;
  const source = useMemo(
    () => JSON.stringify([origin, snapshot?.binding]),
    [origin, snapshot?.binding],
  );
  const revision = JSON.stringify(snapshot?.cursor);
  const key = `${source}:${revision}`;
  const [accepted, setAccepted] = useState<AcceptedRead | null>(null);
  const [failure, setFailure] = useState<{ key: string; reason: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a retry starts a new read for the same revision.
  useEffect(() => {
    if (!enabled || !origin || !identity || !snapshot) return;
    const controller = new AbortController();
    let active = true;
    setPending(key);
    setFailure(null);
    fetchPlanningDiagnostics({ origin, identity, snapshot, signal: controller.signal })
      .then((read) => {
        if (!active) return;
        const next = { source, revision, read };
        setAccepted((current) =>
          read.state !== 'available' &&
          current?.source === source &&
          current.read.state === 'available'
            ? current
            : next,
        );
        if (read.state !== 'available')
          setFailure({
            key,
            reason: `${read.reason ?? 'Source diagnostics are unavailable.'}${read.errorCode ? ` (${read.errorCode})` : ''}`,
          });
      })
      .catch(() => {
        if (active)
          setFailure({
            key,
            reason:
              'The source diagnostics could not be verified. Retry the read or reconnect to the dashboard.',
          });
      })
      .finally(() => {
        if (active) setPending(null);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, origin, identity, snapshot, source, revision, key, attempt]);
  const visible = accepted?.source === source ? accepted : null;
  const error = failure?.key === key ? failure.reason : null;
  const loading = Boolean(
    enabled && origin && snapshot && !error && (pending === key || visible?.revision !== revision),
  );
  return {
    read: visible?.read ?? null,
    loading,
    error,
    stale: Boolean(
      visible &&
        (visible.revision !== revision ||
          error ||
          model?.presentation === 'offline' ||
          model?.presentation === 'stale'),
    ),
    retry: () => setAttempt((value) => value + 1),
  };
}
