export type NodeId = string;
export type Point = Readonly<{ x: number; y: number }>;
export type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;
export type Camera = Readonly<{ x: number; y: number; zoom: number }>;
export type WorldElement = HTMLElement | SVGGElement;
export type CanvasNode = Readonly<{ id: NodeId; bounds: Rect; kind?: string; frame?: boolean }>;

export interface CanvasOptions {
  label: string;
  zoom?: Readonly<{ min?: number; max?: number }>;
  worldBounds?: Readonly<{ rect: Rect; padding: number }>;
  motion?: 'auto' | 'none';
  pointerMode?: 'pan' | 'none';
  keyboard?: Readonly<{ arrows?: 'navigate' | 'none' }>;
  strict?: boolean;
  shortcutsEnabled?: () => boolean;
}

export interface CanvasElements {
  stage: HTMLElement;
  world: WorldElement;
  overlays?: readonly WorldElement[];
}

export interface CanvasEvents {
  camera: Camera;
  'active-frame': NodeId | null;
}

export interface CanvasController {
  attach(elements: CanvasElements): void;
  detach(): void;
  destroy(): void;
  setNodes(nodes: readonly CanvasNode[]): void;
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
  setSelection(ids: readonly NodeId[]): void;
  getSelection(): readonly NodeId[];
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
