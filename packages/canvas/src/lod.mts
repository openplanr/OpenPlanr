import { invalid, nonnegative, positive } from './camera.mjs';
import type { CanvasLevel, CanvasOptions } from './types.mjs';

export function createLod(options: CanvasOptions['lod']) {
  if (
    options !== undefined &&
    options !== false &&
    (!options || typeof options !== 'object' || Array.isArray(options))
  )
    invalid('lod', options);
  const settings = options || {};
  const compact = settings.compactBelow === undefined ? 0.6 : settings.compactBelow;
  const overview = settings.overviewBelow === undefined ? 0.4 : settings.overviewBelow;
  const hysteresis = settings.hysteresis === undefined ? 0.03 : settings.hysteresis;
  positive('lod.compactBelow', compact);
  positive('lod.overviewBelow', overview);
  nonnegative('lod.hysteresis', hysteresis);
  if (overview >= compact)
    invalid('lod.overviewBelow >= lod.compactBelow', `${overview} >= ${compact}`);
  if (hysteresis >= overview)
    invalid('lod.hysteresis >= lod.overviewBelow', `${hysteresis} >= ${overview}`);
  let level: CanvasLevel = 'dom';
  return {
    get: () => level,
    update(zoom: number): CanvasLevel {
      positive('camera.zoom', zoom);
      if (options === false) return level;
      if (level === 'dom' && zoom < compact - hysteresis) level = 'compact';
      else if (level === 'compact' && zoom > compact + hysteresis) level = 'dom';
      if (level === 'compact' && zoom < overview - hysteresis) level = 'overview';
      else if (level === 'overview' && zoom > overview + hysteresis)
        level = zoom > compact + hysteresis ? 'dom' : 'compact';
      return level;
    },
  };
}
