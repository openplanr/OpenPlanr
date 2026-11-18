// jsdom lacks the layout observers the dashboard's floating chrome requires in every browser,
// and a 2D canvas context for the Graph's overview and minimap. These inert stand-ins report no
// matches, no resizes and draw nothing.
if (typeof window !== 'undefined') {
  const scopes = new Set<typeof globalThis>([globalThis, window]);
  for (const scope of scopes) {
    if (typeof scope.matchMedia !== 'function') {
      scope.matchMedia = (query: string) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        }) satisfies MediaQueryList;
    }
    const canvas = scope.HTMLCanvasElement?.prototype;
    if (canvas && scope.navigator?.userAgent.includes('jsdom')) {
      Object.defineProperty(canvas, 'getContext', {
        configurable: true,
        writable: true,
        value(this: HTMLCanvasElement) {
          const noop = () => undefined;
          return new Proxy({ canvas: this } as Record<string | symbol, unknown>, {
            get: (target, key) => (key in target ? target[key] : noop),
            set: (target, key, value) => {
              target[key] = value;
              return true;
            },
          });
        },
      });
    }
    if (typeof scope.ResizeObserver !== 'function') {
      scope.ResizeObserver = class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      };
    }
  }
}
