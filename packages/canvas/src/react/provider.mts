import type { ReactNode, Ref } from 'react';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type {
  Camera,
  CanvasController,
  CanvasEdge,
  CanvasNode,
  CanvasOptions,
  NodeId,
} from '../index.mjs';
import { createCanvas } from '../index.mjs';
import { useChromeBridge, useChromeCanvas } from './chrome-provider.mjs';

export interface CanvasProviderProps {
  label: string;
  options?: Omit<CanvasOptions, 'label'>;
  nodes?: readonly CanvasNode[];
  edges?: readonly CanvasEdge[];
  controllerRef?: Ref<CanvasController | null>;
  children?: ReactNode;
}

interface CanvasBinding {
  controller: CanvasController | null;
  nodes: { current: ReadonlyMap<NodeId, CanvasNode> };
  renderNodes: ReadonlyMap<NodeId, CanvasNode>;
  subscribeNodes: (notify: () => void) => () => void;
}

const CanvasContext = createContext<CanvasBinding | null>(null);
const initialCamera: Camera = { x: 0, y: 0, zoom: 1 };
const emptyNodes: readonly CanvasNode[] = [];
const emptyEdges: readonly CanvasEdge[] = [];

/** Owns a controller; pass nodes here rather than calling controller.setNodes directly. */
export function CanvasProvider({
  label,
  options,
  nodes = emptyNodes,
  edges = emptyEdges,
  controllerRef,
  children,
}: CanvasProviderProps): ReactNode {
  const initial = useRef({ label, options });
  const renderNodes = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const nodeMap = useRef<ReadonlyMap<NodeId, CanvasNode>>(new Map());
  const nodeListeners = useRef(new Set<() => void>());
  const subscribeNodes = useCallback((notify: () => void) => {
    nodeListeners.current.add(notify);
    return () => {
      nodeListeners.current.delete(notify);
    };
  }, []);
  const [controller, setController] = useState<CanvasController | null>(null);
  const bridge = useChromeBridge();
  const initialBridge = useRef(bridge);
  useEffect(() => {
    const live = createCanvas({ ...initial.current.options, label: initial.current.label });
    const unregister = initialBridge.current?.registerCanvas(live, {
      subscribe: subscribeNodes,
      snapshot: () => nodeMap.current.size,
    });
    setController(live);
    return () => {
      unregister?.();
      live.destroy();
    };
  }, [subscribeNodes]);
  useEffect(() => {
    if (typeof controllerRef === 'function') controllerRef(controller);
    else if (controllerRef) controllerRef.current = controller;
    return () => {
      if (typeof controllerRef === 'function') controllerRef(null);
      else if (controllerRef) controllerRef.current = null;
    };
  }, [controller, controllerRef]);
  useEffect(() => {
    nodeMap.current = renderNodes;
    controller?.setNodes(nodes);
    for (const notify of nodeListeners.current) notify();
  }, [controller, nodes, renderNodes]);
  useEffect(() => {
    controller?.setEdges(edges);
  }, [controller, edges]);
  const value = useMemo(
    () => ({ controller, nodes: nodeMap, renderNodes, subscribeNodes }),
    [controller, renderNodes, subscribeNodes],
  );
  return createElement(CanvasContext.Provider, { value }, children);
}

export function useCanvasBinding(): CanvasBinding | null {
  return useContext(CanvasContext);
}

/** Returns the controller after the provider's mount effect. */
export function useCanvas(): CanvasController | null {
  return useCanvasBinding()?.controller ?? null;
}

/** Subscribes to camera values, preserving snapshots that compare equal. */
export function useCamera<T>(
  selector: (camera: Camera) => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T {
  const localController = useCanvas();
  const chromeController = useChromeCanvas();
  const controller = localController ?? chromeController;
  const latest = useRef({ selector, isEqual });
  latest.current = { selector, isEqual };
  const store = useMemo(() => {
    let cached:
      | {
          camera: Camera;
          selector: typeof selector;
          isEqual: typeof isEqual;
          value: T;
        }
      | undefined;
    const select = (camera: Camera): T => {
      const current = latest.current;
      if (
        cached &&
        cached.selector === current.selector &&
        cached.isEqual === current.isEqual &&
        cached.camera.x === camera.x &&
        cached.camera.y === camera.y &&
        cached.camera.zoom === camera.zoom
      )
        return cached.value;
      const next = current.selector(camera);
      const value = cached && current.isEqual(cached.value, next) ? cached.value : next;
      cached = { camera, ...current, value };
      return value;
    };
    return {
      subscribe: (notify: () => void) => controller?.on('camera', notify) ?? (() => {}),
      snapshot: () => select(controller?.getCamera() ?? initialCamera),
      serverSnapshot: () => select(initialCamera),
    };
  }, [controller]);
  return useSyncExternalStore(store.subscribe, store.snapshot, store.serverSnapshot);
}
