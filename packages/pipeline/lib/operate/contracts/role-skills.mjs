/**
 * Stable business role-to-skill bindings. Prompt content is owned only by the
 * workspace `skills/` tree and projected by `scripts/skills/generate-v18.mjs`.
 */
export const BUSINESS_EXECUTIVE_SKILL_BINDINGS = Object.freeze([
  Object.freeze({ roleId: 'strategy-finance', skillName: 'planr-ceo-review', label: 'CEO', outputFile: 'ceo.md' }),
  Object.freeze({ roleId: 'technology-risk', skillName: 'planr-cto-review', label: 'CTO', outputFile: 'cto.md' }),
  Object.freeze({ roleId: 'product-activation', skillName: 'planr-cpo-review', label: 'CPO', outputFile: 'cpo.md' }),
  Object.freeze({ roleId: 'growth-market', skillName: 'planr-cmo-review', label: 'CMO', outputFile: 'cmo.md' }),
  Object.freeze({ roleId: 'operations-customer', skillName: 'planr-coo-review', label: 'COO', outputFile: 'coo.md' }),
  Object.freeze({ roleId: 'independent-challenge', skillName: 'planr-challenger-review', label: 'Challenger', outputFile: 'challenger.md' }),
  Object.freeze({ roleId: 'chair', skillName: 'planr-chair-review', label: 'Chair', outputFile: 'chair.md' }),
]);

/** Resolve declarative bindings against the compiled Protocol-owned registry. */
export function businessExecutiveRoles(catalog) {
  const domain = catalog.extensions.domains.find(({ domainId, domainVersion }) => (
    domainId === 'business' && domainVersion === '1.0.0'
  ));
  if (!domain) {
    throw new Error('business-domain@1.0.0 is missing from the compiled Operate catalog.');
  }
  return BUSINESS_EXECUTIVE_SKILL_BINDINGS.map((binding) => {
    const role = domain.roles.find(({ roleId }) => roleId === binding.roleId);
    if (!role) {
      throw new Error(`Compiled catalog is missing business role ${binding.roleId}.`);
    }
    return Object.freeze({ ...binding, role });
  });
}

/** Generate the compatibility appendix from registry-owned mandate data. */
export function renderOperateMandateAppendixModule(catalog) {
  businessExecutiveRoles(catalog);
  const domains = Object.fromEntries(catalog.extensions.domains.map((domain) => [
    domain.domainId,
    Object.fromEntries(domain.roles.map((role) => [role.roleId, role.mandate])),
  ]));
  const firstMandate = catalog.extensions.domains.flatMap(({ roles }) => roles)[0]?.mandate;
  if (!firstMandate) throw new Error('The compiled Operate catalog has no role mandates.');
  const ceiling = {
    allowedCapabilities: firstMandate.allowedCapabilities,
    forbiddenEffects: firstMandate.forbiddenEffects,
    capabilityCeiling: firstMandate.capabilityCeiling,
  };
  return `// Generated from registry/operate-v2-contracts.json. Do not edit.

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const INTELLIGENCE_MANDATE_CEILING_V2 = deepFreeze(${JSON.stringify(ceiling, null, 2)});
export const BUSINESS_DOMAIN_ROLE_MANDATES_V2 = deepFreeze(${JSON.stringify(domains.business ?? {}, null, 2)});
export const SOFTWARE_DOMAIN_ROLE_MANDATES_V2 = deepFreeze(${JSON.stringify(domains.software ?? {}, null, 2)});
export const DOMAIN_ROLE_MANDATES_V2 = deepFreeze({
  business: BUSINESS_DOMAIN_ROLE_MANDATES_V2,
  software: SOFTWARE_DOMAIN_ROLE_MANDATES_V2,
});
`;
}
