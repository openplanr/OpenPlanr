export function createAnnouncer(stage: HTMLElement) {
  const view = stage.ownerDocument.defaultView;
  if (!view) throw new Error('Canvas announcer: the stage document has no window');
  const element = stage.ownerDocument.createElement('div');
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.setAttribute('aria-atomic', 'true');
  Object.assign(element.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
    border: '0',
  });
  stage.append(element);
  let timer: number | undefined;
  let repeat: number | undefined;
  let message = '';
  return {
    say(value: string) {
      message = value;
      if (timer !== undefined) return;
      timer = view.setTimeout(() => {
        timer = undefined;
        if (element.textContent !== message) {
          element.textContent = message;
          return;
        }
        // Screen readers skip an unchanged live region, so a repeat is cleared and rewritten.
        element.textContent = '';
        const text = message;
        repeat = view.setTimeout(() => {
          repeat = undefined;
          element.textContent = text;
        }, 0);
      }, 500);
    },
    dispose() {
      if (timer !== undefined) view.clearTimeout(timer);
      if (repeat !== undefined) view.clearTimeout(repeat);
      element.remove();
    },
  };
}
