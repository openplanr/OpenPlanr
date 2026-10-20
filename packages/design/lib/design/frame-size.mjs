import { initialFrameHeight } from '@openplanr/protocol/design-contracts';

export { initialFrameHeight };

/** Numeric viewport before a content-sized screen has been measured. */
export function designFrameViewport(document, frame) {
  return {
    width: frame.width,
    height: frame.height === 'auto' ? initialFrameHeight(document) : frame.height,
  };
}

/** Match captured geometry without treating an authored auto height as pixels. */
export function matchesDesignFrame(frame, viewport) {
  return Boolean(
    frame &&
      viewport?.width === frame.width &&
      (frame.height === 'auto'
        ? Number.isInteger(viewport.height) && viewport.height > 0 && viewport.height <= 16384
        : viewport.height === frame.height),
  );
}

/** Runs inside the sandbox; parent checks the exact source window and declared screen. */
export function observeDesignFrameSize() {
  let pending = false;
  const measure = async () => {
    if (pending) return;
    pending = true;
    try {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      parent.postMessage(
        {
          type: 'openplanr:design-size',
          screenId: document.body.getAttribute('data-planr-screen'),
          width: innerWidth,
          height: Math.min(16384, Math.max(1, document.documentElement.scrollHeight)),
        },
        '*',
      );
    } finally {
      pending = false;
    }
  };
  const schedule = () => {
    void measure().catch((error) => {
      parent.postMessage({ type: 'openplanr:design-size-error', message: error.message }, '*');
    });
  };
  addEventListener('message', (event) => {
    if (event.source === parent && event.data?.type === 'openplanr:design-measure') schedule();
  });
  addEventListener(
    'load',
    () => {
      new ResizeObserver(schedule).observe(document.body);
      schedule();
    },
    { once: true },
  );
}
