/** Bind cancellation only; the mounting shell remains the sole gesture owner. */
export function bindDiagramEditorCancellation(session, target) {
  if (!target?.addEventListener || !target?.removeEventListener)
    throw new TypeError('Expected an event target.');
  const cancel = (event) => {
    if (event.type !== 'keydown' || event.key === 'Escape')
      session.cancelGesture(event.type === 'keydown' ? 'escape' : event.type);
  };
  const events = ['keydown', 'pointercancel', 'lostpointercapture', 'blur'];
  for (const event of events) target.addEventListener(event, cancel, true);
  return () => {
    for (const event of events) target.removeEventListener(event, cancel, true);
  };
}
