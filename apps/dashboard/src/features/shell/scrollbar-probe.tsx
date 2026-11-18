import { useLayoutEffect, useRef } from 'react';

/**
 * Publishes the platform's classic scrollbar width as `--pc-scrollbar-width` on the parent.
 * Overlay scrollbars measure 0.
 */
export function ScrollbarProbe() {
  const probe = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = probe.current;
    const host = element?.parentElement;
    if (!element || !host) return;
    const measure = () => {
      const width = Math.max(0, element.offsetWidth - element.clientWidth);
      host.style.setProperty('--pc-scrollbar-width', `${width}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    // Zoom changes the device pixel ratio and a scrollbar's CSS width without resizing the probe.
    let resolution: MediaQueryList | null = null;
    const watchResolution = () => {
      resolution?.removeEventListener('change', onResolution);
      resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      resolution.addEventListener('change', onResolution);
    };
    const onResolution = () => {
      measure();
      watchResolution();
    };
    watchResolution();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      resolution?.removeEventListener('change', onResolution);
      host.style.removeProperty('--pc-scrollbar-width');
    };
  }, []);
  return <div ref={probe} className="pc-shell__scrollbar-probe" aria-hidden="true" />;
}
