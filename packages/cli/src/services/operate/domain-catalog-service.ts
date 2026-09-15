const OPERATING_DOMAINS_MODULE = 'planr-pipeline/operate/operating-domains-v2';

export type PublicOperatingDomainRole = Readonly<{
  roleId: string;
  roleKind: 'advisor' | 'challenger' | 'chair';
  roleVersion: string;
  label: string;
}>;

export type PublicOperatingDomain = Readonly<{
  domainId: string;
  domainVersion: string;
  domainContract: Readonly<{
    apiDomainId: string;
    id: string;
    version: string;
  }>;
  roles: readonly PublicOperatingDomainRole[];
}>;

type OperatingDomainsModule = Readonly<{
  listPublicOperatingDomainsV2(registry?: unknown): unknown;
}>;

type OperatingDomainsModuleLoader = () => Promise<unknown>;

function invalidCatalog(message: string): never {
  throw Object.assign(new Error(message), { code: 'E_OPERATE_DOMAIN_CATALOG_INVALID' });
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalidCatalog(`${label} must be one object.`);
  }
  const result = value as Record<string, unknown>;
  const actual = Object.keys(result);
  const extra = actual.filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !Object.hasOwn(result, key));
  if (extra.length > 0 || missing.length > 0) {
    return invalidCatalog(`${label} does not match the public domain catalog contract.`);
  }
  return result;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    return invalidCatalog(`${label} must be one non-empty string.`);
  }
  return value;
}

function validateRole(value: unknown, domainIndex: number, roleIndex: number) {
  const label = `domains[${domainIndex}].roles[${roleIndex}]`;
  const role = exactRecord(value, ['roleId', 'roleKind', 'roleVersion', 'label'], label);
  const roleKind = requiredString(role.roleKind, `${label}.roleKind`);
  if (!['advisor', 'challenger', 'chair'].includes(roleKind)) {
    invalidCatalog(`${label}.roleKind is not a public operating role kind.`);
  }
  return Object.freeze({
    roleId: requiredString(role.roleId, `${label}.roleId`),
    roleKind: roleKind as PublicOperatingDomainRole['roleKind'],
    roleVersion: requiredString(role.roleVersion, `${label}.roleVersion`),
    label: requiredString(role.label, `${label}.label`),
  });
}

function validateDomain(value: unknown, index: number): PublicOperatingDomain {
  const label = `domains[${index}]`;
  const domain = exactRecord(
    value,
    ['domainId', 'domainVersion', 'domainContract', 'roles'],
    label,
  );
  const domainId = requiredString(domain.domainId, `${label}.domainId`);
  const contract = exactRecord(
    domain.domainContract,
    ['apiDomainId', 'id', 'version'],
    `${label}.domainContract`,
  );
  const apiDomainId = requiredString(contract.apiDomainId, `${label}.domainContract.apiDomainId`);
  if (apiDomainId !== domainId) {
    invalidCatalog(`${label} is not bound to its exact public API domain identity.`);
  }
  if (!Array.isArray(domain.roles) || domain.roles.length === 0) {
    invalidCatalog(`${label}.roles must contain the registered role choreography.`);
  }
  const roles = domain.roles.map((role, roleIndex) => validateRole(role, index, roleIndex));
  if (new Set(roles.map(({ roleId }) => roleId)).size !== roles.length) {
    invalidCatalog(`${label}.roles contains duplicate role identities.`);
  }
  return Object.freeze({
    domainId,
    domainVersion: requiredString(domain.domainVersion, `${label}.domainVersion`),
    domainContract: Object.freeze({
      apiDomainId,
      id: requiredString(contract.id, `${label}.domainContract.id`),
      version: requiredString(contract.version, `${label}.domainContract.version`),
    }),
    roles: Object.freeze(roles),
  });
}

async function loadInstalledOperatingDomainsModule(): Promise<unknown> {
  try {
    return await import(OPERATING_DOMAINS_MODULE);
  } catch (error) {
    const candidate = error as { code?: unknown; message?: unknown } | null;
    const message = typeof candidate?.message === 'string' ? candidate.message : '';
    if (
      (candidate?.code === 'ERR_MODULE_NOT_FOUND' || candidate?.code === 'MODULE_NOT_FOUND') &&
      message.includes('planr-pipeline')
    ) {
      throw Object.assign(
        new Error(
          'Operate requires the optional planr-pipeline package. Reinstall OpenPlanr with optional dependencies (do not use --omit=optional).',
        ),
        { code: 'E_OPERATE_PIPELINE_MISSING' },
      );
    }
    throw error;
  }
}

/**
 * Reads only the installed pipeline's validated public registry projection.
 * OpenPlanr preserves registry order and never invents a domain version or default.
 */
export async function listInstalledPublicOperatingDomains(
  loadModule: OperatingDomainsModuleLoader = loadInstalledOperatingDomainsModule,
): Promise<readonly PublicOperatingDomain[]> {
  const imported = (await loadModule()) as Partial<OperatingDomainsModule>;
  if (typeof imported.listPublicOperatingDomainsV2 !== 'function') {
    invalidCatalog(
      'The installed planr-pipeline package does not expose its public domain catalog.',
    );
  }
  const value = imported.listPublicOperatingDomainsV2();
  if (!Array.isArray(value) || value.length === 0) {
    invalidCatalog('The installed public operating domain catalog is empty or invalid.');
  }
  const domains = value.map((domain, index) => validateDomain(domain, index));
  const identities = domains.map(
    ({ domainId, domainVersion }) => `${domainId}\u0000${domainVersion}`,
  );
  if (new Set(identities).size !== identities.length) {
    invalidCatalog('The installed public operating domain catalog contains duplicate identities.');
  }
  return Object.freeze(domains);
}
