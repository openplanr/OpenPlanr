import type { CSSProperties, ReactNode } from 'react';

export type ChipSurface = 'bg' | 'panel' | 'card' | 'raised';
export type ArtifactType = 'spec' | 'us' | 't' | 'bl' | 'adr' | 'epic' | 'sprint' | 'qt';

const ARTIFACT_TYPES: readonly string[] = ['spec', 'us', 't', 'bl', 'adr', 'epic', 'sprint', 'qt'];
const PLANNING_TAG_TYPES: Readonly<Record<string, ArtifactType>> = {
  story: 'us',
  task: 't',
  backlog: 'bl',
  quick: 'qt',
};

/** Tag recipe for a planning artifact type, or null when the type has no tag colour. */
export function artifactTagType(type: string): ArtifactType | null {
  const tag = PLANNING_TAG_TYPES[type] ?? type;
  return ARTIFACT_TYPES.includes(tag) ? (tag as ArtifactType) : null;
}

export type ArtifactTagProps = Readonly<{
  type: ArtifactType;
  children: ReactNode;
  surface?: ChipSurface;
  variant?: 'id';
}>;

export function ArtifactTag({ type, children, surface = 'panel', variant }: ArtifactTagProps) {
  return (
    <span
      className={variant === 'id' ? 'pc-artifact-tag pc-artifact-row__id' : 'pc-artifact-tag'}
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

export type PriorityChipProps = Readonly<{ priority?: string; variant?: 'text' }>;

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

export function PriorityChip({ priority = 'none', variant }: PriorityChipProps) {
  if (variant === 'text') {
    if (priority === 'none' || !priority) return null;
    const level = ['P0', 'P1', 'critical', 'high'].includes(priority)
      ? 'high'
      : ['P2', 'medium'].includes(priority)
        ? 'medium'
        : ['P3', 'low'].includes(priority)
          ? 'low'
          : priority;
    return (
      <span className="pc-priority" data-variant="text" data-priority={level}>
        {level.charAt(0).toUpperCase() + level.slice(1)}
      </span>
    );
  }
  const recipe = Object.hasOwn(PRIORITIES, priority) ? PRIORITIES[priority] : undefined;
  return (
    <span className="pc-priority" data-priority={priority} data-high={recipe?.high || undefined}>
      <span aria-hidden="true">{recipe?.glyph ?? '?'}</span>
      {recipe?.label ?? priority}
    </span>
  );
}
