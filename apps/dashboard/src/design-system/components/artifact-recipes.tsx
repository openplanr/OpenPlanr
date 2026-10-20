import type { CSSProperties, ReactNode } from 'react';

export type ChipSurface = 'bg' | 'panel' | 'card' | 'raised';
export type ArtifactType = 'spec' | 'us' | 't' | 'bl' | 'adr' | 'epic' | 'sprint' | 'qt';

export type ArtifactTagProps = Readonly<{
  type: ArtifactType;
  children: ReactNode;
  surface?: ChipSurface;
}>;

export function ArtifactTag({ type, children, surface = 'panel' }: ArtifactTagProps) {
  return (
    <span
      className="pc-artifact-tag"
      data-type={type}
      data-surface={surface}
      style={chipStyle(`type-${type}`, surface)}
    >
      {children}
    </span>
  );
}

// An explicit opaque base keeps row selection and live washes out of chip contrast.
export function chipStyle(recipe: string, surface: ChipSurface): CSSProperties {
  return {
    color: `var(--pc-${recipe}${recipe.startsWith('status-') ? '-fg' : ''})`,
    background: `var(--pc-${recipe}-bg-${surface})`,
  };
}

export type PriorityChipProps = Readonly<{ priority?: string }>;

const PRIORITIES: Readonly<Record<string, { label: string; glyph: string; high?: boolean }>> = {
  P0: { label: 'P0', glyph: '!!', high: true },
  critical: { label: 'critical', glyph: '!!', high: true },
  P1: { label: 'P1', glyph: '↑', high: true },
  high: { label: 'high', glyph: '↑', high: true },
  P2: { label: 'P2', glyph: '=' },
  medium: { label: 'medium', glyph: '=' },
  P3: { label: 'P3', glyph: '↓' },
  low: { label: 'low', glyph: '↓' },
  none: { label: 'none', glyph: '·' },
};

export function PriorityChip({ priority = 'none' }: PriorityChipProps) {
  const recipe = Object.hasOwn(PRIORITIES, priority) ? PRIORITIES[priority] : undefined;
  return (
    <span className="pc-priority" data-priority={priority} data-high={recipe?.high || undefined}>
      <span aria-hidden="true">{recipe?.glyph ?? '?'}</span>
      {recipe?.label ?? priority}
    </span>
  );
}
