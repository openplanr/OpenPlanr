export type DashboardLayoutShiftRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}>;

export type DashboardLayoutShiftSource = Readonly<{
  selector: string | null;
  nodeKind: 'element' | 'text' | 'other' | 'unavailable';
  connected: boolean | null;
  previousRect: DashboardLayoutShiftRect;
  currentRect: DashboardLayoutShiftRect;
}>;

export type DashboardLayoutShift = Readonly<{
  value: number;
  startTime: number;
  hadRecentInput: boolean;
  phase: string;
  sources: readonly DashboardLayoutShiftSource[];
}>;

export type DashboardLayoutShiftReport = Readonly<{
  phases: readonly Readonly<{ phase: string; startTime: number }>[];
  inputActions: readonly Readonly<{ phase: string; phaseIndex: number; startTime: number }>[];
  shifts: readonly DashboardLayoutShift[];
}>;

declare global {
  interface Window {
    __dashboardLayoutShifts: {
      markPhase: (phase: string) => void;
      markInputAction: () => void;
      snapshot: () => DashboardLayoutShiftReport;
    };
  }
}

/** Keep every dependency inside this function so addInitScript can serialize it. */
export function installDashboardLayoutShifts(): void {
  type ShiftEntry = PerformanceEntry & {
    value: number;
    hadRecentInput: boolean;
    sources?: readonly {
      node?: Node | null;
      previousRect: DOMRectReadOnly;
      currentRect: DOMRectReadOnly;
    }[];
  };
  const phases = [{ phase: 'route-load', startTime: 0 }];
  const inputActions: { phase: string; phaseIndex: number; startTime: number }[] = [];
  const shifts: DashboardLayoutShift[] = [];
  const quote = (value: string) =>
    `"${value.replace(/["\\\n\r\f]/gu, (character) => `\\${character.charCodeAt(0).toString(16)} `)}"`;
  const distinguishSibling = (element: Element, part: string): string => {
    const siblings = element.parentElement
      ? [...element.parentElement.children].filter(
          (sibling) => sibling.localName === element.localName,
        )
      : [];
    return siblings.filter((sibling) => sibling.matches(part)).length > 1
      ? `${part}:nth-of-type(${siblings.indexOf(element) + 1})`
      : part;
  };
  const partFor = (element: Element): string => {
    const tag = element.localName;
    if (element.id) return `[id=${quote(element.id)}]`;
    const attribute = ['data-keyboard-item', 'data-testid', 'data-route-kind', 'aria-label'].find(
      (name) => element.hasAttribute(name),
    );
    if (attribute)
      return distinguishSibling(
        element,
        `${tag}[${attribute}=${quote(element.getAttribute(attribute) ?? '')}]`,
      );
    const classes = [...element.classList].filter((name) => /^(pc|op)-[a-z0-9_-]+$/iu.test(name));
    return distinguishSibling(element, classes.length > 0 ? `${tag}.${classes.join('.')}` : tag);
  };
  const selectorFor = (node: Node | null | undefined): string | null => {
    let element = node?.nodeType === 1 ? (node as Element) : node?.parentElement;
    if (!element) return null;
    const path: string[] = [];
    while (element) {
      path.unshift(partFor(element));
      if (element.id) break;
      element = element.parentElement;
    }
    return path.join(' > ');
  };
  const rect = (value: DOMRectReadOnly): DashboardLayoutShiftRect => ({
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    top: value.top,
    right: value.right,
    bottom: value.bottom,
    left: value.left,
  });
  const nodeKind = (node: Node | null | undefined): DashboardLayoutShiftSource['nodeKind'] => {
    if (!node) return 'unavailable';
    if (node.nodeType === 1) return 'element';
    return node.nodeType === 3 ? 'text' : 'other';
  };
  const record = (entries: readonly PerformanceEntry[]) => {
    for (const raw of entries) {
      const entry = raw as ShiftEntry;
      let phase = phases[0].phase;
      for (let index = phases.length - 1; index >= 0; index -= 1) {
        if (phases[index].startTime <= entry.startTime) {
          phase = phases[index].phase;
          break;
        }
      }
      shifts.push({
        value: entry.value,
        startTime: entry.startTime,
        hadRecentInput: entry.hadRecentInput,
        phase,
        sources: (entry.sources ?? []).map((source) => ({
          selector: selectorFor(source.node),
          nodeKind: nodeKind(source.node),
          connected: source.node?.isConnected ?? null,
          previousRect: rect(source.previousRect),
          currentRect: rect(source.currentRect),
        })),
      });
    }
  };
  const observer = new PerformanceObserver((list) => record(list.getEntries()));
  observer.observe({ type: 'layout-shift', buffered: true });
  window.__dashboardLayoutShifts = {
    markPhase: (phase) => phases.push({ phase, startTime: performance.now() }),
    markInputAction: () => {
      const phaseIndex = phases.length - 1;
      inputActions.push({
        phase: phases[phaseIndex].phase,
        phaseIndex,
        startTime: performance.now(),
      });
    },
    snapshot: () => {
      record(observer.takeRecords());
      return {
        phases: [...phases],
        inputActions: [...inputActions],
        shifts: [...shifts].sort((a, b) => a.startTime - b.startTime),
      };
    },
  };
}
