import { makeBundle, placement, sealBundle } from '../../../../tests/protocol/fixtures/diagram-authoring.mjs';

export function mixedBundle(laneCount = 50) {
  const bundle = makeBundle('swimlane', { blank: true });
  for (let lane = 0; lane < laneCount; lane++) {
    const x = lane % 10 * 2400, y = Math.floor(lane / 10) * 600;
    const laneId = `lane-${lane}`, groupId = `group-${lane}`;
    const members = Array.from({ length: 12 }, (_, index) => `node-${lane * 12 + index}`);
    bundle.document.lanes.push({ id: laneId, label: `Lane ${lane}`, members: [groupId] }); bundle.document.laneOrder.push(laneId);
    bundle.document.groups.push({ id: groupId, label: `Group ${lane}`, members });
    for (const [id, bounds, zIndex] of [[laneId, { x, y, width: 2200, height: 500 }, 0], [groupId, { x: x + 20, y: y + 80, width: 2000, height: 320 }, 1]]) {
      const value = placement(id, 'container'); value.bounds = bounds; value.zIndex = zIndex; value.appearance.fill = 'transparent'; bundle.presentation.elements.push(value);
    }
    const nodePlacements = [];
    for (let index = 0; index < members.length; index++) {
      const id = members[index]; bundle.document.nodes.push({ id, label: `N${lane * 12 + index}`, kind: 'process', description: null });
      const value = placement(id, 'rectangle', x + 80 + index % 6 * 280, y + 140 + Math.floor(index / 6) * 100); value.zIndex = 3;
      nodePlacements.push(value); bundle.presentation.elements.push(value);
    }
    for (let index = 0; index < 6; index++) {
      const id = `edge-${lane * 6 + index}`, from = nodePlacements[index * 2], to = nodePlacements[index * 2 + 1];
      bundle.document.relations.push({ id, from: from.elementId, to: to.elementId, kind: 'flow', direction: 'forward', label: 'Next', weight: null });
      bundle.presentation.elements.push({ ...placement(id, 'connector'), bounds: null, zIndex: 2, label: { x: from.bounds.x + from.bounds.width + 30, y: from.bounds.y - 30, width: 70 }, route: {
        mode: 'manual', strategy: 'straight', from: { side: 'right', offset: 0.5 }, to: { side: 'left', offset: 0.5 }, points: [{ x: from.bounds.x + from.bounds.width, y: from.bounds.y + 35 }, { x: to.bounds.x, y: to.bounds.y + 35 }],
      } });
    }
  }
  return sealBundle(bundle);
}
