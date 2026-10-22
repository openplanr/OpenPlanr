import {
  makeBundle,
  placement,
  sealBundle,
} from '../../../../tests/protocol/fixtures/diagram-authoring.mjs';

export function canvasDiagram(count) {
  const bundle = makeBundle('flowchart', { blank: true });
  const nodes = Math.ceil((count + 1) / 2);
  for (let index = 0; index < nodes; index++) {
    const id = `node-${index}`;
    bundle.document.nodes.push({
      id,
      kind: 'process',
      label: `Step ${index}\nCheck order`,
      description: null,
    });
    bundle.presentation.elements.push(
      placement(id, 'rectangle', (index % 24) * 240, Math.floor(index / 24) * 150),
    );
  }
  for (let index = 0; index < count - nodes; index++) {
    const from = bundle.presentation.elements[index],
      to = bundle.presentation.elements[index + 1];
    const id = `edge-${index}`;
    bundle.document.relations.push({
      id,
      from: from.elementId,
      to: to.elementId,
      kind: 'flow',
      direction: 'forward',
      label: null,
      weight: null,
    });
    bundle.presentation.elements.push({
      ...placement(id, 'connector'),
      bounds: null,
      zIndex: 0,
      route: {
        mode: 'manual',
        strategy: 'straight',
        from: { side: 'right', offset: 0.5 },
        to: { side: 'left', offset: 0.5 },
        points: [
          { x: from.bounds.x + from.bounds.width, y: from.bounds.y + 35 },
          { x: to.bounds.x, y: to.bounds.y + 35 },
        ],
      },
    });
  }
  return sealBundle(bundle);
}
