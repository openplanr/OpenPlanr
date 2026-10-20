export function createAnnouncer(stage: HTMLElement) {
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  let message = '';
  return {
    say(value: string) {
      message = value;
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        element.textContent = message;
      }, 500);
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      element.remove();
    },
  };
}
