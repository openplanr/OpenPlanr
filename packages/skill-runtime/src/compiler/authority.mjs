import { SkillRuntimeError } from '../errors.mjs';

// Component-wise monotone authority lattice. A host overlay or shared module may
// narrow each component but never widen it. Narrowing directions:
//   repositoryAccess : request-scope -> declared-paths -> read-only -> none
//   externalDataAccess: read-only -> none
//   allowed{Capabilities,Tools,Operations,OutputClasses}: subset only
//   forbiddenEffects : superset only (grows)
const REPOSITORY_ACCESS_ORDER = Object.freeze([
  'request-scope',
  'declared-paths',
  'read-only',
  'none',
]);
const EXTERNAL_DATA_ACCESS_ORDER = Object.freeze(['read-only', 'none']);
const ALLOWED_SET_COMPONENTS = Object.freeze([
  'allowedCapabilities',
  'allowedTools',
  'allowedOperations',
  'allowedOutputClasses',
]);

function rank(order, value, component, edge) {
  const index = order.indexOf(value);
  if (index === -1) {
    throw new SkillRuntimeError(
      'E_SKILL_AUTHORITY_COMPONENT_INVALID',
      `${component} value ${String(value)} is not part of the authority lattice.`,
      { component, value, edge },
    );
  }
  return index;
}

function widen(component, edge, detail) {
  return new SkillRuntimeError(
    'E_SKILL_AUTHORITY_WIDENED',
    `Overlay widens ${component} across ${edge.from} -> ${edge.to}.`,
    {
      component,
      edge,
      ...detail,
      repair: `Remove the widening ${component} change from ${edge.to}; an overlay may only narrow ${component}.`,
    },
  );
}

/**
 * Validate that `overlay` narrows `base` component-wise. Throws
 * E_SKILL_AUTHORITY_WIDENED naming the widened component, the source edge, and a
 * repair action. Returns the narrowed (overlay) authority when valid.
 */
export function assertAuthorityNarrows(base, overlay, { edge }) {
  if (
    rank(REPOSITORY_ACCESS_ORDER, overlay.repositoryAccess, 'repositoryAccess', edge) <
    rank(REPOSITORY_ACCESS_ORDER, base.repositoryAccess, 'repositoryAccess', edge)
  ) {
    throw widen('repositoryAccess', edge, {
      base: base.repositoryAccess,
      overlay: overlay.repositoryAccess,
    });
  }
  if (
    rank(EXTERNAL_DATA_ACCESS_ORDER, overlay.externalDataAccess, 'externalDataAccess', edge) <
    rank(EXTERNAL_DATA_ACCESS_ORDER, base.externalDataAccess, 'externalDataAccess', edge)
  ) {
    throw widen('externalDataAccess', edge, {
      base: base.externalDataAccess,
      overlay: overlay.externalDataAccess,
    });
  }
  for (const component of ALLOWED_SET_COMPONENTS) {
    const allowed = new Set(base[component]);
    const added = overlay[component].filter((member) => !allowed.has(member));
    if (added.length > 0) throw widen(component, edge, { added });
  }
  const forbidden = new Set(overlay.forbiddenEffects);
  const dropped = base.forbiddenEffects.filter((member) => !forbidden.has(member));
  if (dropped.length > 0) throw widen('forbiddenEffects', edge, { dropped });
  return overlay;
}

export { REPOSITORY_ACCESS_ORDER, EXTERNAL_DATA_ACCESS_ORDER, ALLOWED_SET_COMPONENTS };
