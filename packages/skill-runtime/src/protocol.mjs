import {
  getCanonicalRegistry,
  getRole,
  resolveLegacyRoleAlias,
  validateCanonicalRegistries,
} from '@openplanr/protocol/registries';

/**
 * Return the immutable Protocol-owned skill catalog. Contribution manifests
 * may add composition metadata, but never redefine matching or authority.
 */
export function getSkillCatalog() {
  validateCanonicalRegistries();
  return getCanonicalRegistry('skills.json');
}

/** Return the immutable Protocol-owned role catalog and alias resolver. */
export function getRoleCatalog() {
  validateCanonicalRegistries();
  return getCanonicalRegistry('roles.json');
}

export { getRole, resolveLegacyRoleAlias };
