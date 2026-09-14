import { describe, expect, it } from 'vitest';
import { listInstalledPublicOperatingDomains } from '../../src/services/operate/domain-catalog-service.js';

const domain = (overrides: Record<string, unknown> = {}) => ({
  domainId: 'business',
  domainVersion: '1.0.0',
  domainContract: {
    apiDomainId: 'business',
    id: 'business-domain',
    version: '1.0.0',
  },
  roles: [
    {
      roleId: 'strategy-finance',
      roleKind: 'advisor',
      roleVersion: '2.0.0',
      label: 'CEO / Strategy & Finance',
    },
    {
      roleId: 'board-challenger',
      roleKind: 'challenger',
      roleVersion: '2.0.0',
      label: 'Board Challenger',
    },
  ],
  ...overrides,
});

describe('installed public operating domain catalog', () => {
  it('preserves the pipeline registry order and exact role identities', async () => {
    const software = domain({
      domainId: 'software',
      domainContract: {
        apiDomainId: 'software',
        id: 'software-domain',
        version: '1.0.0',
      },
      roles: [
        {
          roleId: 'operate-advisor',
          roleKind: 'advisor',
          roleVersion: '2.0.0',
          label: 'Operating Advisor',
        },
      ],
    });
    const catalog = await listInstalledPublicOperatingDomains(async () => ({
      listPublicOperatingDomainsV2: () => [software, domain()],
    }));

    expect(catalog.map(({ domainId, domainVersion }) => [domainId, domainVersion])).toEqual([
      ['software', '1.0.0'],
      ['business', '1.0.0'],
    ]);
    expect(catalog[1].roles.map(({ roleId }) => roleId)).toEqual([
      'strategy-finance',
      'board-challenger',
    ]);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog[1].roles)).toBe(true);
  });

  it.each([
    {
      name: 'an adapter-invented field',
      catalog: [domain({ default: true })],
    },
    {
      name: 'a foreign API-domain binding',
      catalog: [
        domain({
          domainContract: {
            apiDomainId: 'software',
            id: 'business-domain',
            version: '1.0.0',
          },
        }),
      ],
    },
    {
      name: 'duplicate domain identities',
      catalog: [domain(), domain()],
    },
    {
      name: 'duplicate role identities',
      catalog: [
        domain({
          roles: [
            {
              roleId: 'board-chair',
              roleKind: 'chair',
              roleVersion: '2.0.0',
              label: 'Board Chair',
            },
            {
              roleId: 'board-chair',
              roleKind: 'chair',
              roleVersion: '2.0.0',
              label: 'Board Chair',
            },
          ],
        }),
      ],
    },
  ])('rejects $name instead of filtering or defaulting', async ({ catalog }) => {
    await expect(
      listInstalledPublicOperatingDomains(async () => ({
        listPublicOperatingDomainsV2: () => catalog,
      })),
    ).rejects.toMatchObject({ code: 'E_OPERATE_DOMAIN_CATALOG_INVALID' });
  });

  it('refuses an installed pipeline without the public catalog export', async () => {
    await expect(listInstalledPublicOperatingDomains(async () => ({}))).rejects.toMatchObject({
      code: 'E_OPERATE_DOMAIN_CATALOG_INVALID',
    });
  });
});
