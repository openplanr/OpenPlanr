export type NodeId = string;
export type Direction = 'up' | 'down' | 'left' | 'right';
export type Point = Readonly<{ x: number; y: number }>;
export type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;
export type ChromeSurface = Readonly<{
  id: string;
  edge: 'top' | 'right' | 'bottom' | 'left';
  rect: Rect;
  open: boolean;
}>;
export type Camera = Readonly<{ x: number; y: number; zoom: number }>;
export type WorldElement = HTMLElement;
export type CanvasNode = Readonly<{ id: NodeId; bounds: Rect; kind?: string; frame?: boolean }>;
export type CanvasLevel = 'dom' | 'compact' | 'overview';
export type OverviewStyle = (node: CanvasNode) => Readonly<{ fill: string; stroke: string }>;
export type MinimapTransform = Readonly<{ scale: number; offsetX: number; offsetY: number }>;
export type OverviewMetrics = Readonly<{
  cachePixelBytes: number;
  redraws: number;
  cameraFrame: number;
  presentedCameraFrame: number;
  presentationLagFrames: readonly number[];
}>;

export type CanvasEdge = Readonly<{
  id: string;
  from: NodeId;
  to: NodeId;
  style: string;
  points?: readonly Point[];
}>;
export type Breakpoint = Readonly<{ name: string; minWidth: number }>;
export type Diagnostic = Readonly<{
  code: 'unknown-endpoint' | 'duplicate-id' | 'invalid-bounds';
  id: string;
  reason: string;
}>;

export interface CanvasOptions {
  label: string;
  zoom?: Readonly<{ min?: number; max?: number }>;
  lod?: Readonly<{ compactBelow?: number; overviewBelow?: number; hysteresis?: number }> | false;
  overviewStyle?: OverviewStyle;
  overviewRenderer?: 'canvas' | 'worker';
  culling?: Readonly<{ cellSize?: number; marginFactor?: number }>;
  breakpoints?: readonly Breakpoint[];
  worldBounds?: Readonly<{ rect: Rect; padding: number }>;
  motion?: 'auto' | 'none';
  pointerMode?: 'pan' | 'none';
  keyboard?: Readonly<{ arrows?: 'navigate' | 'none' }>;
  strict?: boolean;
  shortcutsEnabled?: () => boolean;
  navigate?: (from: NodeId, direction: Direction) => NodeId | null;
  outlineOrder?: (nodes: readonly CanvasNode[]) => readonly NodeId[];
}

export interface CanvasElements {
  stage: HTMLElement;
  world: WorldElement;
  overlays?: readonly WorldElement[];
  edges?: SVGSVGElement | SVGGElement;
  overview?: HTMLCanvasElement;
}

export interface CanvasEvents {
  camera: Camera;
  mount: ReadonlySet<NodeId>;
  geometry: ReadonlySet<NodeId>;
  level: CanvasLevel;
  selection: readonly NodeId[];
  focus: NodeId | null;
  breakpoint: string | null;
  'safe-area': Rect;
  diagnostics: readonly Diagnostic[];
  'active-frame': NodeId | null;
}

export interface CanvasController {
  attach(elements: CanvasElements): void;
  detach(): void;
  destroy(): void;
  setNodes(nodes: readonly CanvasNode[]): void;
  setEdges(edges: readonly CanvasEdge[]): void;
  registerNodeElement(id: NodeId, element: Element | null): void;
  setPinned(source: string, ids: readonly NodeId[]): void;
  getMountedIds(): ReadonlySet<NodeId>;
  getDiagnostics(): readonly Diagnostic[];
  getBreakpoint(): string | null;
  setChrome(surface: ChromeSurface): void;
  removeChrome(id: string): void;
  getSafeArea(): Rect;
  getLevel(id?: NodeId): CanvasLevel;
  getOverviewMetrics(): OverviewMetrics;
  getCamera(): Camera;
  setCamera(camera: Camera, options?: Readonly<{ animate?: boolean }>): void;
  panBy(dxScreen: number, dyScreen: number): void;
  zoomAt(factor: number, screenPoint?: Point): void;
  fit(
    target: 'all' | 'selection' | readonly NodeId[],
    options?: Readonly<{ padding?: number; maxZoom?: number }>,
  ): void;
  reveal(id: NodeId, options?: Readonly<{ mode?: 'minimal' | 'center' }>): void;
  worldToScreen(point: Point): Point;
  screenToWorld(point: Point): Point;
  hitTest(screenPoint: Point): NodeId | null;
  setSelection(ids: readonly NodeId[]): void;
  getSelection(): readonly NodeId[];
  focusNode(id: NodeId): Promise<void>;
  getFocus(): NodeId | null;
  getOutline(): readonly NodeId[];
  setPointerMode(mode: 'pan' | 'none'): void;
  handleKey(event: KeyboardEvent): boolean;
  setActiveFrame(id: NodeId | null): void;
  getActiveFrame(): NodeId | null;
  deactivateFrame(): void;
  on<K extends keyof CanvasEvents>(
    event: K,
    listener: (payload: CanvasEvents[K]) => void,
  ): () => void;
}
