import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useCopyFeedback(
  command: string,
  disabled = false,
  onCopy?: (text: string) => Promise<void>,
) {
  const [state, setState] = useState<'idle' | 'pending' | 'copied' | 'blocked'>('idle');
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const revision = useRef(0);
  const currentCommand = useRef<string | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (currentCommand.current === command) return;
    currentCommand.current = command;
    revision.current += 1;
    setState(inFlight.current ? 'pending' : 'idle');
    setError('');
  }, [command]);
  useEffect(() => {
    if (state !== 'copied' && state !== 'blocked') return;
    const timer = setTimeout(() => {
      setState('idle');
      setError('');
    }, 2000);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = useCallback(async () => {
    if (disabled || !command.trim() || inFlight.current) return;
    inFlight.current = true;
    const current = revision.current;
    setState('pending');
    setError('');
    try {
      if (onCopy) await onCopy(command);
      else {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(command);
      }
      if (mounted.current) setState(current === revision.current ? 'copied' : 'idle');
    } catch (cause) {
      if (mounted.current && current !== revision.current) setState('idle');
      else if (mounted.current) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        setError(`Could not copy "${command}": ${reason}`);
        setState('blocked');
      }
    } finally {
      inFlight.current = false;
    }
  }, [command, disabled, onCopy]);
  const message = state === 'copied' ? 'Copied' : state === 'blocked' ? 'Copy failed' : '';
  return { state, message, error, copy, reset: () => setState('idle') };
}
