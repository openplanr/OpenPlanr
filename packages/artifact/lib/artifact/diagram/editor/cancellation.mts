import type { DiagramEditorSession } from './session.mjs';

type CancellationListener = (event: { type: string; key?: string }) => void;

/** Bind cancellation only; the mounting shell remains the sole gesture owner. */
export function bindDiagramEditorCancellation(
  session: Pick<DiagramEditorSession, 'cancelGesture'>,
  target: {
    addEventListener(type: string, listener: CancellationListener, capture: boolean): void;
    removeEventListener(type: string, listener: CancellationListener, capture: boolean): void;
  },
): () => void {
  if (!target?.addEventListener || !target?.removeEventListener)
    throw new TypeError('Expected an event target.');
  const cancel: CancellationListener = (event) => {
    if (event.type !== 'keydown' || event.key === 'Escape')
      session.cancelGesture(event.type === 'keydown' ? 'escape' : event.type);
  };
  const events = ['keydown', 'pointercancel', 'lostpointercapture', 'blur'];
  for (const event of events) target.addEventListener(event, cancel, true);
  return () => {
    for (const event of events) target.removeEventListener(event, cancel, true);
  };
}
