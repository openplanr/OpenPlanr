import { initialFrameHeight } from '../frame-size.mjs';

/** Resolve document positions and titles over the studio's default grid. */
export function boardPlacement(
  design,
  entry,
  { layout = design.layout, compare = false, variantId = design.selectedVariant } = {},
) {
  const gap = 96;
  const frame = design.frames.find(({ id }) => id === entry.frameId);
  const variants = compare
    ? design.variants.filter(({ status }) => status === 'ready')
    : [{ id: variantId }];
  const groupWidth =
    design.frames.reduce((sum, item) => sum + item.width, 0) +
    gap * Math.max(0, design.frames.length - 1) +
    160;
  const offset =
    variants.findIndex(({ id }) => id === entry.variantId) * groupWidth +
    design.frames
      .slice(0, design.frames.indexOf(frame))
      .reduce((sum, item) => sum + item.width + gap, 0);
  const screen = design.screens.find(({ id }) => id === entry.screenId);
  const variant = design.variants.find(({ id }) => id === entry.variantId);
  const keys = [
    entry.screenId,
    `${entry.screenId}/${entry.frameId}`,
    `${entry.screenId}/${entry.frameId}/${entry.variantId}`,
  ];
  const matches = keys.map((key) =>
    layout?.boards && Object.hasOwn(layout.boards, key) ? layout.boards[key] : undefined,
  );
  const point = matches[2] ?? matches[1];
  const position =
    point ??
    (matches[0]
      ? { x: matches[0].x + offset, y: matches[0].y }
      : {
          x: offset,
          y: 72 + design.screenOrder.indexOf(entry.screenId) * (initialFrameHeight(design) + 176),
        });
  const title =
    [...matches].reverse().find((match) => match?.title)?.title ??
    `${screen.title}${design.variants.filter(({ status }) => status === 'ready').length > 1 ? ` / ${variant.label}` : ''}`;
  return { x: position.x, y: position.y, title };
}
