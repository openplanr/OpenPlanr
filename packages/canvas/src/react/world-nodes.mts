import type { ReactNode } from 'react';
import {
  createElement,
  Fragment,
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { CanvasController, CanvasLevel, CanvasNode, NodeId } from '../index.mjs';
import { useCanvasBinding } from './provider.mjs';

export interface WorldNodesProps<T> {
  data: ReadonlyMap<NodeId, T>;
  renderNode: (id: NodeId, item: T | undefined, level: CanvasLevel) => ReactNode;
  nodeAttributes?: (
    id: NodeId,
    item: T | undefined,
    level: CanvasLevel,
  ) => Readonly<Record<string, string | undefined>>;
  className?: string;
}

interface NodeProps<T> {
  id: NodeId;
  item: T | undefined;
  level: CanvasLevel;
  controller: CanvasController;
  nodes: { current: ReadonlyMap<NodeId, CanvasNode> };
  renderer: { current: WorldNodesProps<T>['renderNode'] };
  attributes: { current: WorldNodesProps<T>['nodeAttributes'] };
  className?: string;
}

function position(element: HTMLElement, node: CanvasNode): void {
  const { x, y, width, height } = node.bounds;
  element.style.transform = `translate(${x}px, ${y}px)`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
}

function NodeWrapper<T>({
  id,
  item,
  level,
  controller,
  nodes,
  renderer,
  attributes,
  className,
}: NodeProps<T>): ReactNode {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const wrapper = element.current;
    if (!wrapper) return;
    const update = () => {
      const node = nodes.current.get(id);
      if (!node)
        throw new Error(`WorldNodes: mounted node ${id} is absent from CanvasProvider nodes`);
      position(wrapper, node);
    };
    update();
    controller.registerNodeElement(id, wrapper);
    const unsubscribe = controller.on('geometry', (ids) => {
      if (ids.has(id)) update();
    });
    return () => {
      unsubscribe();
      controller.registerNodeElement(id, null);
    };
  }, [controller, id, nodes]);
  const nodeAttributes = attributes.current?.(id, item, level);
  return createElement(
    'div',
    {
      ...nodeAttributes,
      ref: element,
      className: [className, nodeAttributes?.className].filter(Boolean).join(' ') || undefined,
      'data-canvas-node-id': id,
      style: { position: 'absolute', top: 0, left: 0 },
    },
    renderer.current(id, item, level),
  );
}

const MemoNode = memo(NodeWrapper) as typeof NodeWrapper;
type Mounted = readonly Readonly<{ id: NodeId; level: CanvasLevel }>[];
const emptyMounted: Mounted = [];

/** Renders mounted nodes and writes geometry updates without React commits. */
export function WorldNodes<T>({
  data,
  renderNode,
  nodeAttributes,
  className,
}: WorldNodesProps<T>): ReactNode {
  const binding = useCanvasBinding();
  const controller = binding?.controller ?? null;
  const renderNodes = binding?.renderNodes;
  const renderer = useRef(renderNode);
  renderer.current = renderNode;
  const attributes = useRef(nodeAttributes);
  attributes.current = nodeAttributes;
  const store = useMemo(() => {
    let snapshot: Mounted = emptyMounted;
    return {
      subscribe: (notify: () => void) => {
        if (!controller) return () => {};
        const subscriptions = [
          controller.on('mount', notify),
          controller.on('level', notify),
          controller.on('selection', notify),
          controller.on('focus', notify),
          controller.on('geometry', notify),
        ];
        return () => {
          for (const unsubscribe of subscriptions) unsubscribe();
        };
      },
      snapshot: () => {
        const next = controller
          ? [...controller.getMountedIds()]
              .filter((id) => renderNodes?.has(id))
              .map((id) => ({ id, level: controller.getLevel(id) }))
          : emptyMounted;
        if (
          next.length !== snapshot.length ||
          next.some(
            (node, index) =>
              node.id !== snapshot[index]?.id || node.level !== snapshot[index]?.level,
          )
        )
          snapshot = next;
        return snapshot;
      },
    };
  }, [controller, renderNodes]);
  const mounted = useSyncExternalStore(store.subscribe, store.snapshot, () => emptyMounted);
  if (!controller || !binding) return null;
  return createElement(
    Fragment,
    null,
    ...mounted.map(({ id, level }) =>
      createElement(MemoNode<T>, {
        key: id,
        id,
        item: data.get(id),
        level,
        controller,
        nodes: binding.nodes,
        renderer,
        attributes,
        className,
      }),
    ),
  );
}
