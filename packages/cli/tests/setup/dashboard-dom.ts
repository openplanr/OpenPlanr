// jsdom lacks the layout observers the dashboard's floating chrome requires in every browser.
// These inert stand-ins report no matches and no resizes, the same outcome as feature detection.
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
    if (typeof scope.ResizeObserver !== 'function') {
      scope.ResizeObserver = class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      };
    }
  }
}
