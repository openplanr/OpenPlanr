import { useEffect, useRef, useState } from 'react';
import { Button, IconButton, PcIcon, Toast } from '../../design-system/components/index.js';
import { usePlanningCopy } from '../../lib/routing/planning-presentation.js';
import { fetchPlanningFileLink } from './planning-api.js';
import type { PlanningModelNode } from './planning-model.js';
import type { PlanningWorkspaceModel } from './planning-workspace.js';
import { planningDetailIdentity } from './use-planning-detail.js';

export function CopyDetailValue({
  value,
  label,
  compact = false,
}: {
  value: string;
  label: string;
  compact?: boolean;
}) {
  const copy = usePlanningCopy();
  const [state, setState] = useState<'idle' | 'pending' | 'copied' | 'denied'>('idle');
  const inFlight = useRef(false);
  const currentValue = useRef(value);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    currentValue.current = value;
    setState(inFlight.current ? 'pending' : 'idle');
  }, [value]);
  const activate = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState('pending');
    try {
      if (copy) await copy(value);
      else {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(value);
      }
      if (mounted.current) setState(currentValue.current === value ? 'copied' : 'idle');
    } catch {
      if (mounted.current) setState(currentValue.current === value ? 'denied' : 'idle');
    } finally {
      inFlight.current = false;
    }
  };
  return (
    <>
      {compact ? (
        <IconButton
          size="sm"
          icon={state === 'pending' ? 'loader-circle' : 'copy'}
          disabled={state === 'pending'}
          label={label}
          onClick={() => void activate()}
        />
      ) : (
        <Button
          size="sm"
          icon="copy"
          loading={state === 'pending'}
          ariaLabel={label}
          onClick={() => void activate()}
        >
          {label}
        </Button>
      )}
      {state === 'copied' || state === 'denied' ? (
        <div className="pc-detail__feedback">
          <Toast
            key={`${value}:${state}`}
            title={state === 'copied' ? 'Copied' : 'Copy was blocked'}
            kind={state === 'denied' ? 'error' : 'info'}
            onDismiss={() => setState('idle')}
          >
            {state === 'denied' ? <p>Select this text and copy it manually.</p> : null}
            <code>{value}</code>
          </Toast>
        </div>
      ) : null}
    </>
  );
}

export function DeclaredFile({
  path,
  model,
  node,
  origin,
  compact = false,
}: {
  path: string;
  model: PlanningWorkspaceModel;
  node: PlanningModelNode;
  origin: string;
  compact?: boolean;
}) {
  const key = JSON.stringify([
    origin,
    model.envelope.binding,
    model.envelope.cursor,
    node.id,
    path,
  ]);
  const [result, setResult] = useState<{
    key: string;
    url: string | null;
    reason: string | null;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const currentKey = useRef(key);
  const inFlight = useRef(false);
  useEffect(() => {
    currentKey.current = key;
    inFlight.current = false;
    setPending(false);
    return () => controller.current?.abort();
  }, [key]);
  const load = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const request = new AbortController();
    controller.current = request;
    setPending(true);
    setResult(null);
    try {
      const link = await fetchPlanningFileLink({
        origin,
        identity: planningDetailIdentity(model, node),
        nodeId: node.id,
        snapshot: model.envelope,
        path,
        signal: request.signal,
      });
      if (!request.signal.aborted && currentKey.current === key)
        setResult({ key, url: link.editorUrl, reason: link.reason });
    } catch {
      if (!request.signal.aborted && currentKey.current === key)
        setResult({
          key,
          url: null,
          reason: 'The editor link could not be verified. Retry or copy the path manually.',
        });
    } finally {
      if (!request.signal.aborted && currentKey.current === key) {
        inFlight.current = false;
        setPending(false);
      }
    }
  };
  const visible = result?.key === key ? result : null;
  return (
    <div
      className={`pc-detail__file-controls${compact ? ' pc-detail__file-controls--compact' : ''}`}
      data-active={pending || visible ? true : undefined}
    >
      <code title={compact ? path : undefined}>{path}</code>
      <div className="pc-detail__actions">
        <CopyDetailValue value={path} label="Copy path" compact={compact} />
        {compact ? (
          <IconButton
            size="sm"
            icon={pending ? 'loader-circle' : 'external-link'}
            label="Open in editor"
            disabled={pending}
            onClick={() => void load()}
          />
        ) : (
          <Button size="sm" loading={pending} onClick={() => void load()}>
            Open in editor
          </Button>
        )}
        {visible?.url ? (
          <a
            className={compact ? 'pc-detail__file-launch' : 'op-inline-action'}
            href={visible.url}
            aria-label={compact ? 'Launch editor' : undefined}
          >
            {compact ? <PcIcon name="external-link" size={13} /> : 'Launch editor'}
          </a>
        ) : null}
      </div>
      {!compact || pending || visible?.reason ? (
        <p
          className="pc-detail__file-hint"
          role={visible?.reason && !visible.url ? 'alert' : 'status'}
        >
          {pending
            ? 'Checking the declared file…'
            : (visible?.reason ??
              'If the editor is unavailable or permission is denied, copy the path and open it manually.')}
        </p>
      ) : null}
    </div>
  );
}
